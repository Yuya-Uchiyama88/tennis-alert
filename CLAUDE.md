# Tennis Alert（柏市テニスコート キャンセル待ち通知）

## 目的
柏市公共施設予約システム（https://shisetsu-reservation.city.kashiwa.lg.jp/index.php）で、
テニスコートの空きが出たら LINE に通知する。利用目的は「テニス」固定。
ユーザーが指定した日付（単独でも複数でも可）の空きだけを監視する。

## 状況
- フェーズ: **本番稼働中**（2026-10-11 開始）。リポジトリ: https://github.com/Yuya-Uchiyama88/tennis-alert （public）
- 確認済み: GitHub Actions からサイトへ疎通OK（WAFに弾かれず）、LINE 実送信OK（10/14 を一時追加してテスト、その後削除）。
- **問題（2026-10-12 確認）: GitHub の schedule が大幅に間引かれている。** 10/11 16:43〜10/12 13:00 の約20時間で定期実行は5回のみ
  （JST 23:21, 04:05, 04:29, 08:37, 09:29。間隔 23分〜6.6時間）。実行自体は全て成功。10分間隔の想定を満たさない。
  → **対策済み（2026-10-12）: Google Apps Script の時間トリガー（10分おき）から workflow_dispatch API で起動。** スクリプトは `tools/trigger.gs`
  （ユーザーの Google アカウント上で稼働、トークンはスクリプト プロパティ `GITHUB_TOKEN`、fine-grained PAT・Actions RW・このリポジトリのみ）。
  14:32〜20:42 の38回が毎回 xx:x2:56 に起動・全成功・1回約10秒で、10分間隔を確認。GitHub の schedule は予備として残置（重複しても二重通知なし）。
  深夜0〜6時の1時間間隔（スクリプト側で制御）は未確認。PAT の有効期限切れに注意。
- 未確認: コマ時刻の実サイトとの突き合わせ。
- 運用メモ: Actions が state.json を自動コミットするので、ローカルから push する前に必ず `git pull --rebase`。
  コミット作者はリポジトリローカル設定で `Yuya-Uchiyama88@users.noreply.github.com`（メール非公開のため）。
  `gh` CLI なし。実行状況は公開APIで確認可: `curl https://api.github.com/repos/Yuya-Uchiyama88/tennis-alert/actions/runs`
  checkout は v5（v4 は Node 20 非推奨の警告が出た）。
- 直近で監視したい日: **2026-10-25（日）**（10/11時点で全コート×、空き0）

## ユーザー決定事項
- リポジトリは **public** でよい。
- 監視対象は **システム内の全テニスコート**（施設を絞らない）。
- 日付指定は **設定ファイル編集**。単独・複数の両方に対応。
- 通知は LINE。サーバーは無料・自PC常時稼働なし。
- 間隔: **JST 6〜24時は10分、0〜6時は1時間**。
- **全時間帯を通知**（時間帯フィルタなし）。
- ユーザーは **GitHub アカウント未所持**（作成は本人作業。`gh` CLI も未導入、git はあり）。

## 調査結果（実測済み 2026-10-11）
### 空き状況の取得方法
- **1リクエストで1日分・全コートが取れる。ログイン不要・セッションCookie不要**（curl単発で確認）。
  ```
  POST https://shisetsu-reservation.city.kashiwa.lg.jp/index.php
  op=kensaku_koma&UseYM=202610&UseDay=25&Type=01&Mokuteki01=007&ShisetsuCode=0
  ```
  - `Type=01` スポーツ系 / `Mokuteki01=007` テニス（008はソフトテニス） / `ShisetsuCode=0` 施設指定なし
  - 応答: UTF-8、約50KB、約0.7秒。JavaScript実行は不要（requests + BeautifulSoup で足りる）。
