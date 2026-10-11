# Tennis Alert

柏市公共施設予約システムのテニスコートを監視し、指定した日に新しい空き（○）が出たら LINE に通知します。
GitHub Actions 上で動くので、自分のPCを起動しておく必要はありません。

- 監視対象: システム内の全テニスコート、全時間帯
- 間隔: 6〜24時は10分ごと、0〜6時は1時間ごと（GitHub 側の混雑で数分〜遅れることがあります）
- 通知: 新しく空いたコマだけを1通にまとめて送信（LINE 無料枠は月200通）

## 監視する日付を変える

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

## 手元で試す

Python 3.11 以上。追加ライブラリは不要です。

```bash
python watch.py --dry-run
```

```bash
python -m unittest discover -s tests
```
