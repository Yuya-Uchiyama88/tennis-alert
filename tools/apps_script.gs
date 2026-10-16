// Google Apps Script（ユーザーの Google アカウント上で動作）
//
// 1. triggerWatch: 時間トリガー（10分おき）から GitHub Actions の watch ワークフローを起動する。
//    GitHub の schedule は大幅に間引かれるため、こちらを主な起動手段にしている。
// 2. doPost: LINE の Webhook を受け、チャットのコマンドで config.toml の監視日を変更する。
//    ウェブアプリとしてデプロイし、その URL を LINE Developers の Webhook URL に設定する。
//
// スクリプト プロパティ:
//   GITHUB_TOKEN               fine-grained PAT（このリポジトリのみ、Actions: RW / Contents: RW）
//   LINE_CHANNEL_ACCESS_TOKEN  Messaging API のチャネルアクセストークン（長期）
//   LINE_USER_ID               自分の LINE ユーザーID（U で始まる）。これ以外の送信者は無視する

const REPO = 'Yuya-Uchiyama88/tennis-alert';
const BRANCH = 'main';
const CONFIG_PATH = 'config.toml';
const WEEKDAYS = '日月火水木金土';
const HELP_TEXT = [
  '使えるコマンド',
  '・追加 10/25（複数可: 追加 10/25 11/1）',
  '・削除 10/25',
  '・一覧',
  '・終了（すべての監視日を外す）',
  '日付は 10/25、10月25日、2026-10-25 などで指定できます。',
].join('\n');

function prop(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error('スクリプト プロパティ ' + name + ' が未設定です');
  return value;
}

// ---- 監視の定期起動 ----

function triggerWatch() {
  // 日本時間 0〜6時は1時間に1回だけ起動する
  const now = new Date();
  const hour = Number(Utilities.formatDate(now, 'Asia/Tokyo', 'H'));
  const minute = Number(Utilities.formatDate(now, 'Asia/Tokyo', 'm'));
  if (hour < 6 && minute >= 10) return;
  dispatchWatch();
}

function dispatchWatch() {
  github('post', '/actions/workflows/watch.yml/dispatches', { ref: BRANCH });
}

function github(method, path, payload) {
  const res = UrlFetchApp.fetch('https://api.github.com/repos/' + REPO + path, {
    method: method,
    headers: { Authorization: 'Bearer ' + prop('GITHUB_TOKEN').trim(), Accept: 'application/vnd.github+json' },
    contentType: 'application/json',
    payload: payload ? JSON.stringify(payload) : undefined,
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    const err = new Error('GitHub API エラー: ' + code + ' ' + res.getContentText());
    err.status = code;
    throw err;
  }
  const text = res.getContentText();
  return text ? JSON.parse(text) : null;
}

// ---- LINE Webhook ----

function doPost(e) {
  console.log('Webhook 受信');
  const events = JSON.parse(e.postData.contents).events || [];
  const owner = prop('LINE_USER_ID');
  events.forEach(function (ev) {
    if (ev.type !== 'message' || ev.message.type !== 'text') return;
    if (!ev.source || ev.source.userId !== owner.trim()) {
      // 本人以外は無視する。LINE_USER_ID の設定ミスを見つけられるよう末尾4文字だけ記録する
      console.warn('LINE_USER_ID と一致しない送信者を無視しました: ...' + String(ev.source && ev.source.userId).slice(-4) +
        ' (設定値の末尾: ...' + owner.trim().slice(-4) + ')');
      return;
    }
    console.log('コマンド受信: ' + ev.message.text);
    let reply;
    try {
      reply = handleCommand(ev.message.text);
    } catch (err) {
      reply = '⚠ エラーが発生しました\n' + err.message;
    }
    replyLine(ev.replyToken, reply);
  });
  return ContentService.createTextOutput('OK');
}

function replyLine(replyToken, text) {
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + prop('LINE_CHANNEL_ACCESS_TOKEN').trim() },
    contentType: 'application/json',
    payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: text }] }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    console.error('LINE への返信に失敗しました: ' + res.getResponseCode() + ' ' + res.getContentText());
  }
}

