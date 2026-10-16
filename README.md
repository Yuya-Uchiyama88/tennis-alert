# Tennis Alert

柏市公共施設予約システムのテニスコートを監視し、指定した日に新しい空き（○）が出たら LINE に通知します。
GitHub Actions 上で動くので、自分のPCを起動しておく必要はありません。

- 監視対象: システム内の全テニスコート、全時間帯
- 間隔: 6〜24時は10分ごと、0〜6時は1時間ごと（GitHub 側の混雑で数分〜遅れることがあります）
- 通知: 新しく空いたコマだけを1通にまとめて送信（LINE 無料枠は月200通）

## 監視する日付を変える

### LINE から
公式アカウントのトークに次のように送ります。

| 送る文字 | 動作 |
|---|---|
| `追加 10/25`（複数可: `追加 10/25 11/1`） | 監視日を追加し、すぐに空きを確認 |
| `削除 10/25` | 監視日を外す |
| `一覧` | 監視中の日付を表示 |
| `終了` | すべての監視日を外す |

日付は `10/25`、`10月25日`、`2026-10-25` などで指定できます。年を省略すると、今日以降で最も近いその日付になります。

### GitHub から
[config.toml](config.toml) の `dates` を編集してコミットします。GitHub のWeb画面で鉛筆アイコンから直接編集できます。

```toml
dates = ["2026-10-25", "2026-11-01"]
```

## 初回セットアップ

### 1. LINE（Messaging API）
1. [LINE Developers コンソール](https://developers.line.biz/console/) に自分の LINE アカウントでログインし、プロバイダーを作成する。
2. LINE公式アカウントを作成し、Messaging API を有効にする。
3. 「Messaging API設定」タブで **チャネルアクセストークン（長期）** を発行する。
4. 「チャネル基本設定」タブの **あなたのユーザーID**（`U` で始まる文字列）を控える。
5. 同じタブのQRコードから、その公式アカウントを自分の LINE で友だち追加する。

### 2. GitHub
1. [GitHub](https://github.com/signup) でアカウントを作成する。
2. public リポジトリを作成し、このフォルダの内容を push する。
3. リポジトリの Settings → Secrets and variables → Actions で次の2つを登録する。
   - `LINE_CHANNEL_ACCESS_TOKEN`
   - `LINE_USER_ID`
4. Actions タブ → watch → Run workflow で手動実行し、成功することを確認する。

### 3. Google Apps Script（定期起動と LINE コマンドの受付）
GitHub の定期実行（schedule）は大幅に間引かれるため、[tools/apps_script.gs](tools/apps_script.gs) を Google Apps Script に置き、
10分おきのトリガーで監視を起動しています。同じスクリプトが LINE の Webhook も受け付けます。
- スクリプト プロパティ: `GITHUB_TOKEN`（fine-grained、このリポジトリのみ、Actions と Contents を Read and write）、
  `LINE_CHANNEL_ACCESS_TOKEN`、`LINE_USER_ID`
- トリガー: `triggerWatch`、時間主導型、10分おき
- デプロイ: ウェブアプリ（実行ユーザー: 自分、アクセス: 全員）。URL を LINE Developers の Webhook URL に設定し、Webhook の利用をオン、
  LINE Official Account Manager の応答メッセージをオフにする
- コードを変更したら「デプロイを管理」→ 編集 → バージョン「新バージョン」で更新する（URL は変わらない）

## 手元で試す

Python 3.11 以上。追加ライブラリは不要です。

```bash
python watch.py --dry-run
```

```bash
python -m unittest discover -s tests
```
