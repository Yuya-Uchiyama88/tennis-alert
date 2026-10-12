// Google Apps Script: GitHub Actions の watch ワークフローを外部から起動する。
// GitHub の schedule は大幅に間引かれるため、Apps Script の時間トリガー (10分おき) から呼び出す。
// スクリプト プロパティ GITHUB_TOKEN に、Actions の Read and write 権限を持つトークンを設定しておく。

const DISPATCH_URL = 'https://api.github.com/repos/Yuya-Uchiyama88/tennis-alert/actions/workflows/watch.yml/dispatches';

function triggerWatch() {
  // 日本時間 0〜6時は1時間に1回だけ起動する
  const now = new Date();
  const hour = Number(Utilities.formatDate(now, 'Asia/Tokyo', 'H'));
  const minute = Number(Utilities.formatDate(now, 'Asia/Tokyo', 'm'));
  if (hour < 6 && minute >= 10) return;

  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  const res = UrlFetchApp.fetch(DISPATCH_URL, {
    method: 'post',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
    contentType: 'application/json',
    payload: JSON.stringify({ ref: 'main' }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('GitHub の起動に失敗しました: ' + code + ' ' + res.getContentText());
  }
}
