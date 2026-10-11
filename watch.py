"""柏市公共施設予約システムのテニスコート空きを監視し、新しい空きを LINE に通知する。

標準ライブラリのみで動作する (Python 3.11+)。

    python watch.py            # 監視して通知、state.json を更新
    python watch.py --dry-run  # 通知も保存もせず、結果を表示するだけ
"""
import argparse
import html
import json
import os
import re
import sys
import time
import tomllib
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

BASE_URL = "https://shisetsu-reservation.city.kashiwa.lg.jp/index.php"
LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push"
USER_AGENT = "Mozilla/5.0 (compatible; kashiwa-tennis-alert; personal vacancy watcher)"
MOKUTEKI_TENNIS = "007"
JST = timezone(timedelta(hours=9))
ROOT = Path(__file__).parent
CONFIG_PATH = ROOT / "config.toml"
STATE_PATH = ROOT / "state.json"

REQUEST_INTERVAL_SEC = 2  # 複数日を監視するときのリクエスト間隔
PX_PER_HOUR = 38  # 1時間 = 37px + 罫線1px
LINE_TEXT_LIMIT = 4500  # LINE のテキスト上限は5000文字
LINE_MONTHLY_FREE = 200
WEEKDAYS = "月火水木金土日"


class SiteError(Exception):
    pass


def fetch_day(day: date) -> str:
    body = urllib.parse.urlencode({
        "op": "kensaku_koma",
        "UseYM": day.strftime("%Y%m"),
        "UseDay": str(day.day),
        "Type": "01",
        "Mokuteki01": MOKUTEKI_TENNIS,
        "ShisetsuCode": "0",
    }).encode()
    req = urllib.request.Request(BASE_URL, data=body, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.read().decode("utf-8", errors="replace")
    except urllib.error.URLError as e:
        raise SiteError(f"取得に失敗しました ({day}): {e}") from e


def _text(fragment: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", fragment)).replace("\xa0", " ").strip()


def _hhmm(minutes: int) -> str:
    return f"{minutes // 60}:{minutes % 60:02d}"


def parse_slots(page: str) -> list[dict]:
    """空き状況ページから全コマを取り出す。

    コマの時刻は HTML に書かれていないため、セルの幅(px)を左から積算して求める。
    """
    areas = page.split('<div class="koma-area">')[1:]
    if not areas:
        hint = "WAF にブロックされた可能性があります" if "ncapsula" in page else "ページ構造が変わった可能性があります"
        raise SiteError(f"空き状況の表が見つかりません。{hint}")

    slots = []
    for area in areas:
        facility = _text(re.search(r"<h3>(.*?)</h3>", area, re.S).group(1))
        hours = re.findall(r"<th[^>]*>\s*(\d+)\s*</th>", area)
        if not hours:
            raise SiteError(f"時刻の見出しが見つかりません: {facility}")
        day_start = int(hours[0]) * 60
        rows = re.findall(r'class="name">(.*?)</td>(.*?)</tr>', area, re.S)
        for name_html, cells_html in rows:
            court = _text(name_html)
            offset_px = 0
            for width, status_html in re.findall(r'<td style="width:(\d+)px;[^"]*">(.*?)</td>', cells_html, re.S):
                span_px = int(width) + 1
                status = _text(status_html)
                if status:
                    start = day_start + round(offset_px * 60 / PX_PER_HOUR)
                    end = day_start + round((offset_px + span_px) * 60 / PX_PER_HOUR)
                    slots.append({
                        "facility": facility,
                        "court": court,
                        "start": _hhmm(start),
                        "end": _hhmm(end),
                        "status": status,
                    })
                offset_px += span_px
    return slots


def open_slot_keys(slots: list[dict]) -> list[str]:
    return [f'{s["facility"]}|{s["court"]}|{s["start"]}-{s["end"]}' for s in slots if s["status"] == "○"]


def format_message(new_by_day: dict[str, list[str]]) -> str:
    lines = ["🎾 テニスコートに空きが出ました"]
    for day_str, keys in new_by_day.items():
        d = date.fromisoformat(day_str)
        lines.append(f"\n■ {d.month}/{d.day}({WEEKDAYS[d.weekday()]})")
        by_place: dict[str, list[str]] = {}
        for key in keys:
            facility, court, hours = key.split("|")
            by_place.setdefault(facility, []).append(f"  {court} {hours}")
        for facility, rows in by_place.items():
            lines.append(facility)
            lines.extend(rows)
    footer = f"\n予約: {BASE_URL}"
    text = "\n".join(lines)
    if len(text) + len(footer) > LINE_TEXT_LIMIT:
        text = text[:LINE_TEXT_LIMIT - len(footer) - 20].rsplit("\n", 1)[0] + "\n…ほかにも空きあり"
    return text + footer


def send_line(text: str) -> None:
    token = os.environ["LINE_CHANNEL_ACCESS_TOKEN"]
    payload = {"to": os.environ["LINE_USER_ID"], "messages": [{"type": "text", "text": text}]}
    req = urllib.request.Request(
        LINE_PUSH_URL,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
    )
    try:
        urllib.request.urlopen(req, timeout=30).close()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"LINE 送信に失敗しました: {e.code} {e.read().decode(errors='replace')}") from e


def load_dates(today: date) -> list[date]:
    config = tomllib.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    dates = sorted({d if isinstance(d, date) else date.fromisoformat(d) for d in config["dates"]})
    return [d for d in dates if d >= today]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="通知も state.json の更新もしない")
    args = parser.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    now = datetime.now(JST)
    today = now.date()
    month = now.strftime("%Y-%m")
    state = json.loads(STATE_PATH.read_text(encoding="utf-8")) if STATE_PATH.exists() else {}
    prev_open: dict[str, list[str]] = state.get("open", {})
    sent = state.get("sent", {}).get(month, 0)
    notify = (lambda text: print(text)) if args.dry_run else send_line

    dates = load_dates(today)
    if not dates:
        print("監視対象の日付がありません (config.toml の dates を確認してください)")
        return 0

    curr_open: dict[str, list[str]] = {}
    new_by_day: dict[str, list[str]] = {}
    errors = []
    for i, day in enumerate(dates):
        if i:
            time.sleep(REQUEST_INTERVAL_SEC)
        key = day.isoformat()
        try:
            keys = open_slot_keys(parse_slots(fetch_day(day)))
        except SiteError as e:
            errors.append(str(e))
            if key in prev_open:
                curr_open[key] = prev_open[key]  # 取得失敗時は前回の状態を保持する
            continue
        curr_open[key] = keys
        new = [k for k in keys if k not in prev_open.get(key, [])]
        print(f"{key}: 空き {len(keys)} 件 (新規 {len(new)} 件)")
        if new:
            new_by_day[key] = new

    if new_by_day:
        text = format_message(new_by_day)
        if sent + 1 >= LINE_MONTHLY_FREE - 10:
            text += f"\n\n⚠ 今月の通知が {sent + 1} 通目です (無料枠は月{LINE_MONTHLY_FREE}通)"
        notify(text)
        sent += 1

    last_error_day = state.get("last_error_day")
    if errors:
        print("\n".join(errors), file=sys.stderr)
        if last_error_day != today.isoformat():  # 異常の通知は1日1回まで
            notify("⚠ テニスコート監視でエラーが発生しています\n" + "\n".join(errors))
            sent += 1
            last_error_day = today.isoformat()

    if not args.dry_run:
        new_state = {"open": curr_open, "sent": {month: sent}, "last_error_day": last_error_day}
        STATE_PATH.write_text(json.dumps(new_state, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