- HTML構造: `div.koma-area` ごとに施設。`h3`=施設名、`table.koma-table` 1つ目が時刻ヘッダ(7〜22時)、以降1テーブル=1コート。
  - コート名は `td.name a`（href に `op=daily&ShisetsuCode=..&ShitsujyoCode=..&CombiNo=..&UseDate=YYYYMMDD`）。
  - コマは `td`。文字と背景色で状態: `○`(#d1fafa)=空き、`×`(#ffe0c1)=予約済み、`保守`(#90ee90)、`抽選/締切/確認中`(#ffff66)、空白(#ffffff)=割当なし。
  - **コマの時刻は属性に無く、td の width(px) から算出が必要**（1時間=37px+罫線1px。75px=2時間、227px=6時間、50px=大津ヶ丘などの短いコマ）。
    → 幅からの換算は実装時に `op=daily` ページ（コート別日表示）と突き合わせて検証する。難しければ「何コマ目」表示にフォールバック。
- 対象施設（テニスで検索して出る11施設）: 柏ビレジ近隣センター、大津ヶ丘中央公園運動場、柏の葉庭球場、逆井運動場、しいの木台公園庭球場、新十余二第二公園庭球場、塚崎運動場、手賀の丘公園運動場、富勢運動場、中の橋運動広場、松葉第二近隣公園庭球場。
  - 柏ビレジは「A・B」「A」「B」の組合せ行があり、同じ空きが重複して出る点に注意。

### アクセス規約・間隔
- robots.txt: `Disallow: /accept.php, /language.php, /mgmt/` のみ。`index.php` は対象外。
- トップページに自動アクセス・間隔の規定なし（利用規約の専用ページは見つけていない）。
- **サイトは Imperva(Incapsula) の WAF 配下**（`visid_incap_*` Cookie）。現時点では単純な curl が通るが、
  データセンターIP（GitHub Actions）からはブロック/チャレンジされる可能性がある → **最初に Actions 上で疎通テストする**。
- 負荷: 監視日数N なら 1回の実行で N リクエスト。10分間隔・1日分なら 144リクエスト/日・約7MB/日。許容範囲と判断。
- 配慮: 複数日はリクエスト間2秒、深夜停止（既定 0〜6時 JST）、連続エラー時は停止、UAを明示、過去日は自動スキップ。

### LINE通知
- LINE Notify は 2025-03-31 終了 → **LINE Messaging API**（push）。
- 無料は **月200通**。宛先人数で数える（自分宛て1回=1通、1回に複数メッセージを入れても1通）。
- 対策: 新しく○になったコマだけ通知、1回の実行で1通にまとめる、月の送信数を state に記録し上限手前で警告。

### 無料サーバー
- **GitHub Actions schedule（public リポジトリ）**: 標準ランナー無料・分数無制限。最短5分間隔。
  - 高負荷時に遅延・スキップあり → `7-59/10` のように毎時0分を避ける。
  - public は60日無活動で schedule 自動停止 → state.json のコミットが活動になるが、無ければ月1のkeepaliveコミット。
  - Secrets: `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_USER_ID`。
- WAFで弾かれた場合の代替: Cloudflare Workers Cron（無料）、Oracle Cloud Always Free VM、最終手段は自宅PC/ラズパイ。

## 実装（現状）
```
watch.py                     # 取得・解析・差分・LINE通知を1ファイルに。標準ライブラリのみ (Python 3.11+)
config.toml                  # dates = ["2026-10-25", ...]   ※YAMLではなくTOML（pip不要にするため）
state.json                   # 実行時に生成。前回の空きコマ、月間送信数、最終エラー通知日
tests/test_watch.py          # 保存HTML (tests/fixtures/) でパーサをテスト
.github/workflows/watch.yml  # cron 2本 + workflow_dispatch、state.json を自動コミット
README.md                    # 日付変更手順、LINE / GitHub セットアップ手順
```
- 実行: `python watch.py --dry-run`（通知・保存なし） / テスト: `python -m unittest discover -s tests`
- コマ時刻: セル幅を左から積算、1時間=38px（37px+罫線1px）、見出しの最初の時刻(7時)起点。実測では全施設2時間コマ。
  `op=daily` ページはセッション必須で単発取得できず、時刻の突き合わせは未実施（見出しとの位置関係から算出）。
- 通知条件: 前回 ○ でなかったコマが ○ になった時のみ。1回の実行で1通にまとめる。○→×→○ は再通知。
  新しく追加した日付は、初回に現在の空きを全部1通で通知する。
- エラー時: 取得/解析失敗は LINE に1日1回まで通知し、exit 1（Actions が失敗扱い）。前回状態は保持。
- cron(UTC): `7-59/10 21-23,0-14 * * *`（JST 6-24時 10分間隔）、`7 15-20 * * *`（JST 0-6時 1時間間隔）。
- Secrets: `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_USER_ID`。

## 次のステップ
1. ユーザー: LINE Messaging API チャネル作成、GitHub アカウント作成（README 参照）。
2. git init → public リポジトリへ push → Secrets 登録。
3. Actions で手動実行し、**WAF に弾かれないか**と LINE 着信を確認 → 数日運用して遅延・通知数を確認。
4. WAF で弾かれたら代替基盤（Cloudflare Workers Cron 等）を検討。
