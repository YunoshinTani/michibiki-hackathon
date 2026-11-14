# yahikoサーバーへの配置

yahikoサーバーでは静的ファイルとPython CGIを使います。受信CGIは Python 2.7 系の文法に合わせています。
時刻ごとの測位情報と受信統計は、Python 標準の `sqlite3` を使い、接続記録のフォルダーに保存します。

## 配置

VS Code で `mechatronics` フォルダーを開き、「タスクの実行」から **公開: みちびき測位モニター（yahikoサーバー）** を選びます。SSH 接続先は `ec36104x@yahiko.st.nagaoka-ct.ac.jp`、公開先は `/home/ec/ec36104x/public_html/michibiki` です。パスワードを求められたら、VS Code のターミナルに SSH のパスワードを入力します。公開時は既存 CGI の Python 実行行を引き継ぎ、共通デザインの `standard.css` も配置します。

公開先が変わった場合は、VS Code のターミナルでパスを指定できます。

```powershell
python web/slas-map/server/deploy.py --remote-dir /absolute/path/to/michibiki
```

### 手動で配置する場合

1. `index.html`、`app.js`、`history.js`、`standard.css`、`style.css`、`brand-icon.png`、`favicon-32x32.png`、`brand-light.png`、`brand-dark.png` を公開ディレクトリーへ置きます。リポジトリー内のWindows用`app.py`や`.venv`はアップロードしません。
2. `server/gnss_api.cgi`を、`index.html`と同じ公開ディレクトリーへ配置します。たとえば公開パスが`/slas-map/`なら、CGIのURLは`/slas-map/gnss_api.cgi`です。別ディレクトリーへ置く場合は`app.js`の`REMOTE_CGI_URL`を変更します。
3. CGIファイルに実行権限を付け、先頭行のPython実行パスがサーバーのPython 2.7.5を指すことを確認します。サーバーによっては`#!/usr/bin/python`などへの変更が必要です。
4. ApacheのBasic認証を公開ページとCGIの両方に適用し、HTTPSで公開します。別途、サイト独自のログイン処理はありません。
5. CGI実行ユーザーがホームディレクトリー内の`~/.slas-map-gnss/`を作成・書き込みできる必要があります。既定の位置を使えない場合は、CGI環境変数`GNSS_STATE_FILE`に公開ディレクトリー外の書き込み可能な絶対パスを指定します。

## 表示と送信

yahikoサーバーで公開ページを開くと遠隔閲覧モードに自動で切り替わります。明示する場合はURL末尾に`?view=remote`を付けます。例: `https://www2.st.nagaoka-ct.ac.jp/~ec36104x/michibiki/?view=remote`

Windows PCでは、COM16のQZ1を接続して次のように起動します。

```bat
.venv\Scripts\python.exe send_gnss.py --url https://www2.st.nagaoka-ct.ac.jp/~ec36104x/michibiki/gnss_api.cgi?action=ingest --port COM16 --baud 115200
```

起動時にyahikoの公開サイトのBasic認証ユーザー名とパスワードを入力します。CGI側の`?action=ingest`が最新状態を受信し、接続単位に記録を作成します。軌跡はJSON Lines形式で追記され、点数上限を設けません。`?action=sessions`が記録一覧、`?action=state&id=...`が選択中の状態、`?action=track&id=...&offset=...`が経路のページを返します。受信が10秒途切れると未接続として表示しますが、記録と経路は削除しません。既存の`latest.json`も初回アクセス時に「既存記録」として移行します。

保存先の`~/.slas-map-gnss/sessions/`に接続ごとの状態と追記経路が蓄積します。自動削除は行いません。長期運用ではサーバーのディスク容量を確認し、必要になったら記録削除機能や保管期限を追加してください。

## iPhoneの位置をOwnTracksから送信

1. 上の「配置」のタスクで最新版をyahikoに反映します。iPhoneに [OwnTracks](https://apps.apple.com/jp/app/owntracks/id692424691) を入れ、「設定 → プライバシーとセキュリティ → 位置情報サービス → OwnTracks」で「正確な位置情報」をオンにします。Appleマップなどを併用する場合は「常に」を選びます。
2. Windowsで **みちびき測位モニター: QZ1とiPhoneを比較** タスクを起動します。Basic認証を入力し、初回送信が成功すると、今回の記録専用の `https://…/gnss_api.cgi?action=owntracks&id=…` が表示されます。
3. iPhoneのOwnTracksの接続モードを `HTTP` にし、表示されたURLを接続設定に貼り付けます。Identificationで認証を有効にし、yahikoのBasic認証ユーザー名とパスワードを入力します。Tracker IDは `IP` などに設定し、ペイロード暗号化キーは空欄にします。通信はHTTPSです。試験ごとに新しいURLを設定します。
4. OwnTracksを **Move** モードにします。歩行試験では更新の距離と間隔をそれぞれ `5 m`、`5 秒` に設定するところから始めます。手動で1点送信し、公開サイトの「測位比較」に「iPhoneの測位」と座標が出ることを確認します。試験後はOwnTracksをQuietモードに戻し、Windowsの送信を `Ctrl+C` で停止します。

VS Codeを使わずに起動する場合は、`web/slas-map` で次のコマンドを実行します。

```powershell
.venv\Scripts\python.exe send_gnss.py --url "https://www2.st.nagaoka-ct.ac.jp/~ec36104x/michibiki/gnss_api.cgi?action=ingest" --iphone
```

iPhoneの緯度・経度、測位時刻、推定精度は、対応する記録の `iphone.sqlite3` に保存します。比較にはOwnTracksの測位時刻を使います。通信の遅れで後から届いても、試験時間内のデータは元の記録に保存されます。iPhoneはGPS、みちびき、Wi-Fiなどを使って測位します。

## 配置時に確認する項目

- ApacheがCGIを実行でき、Python 2.7.5の実行パスが正しい。
- CGIの保存先へ書き込める。
- Basic認証とHTTPSがCGIのURLにも適用される。
- `gnss_api.cgi`の場所が閲覧ページと同じディレクトリーにある。別の場所なら`app.js`の`REMOTE_CGI_URL`を変更する。
