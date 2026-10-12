# のりかえ

Yahoo!乗換案内の検索結果を**広告なし**で表示する、iPhone 向けの乗り換え案内です。
Safari で URL を開いて使い、「ホーム画面に追加」するとアプリのように使えます。

## しくみ

```
iPhone（このアプリ） ──▶ Cloudflare Worker ──▶ Yahoo!乗換案内
                      ◀── 経路データだけ(JSON) ◀── 結果ページ(HTML)
```

Worker が Yahoo!乗換案内の結果ページを取得し、経路・時刻・運賃・番線だけを取り出してアプリに返します。
広告やスクリプトはアプリに届きません。

## できること

- 出発・到着・経由駅、日時（出発／到着／始発／終電）を指定して検索
- 結果は「早・安・楽」、所要時間、乗換回数、運賃、番線、路線カラー、運行情報つきで表示
- 「前の時間」「次の時間」で 1 本ずつ前後の電車を再検索（出発／到着の種類はそのまま）
- 発車時刻をタップすると「前後のダイヤ」を一覧表示。駅の時刻表から普通・急行なども含めた全部の電車を出し、それぞれ目的地に何時に着くかを表示。乗換駅の時刻なら、そこから先の電車だけを変えた出発駅からの全体ルートに差し替え
- 「ほかのルートを表示」で 4〜6 件目のルートも見られる
- 📍現在地から最寄り駅を自動入力
- お気に入り区間をワンタップで検索、検索履歴
- 設定で表示順・IC/きっぷ・特急の席・歩く速さ・新幹線/特急/バス等の利用有無を変更
- Apple マップ／Google マップで開くこともできます

## URL で直接検索

```
https://norikae.<あなたのサブドメイン>.workers.dev/?from=新宿&to=渋谷&go=1
```

| パラメータ | 内容 |
|---|---|
| `from` / `to` / `via` | 出発 / 到着 / 経由 |
| `type` | `dep`（出発）`arr`（到着）`first`（始発）`last`（終電） |
| `date` / `time` | `2026-10-12` / `09:00`（省略時は今） |
| `engine` | `app`（アプリ内）`apple` `google` `yahoo`（省略時は設定のもの） |
| `go=1` | 開いたらすぐ検索 |

## 公開方法（Cloudflare Workers・無料）

1. https://dash.cloudflare.com/sign-up で Cloudflare のアカウントを作る（無料）
2. ダッシュボードの **Compute (Workers) → Workers & Pages → 作成（Create）** を開く
3. **Import a repository（リポジトリをインポート）** を選び、GitHub と連携して `norikae` リポジトリを選ぶ
4. 設定はそのままで **Deploy** を押す（ビルドコマンドは不要、デプロイコマンドは `npx wrangler deploy`）
5. 完了すると `https://norikae.<サブドメイン>.workers.dev` の URL が表示されるので、iPhone の Safari で開く
6. 共有ボタン →「ホーム画面に追加」

以後、GitHub にプッシュすると自動で更新されます。

## 開発

```sh
npm install
npm test          # パーサーのテスト
npm run dev       # http://localhost:8787 で起動
```

- `public/` … アプリ画面（HTML / CSS / JS）
- `src/index.js` … Worker（`/api/search`）
- `src/yahoo.js` … Yahoo!乗換案内の URL 生成と結果ページの解析（ページに埋め込まれた JSON を優先して読む）
- `src/timetable.js` … 駅の時刻表ページの解析

Yahoo!乗換案内のページ構成が変わると解析できなくなることがあります。その場合は `src/yahoo.js` を直してください。
個人利用を前提にしています。URL を広く公開しないでください。
