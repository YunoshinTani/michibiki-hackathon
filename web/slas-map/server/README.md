# 学校Apacheサーバーへの配置

学校サーバーでは静的ファイルとPython CGIを使います。受信CGIは Python 2.7 系の文法に合わせています。

## 配置

VS Code で `mechatronics` フォルダーを開き、「タスクの実行」から **公開: みちびき測位モニター（学校サーバー）** を選びます。SSH 接続先は `ec36104x@yahiko.st.nagaoka-ct.ac.jp` です。タスクはホーム直下の公開ディレクトリーにある既存の `michibiki/gnss_api.cgi` を探し、見つかったサイトへ反映します。既存 CGI の Python 実行行を引き継ぎます。

自動検出できない場合は、VS Code のターミナルで実際の公開パスを指定できます。

```powershell
python web/slas-map/server/deploy.py --remote-dir /absolute/path/to/michibiki
```

### 手動で配置する場合

1. `index.html`、`app.js`、`standard.css`、`style.css`を公開ディレクトリーへ置きます。リポジトリー内のWindows用`app.py`や`.venv`はアップロードしません。
2. `server/gnss_api.cgi`を、`index.html`と同じ公開ディレクトリーへ配置します。たとえば公開パスが`/slas-map/`なら、CGIのURLは`/slas-map/gnss_api.cgi`です。別ディレクトリーへ置く場合は`app.js`の`REMOTE_CGI_URL`を変更します。
3. CGIファイルに実行権限を付け、先頭行のPython実行パスがサーバーのPython 2.7.5を指すことを確認します。サーバーによっては`#!/usr/bin/python`などへの変更が必要です。
4. ApacheのBasic認証を公開ページとCGIの両方に適用し、HTTPSで公開します。別途、サイト独自のログイン処理はありません。
5. CGI実行ユーザーがホームディレクトリー内の`~/.slas-map-gnss/`を作成・書き込みできる必要があります。既定の位置を使えない場合は、CGI環境変数`GNSS_STATE_FILE`に公開ディレクトリー外の書き込み可能な絶対パスを指定します。

## 表示と送信

学校サーバーで公開ページを開くと遠隔閲覧モードに自動で切り替わります。明示する場合はURL末尾に`?view=remote`を付けます。例: `https://学校サーバー/公開パス/?view=remote`

Windows PCでは、COM16のQZ1を接続して次のように起動します。

```bat
.venv\Scripts\python.exe send_gnss.py --url https://学校サーバー/公開パス/gnss_api.cgi?action=ingest --port COM16 --baud 115200
```

起動時に学校サイトのBasic認証ユーザー名とパスワードを入力します。CGI側の`?action=ingest`が最新状態を受信し、接続単位に記録を作成します。軌跡はJSON Lines形式で追記され、点数上限を設けません。`?action=sessions`が記録一覧、`?action=state&id=...`が選択中の状態、`?action=track&id=...&offset=...`が経路のページを返します。受信が10秒途切れると未接続として表示しますが、記録と経路は削除しません。既存の`latest.json`も初回アクセス時に「既存記録」として移行します。

保存先の`~/.slas-map-gnss/sessions/`に接続ごとの状態と追記経路が蓄積します。自動削除は行いません。長期運用ではサーバーのディスク容量を確認し、必要になったら記録削除機能や保管期限を追加してください。

## 配置時に確認する項目

- ApacheがCGIを実行でき、Python 2.7.5の実行パスが正しい。
- CGIの保存先へ書き込める。
- Basic認証とHTTPSがCGIのURLにも適用される。
- `gnss_api.cgi`の場所が閲覧ページと同じディレクトリーにある。別の場所なら`app.js`の`REMOTE_CGI_URL`を変更する。
