# のりかえ

広告なしで使える、iPhone 向けのシンプルな乗り換え案内です。
Safari で URL を開いて使い、「ホーム画面に追加」するとアプリのように使えます。

## できること

- 出発・到着・経由駅、日時（出発／到着／始発／終電）を指定して検索
- 検索結果を開く先を選べます
  - **Apple マップ**（広告なし）
  - **Google マップ**（広告なし、日時指定にも対応）
  - **Yahoo!乗換案内 印刷版**（通常版より広告が少ない。表示順・新幹線・特急などの条件も反映）
  - Yahoo!乗換案内 通常版
- 📍現在地から最寄り駅を自動入力
- お気に入り区間をワンタップで検索、検索履歴
- オフラインでも画面を開けます（PWA）

## URL で直接検索

```
https://<ユーザー名>.github.io/norikae/?from=新宿&to=渋谷&go=1
```

| パラメータ | 内容 |
|---|---|
| `from` / `to` / `via` | 出発 / 到着 / 経由 |
| `type` | `dep`（出発）`arr`（到着）`first`（始発）`last`（終電） |
| `date` / `time` | `2026-10-12` / `09:00`（省略時は今） |
| `engine` | `apple` `google` `yahooPrint` `yahoo`（省略時は設定のもの） |
| `go=1` | 開いたらすぐ検索 |

ブックマークやショートカット App に登録しておくと「自宅へ帰る」などがワンタップになります。

## 公開方法（GitHub Pages）

1. GitHub のリポジトリで **Settings → Pages** を開く
2. **Build and deployment → Source** を「Deploy from a branch」にする
3. 公開したいブランチと `/ (root)` を選んで **Save**
4. 数分後に `https://<ユーザー名>.github.io/norikae/` で開けます
5. iPhone の Safari で開き、共有ボタン →「ホーム画面に追加」

ビルドは不要で、HTML / CSS / JavaScript だけで動きます。