function handleCommand(text) {
  const words = normalize(text).split(/[\s,、]+/).filter(String);
  const command = words.shift() || '';
  const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

  if (/^(一覧|リスト|確認)$/.test(command)) {
    return '監視中: ' + formatDates(readConfig().dates.filter(function (d) { return d >= today; }));
  }
  if (/^(終了|停止)$/.test(command)) {
    updateDates(function () { return []; }, '監視を終了 (LINE)');
    return 'すべての監視を終了しました。\n再開するときは「追加 10/25」のように送ってください。';
  }
  const adding = /^(追加|登録)$/.test(command);
  const removing = /^(削除|解除)$/.test(command);
  if (!adding && !removing) return HELP_TEXT;

  if (!words.length) return '日付を指定してください。例: ' + command + ' 10/25';
  const targets = [];
  const errors = [];
  words.forEach(function (w) {
    const d = parseDate(w, today);
    if (!d) errors.push(w + ' は日付として読み取れません');
    else if (adding && d < today) errors.push(label(d) + ' は過去の日付です');
    else targets.push(d);
  });
  if (errors.length) return '⚠ ' + errors.join('\n') + '\n変更は行っていません。';

  const result = updateDates(function (dates) {
    return adding
      ? dates.concat(targets)
      : dates.filter(function (d) { return targets.indexOf(d) < 0; });
  }, (adding ? '監視日を追加: ' : '監視日を削除: ') + targets.join(', ') + ' (LINE)');

  let message = targets.map(label).join(', ') + (adding ? ' を追加しました。' : ' を外しました。');
  if (!result.changed) message = '変更はありません（' + (adding ? 'すでに監視中' : '監視していない日付') + 'です）。';
  if (adding && result.changed) {
    dispatchWatch(); // 現在の空きをすぐに通知させる
    message += '\nいまの空き状況を確認しています。空きがあれば別途通知します。';
  }
  return message + '\n監視中: ' + formatDates(result.dates);
}

// ---- config.toml の読み書き ----

function readConfig() {
  const file = github('get', '/contents/' + CONFIG_PATH + '?ref=' + BRANCH);
  const text = Utilities.newBlob(Utilities.base64Decode(file.content.replace(/\s/g, ''))).getDataAsString('UTF-8');
  const line = text.match(/^dates\s*=\s*\[[^\]]*\]/m);
  if (!line) throw new Error('config.toml に dates が見つかりません');
  return { text: text, sha: file.sha, dates: line[0].match(/\d{4}-\d{2}-\d{2}/g) || [] };
}

function updateDates(change, commitMessage) {
  for (let attempt = 0; ; attempt++) {
    const config = readConfig();
    const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    // 過ぎた日付はついでに掃除する
    const dates = unique(change(config.dates)).filter(function (d) { return d >= today; }).sort();
    if (dates.join() === config.dates.join()) return { changed: false, dates: dates };
    const line = 'dates = [' + dates.map(function (d) { return '"' + d + '"'; }).join(', ') + ']';
    const text = config.text.replace(/^dates\s*=\s*\[[^\]]*\]/m, line);
    const bot = { name: 'tennis-alert-line', email: 'Yuya-Uchiyama88@users.noreply.github.com' };
    try {
      github('put', '/contents/' + CONFIG_PATH, {
        message: commitMessage,
        content: Utilities.base64Encode(text, Utilities.Charset.UTF_8),
        sha: config.sha,
        branch: BRANCH,
        author: bot,
        committer: bot,
      });
      return { changed: true, dates: dates };
    } catch (err) {
      // 同時に別のコミットが入った場合は読み直してやり直す
      if (attempt < 2 && (err.status === 409 || err.status === 422)) continue;
      throw err;
    }
  }
}

// ---- 日付の処理 ----

function normalize(text) {
  return text
    .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); })
    .replace(/[／]/g, '/')
    .replace(/[－ー]/g, '-')
    .replace(/　/g, ' ')
    .trim();
}

// "10/25" "10月25日" "2026/10/25" "2026-10-25" を yyyy-MM-dd に。年省略時は今日以降で最も近い日。
function parseDate(word, today) {
  let y, m, d, m2;
  if ((m2 = word.match(/^(\d{4})[-\/.年](\d{1,2})[-\/.月](\d{1,2})日?$/))) {
    y = +m2[1]; m = +m2[2]; d = +m2[3];
  } else if ((m2 = word.match(/^(\d{1,2})[-\/.月](\d{1,2})日?$/))) {
    y = +today.slice(0, 4); m = +m2[1]; d = +m2[2];
    if (isoDate(y, m, d) && isoDate(y, m, d) < today) y += 1;
  } else {
    return null;
  }
  return isoDate(y, m, d);
}

function isoDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
}

function label(iso) {
  const p = iso.split('-').map(Number);
  const thisYear = Number(Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy'));
  return (p[0] !== thisYear ? p[0] + '/' : '') + p[1] + '/' + p[2] +
    '(' + WEEKDAYS[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()] + ')';
}

function formatDates(dates) {
  return dates.length ? dates.map(label).join(', ') : 'なし';
}

function unique(list) {
  return list.filter(function (x, i) { return list.indexOf(x) === i; });
}
