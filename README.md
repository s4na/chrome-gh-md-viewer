# GitHub Markdown PR Viewer

GitHubのPRから離れず、変更されたMarkdown全文をモーダルで読むChrome拡張です。

- 見出し・表・コード・画像つきでMarkdownを表示します。
- 左のディレクトリツリーで、変更された `.md` / `.markdown` を切り替えます。単独のディレクトリ階層はまとめて表示し、パスでファイルを絞り込めます。
- 初期表示は変更後の文書です。右上の「−＋ 差分」で、赤・緑の差分表示を切り替えます。
- 最大化とサイズ復元に対応し、フォルダの開閉と読んでいた位置を保ちます。
- Escで閉じ、「このファイルの差分へ戻る」からレビューを続けられます。

## インストール

Node.js 24以上を用意し、次を実行します。

```sh
npm ci
npm run build
```

Chromeの `chrome://extensions` でデベロッパーモードを有効にし、「パッケージ化されていない拡張機能を読み込む」で `dist/` を選びます。PRを開き、右下またはMarkdownのファイルヘッダーの「Markdownプレビュー」を押してください。GitHub側の表示構造によりファイルごとのボタンが見つからない場合も、右下のボタンから開けます。

CIの `chrome-gh-md-viewer` artifactも、展開して読み込めます。

## 非公開リポジトリとAPI制限

公開PRはトークンなしで利用できます。非公開PRや未認証APIの利用制限に達した場合は、拡張のアイコンから設定を開き、対象リポジトリの **Contents: Read** と **Pull requests: Read** を許可したGitHub fine-grained tokenを保存してください。fork PRの場合は取得元のリポジトリにもアクセスできる必要があります。

トークンは端末の拡張ストレージに保存し、コンテンツスクリプトからは読めない設定にしています。GitHub API以外へ送信しません。ブラウザのGitHubログインだけでAPI認証される仕組みではありません。空欄を保存するとトークンを削除できます。

## 表示と比較の仕様

PRのmerge baseとHEADのコミットを固定して全文を取得します。差分DOMやpatchの断片から文書を復元しません。追加・削除・リネーム・forkに対応し、削除ファイルは「削除前」を表示します。取得中にPRが更新された場合は再読み込みを求めます。

差分はレンダリングされた文書内に表示します。変更された文言は追加を緑、削除を赤と取り消し線で示し、段落・リスト・表・コードの変更がない部分はそのまま読めます。要素全体の追加・削除やリンク先・画像の変更は、該当する要素を色分けします。コメントなど表示結果が同じ変更は着色しません。GitHubの行コメント投稿は行わず、元のdiffへ戻る導線を提供します。GFMの表・タスクリスト・コードに対応します。Mermaidはコードとして表示します。任意のHTMLは安全化し、スクリプトや埋め込みiframeは実行しません。

相対リンク・画像は各側のコミットとファイル位置を基準に解決します。リポジトリ内の画像はGitHub APIから読み込み、非公開画像にもトークン認証を使います。外部HTTPS画像はブラウザが直接読み込みます。見出しリンクは文書内で移動し、その他のリンクは別タブで開きます。

対象は `github.com` のPRです。GitHub Enterpriseの独自ホストには対応していません。Markdownは2MB、リポジトリ画像は5MB、PRはGitHub APIの上限3,000変更ファイルまでです。エラーは空文書として隠さず、理由と再読み込みを表示します。

## 開発と検証

```sh
npm ci
npx playwright install chromium
npm run check
zizmor --offline --persona pedantic .github
```

`npm run lint` はBiomeとTypeScript、`npm test` はAPI取得・描画の単体テスト、`npm run test:e2e` は実際に拡張を読み込むChromiumテストです。E2EではGitHub APIとPRページの応答だけをテスト用に差し替え、コンテンツスクリプト・service worker・モーダルの本実装を通します。

GitHub Actionsでlint、型チェック、単体テスト、拡張ビルド、ブラウザテスト、zizmorを実行します。ActionsはコミットSHAに固定し、read-only権限と `persist-credentials: false` を使用します。
