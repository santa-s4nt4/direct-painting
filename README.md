# direct-painting

iPadとApple Pencilで描いた動きを、そのままTouchDesignerへ送るローカル描画ツールです。編集・再生・配信・動画書き出しは **1920 × 1080 / 16:9の単一キャンバス** を使います。旧imagraph-editorとは別のポートと保存領域で動作します。

## 起動

Node.js 22.12以上（または20.19以上）を使用します。

```sh
npm install
npm run dev
```

- PCの編集画面：`http://localhost:5180/`
- Web Render TOP向け映像：`http://localhost:5181/output`
- iPad：PCと同じLANにWi-FiまたはEthernetで接続し、ターミナルに表示される接続先URLをSafariで開きます。

`npm run dev` の起動時には、**Ethernet / 有線LAN** と **Wi-Fi** を区別して、IP・iPad用編集URL・Web Render TOP用URLを表示します。Ethernetで接続する場合は **Ethernet / 有線LAN** の欄にある **iPad / 編集** のURLを開いてください。Macでは実際のハードウェア名から接続方式を判定するので、en0/en1の番号に依存しません。

たとえばEthernetのIPが `192.168.0.2` の場合は、次のように表示されます。

```text
Ethernet [en0] ← Ethernet / 有線LAN
  IP:             192.168.0.2
  iPad / 編集:    http://192.168.0.2:5180/
  Web Render TOP: http://192.168.0.2:5181/output
```

EthernetにIPv4アドレスがない場合は、その旨を表示します。起動後にケーブルを接続した場合やIPが変わった場合は、`npm run dev` を再起動すると最新の接続先を確認できます。

映像ページはUIなしの1920×1080キャンバスです。表示領域が16:9以外の場合は、縦横比を保って黒い余白を付けます。`/render`、旧設定の `/left` と `/right` も同じ単一映像への互換URLです。

## UIと操作

画面上部のタイトルバーと右パネルを廃止し、**左パネル＋キャンバス**の2列にしています。左パネルのタブは次の3つです。

- **Draw**：図形、筆圧によるサイズ範囲、色、Pencil・タッチ入力、リリースフェード、プレビューを設定します。Motionはここには置かず、キャンバス下のツールバーから切り替えます。
- **Layer**：レイヤー一覧と、選択したレイヤーの塗り・縁・混色・サイズ・形・開始時刻・フェード・トリムを同じタブに表示します。↑／↓で重なり順、目で表示、ゴミ箱で削除を操作します。
- **Files**：Save project、Import project、動画形式、Export loop、完成した動画とJSONのダウンロードをまとめています。

**Clear canvas**とUndo / Redoは左パネル下部に固定され、どのタブを開いても、設定をスクロールしても同じ位置にあります。Undo / Redoは⌘/Ctrl+Z、⌘/Ctrl+Shift+Zでも操作できます。

キャンバス下の **Trail / Return / Move** で、残像、記録した線、移動する図形の3モードを切り替えます。Placeとp5.jsの新規作成・コード編集機能は廃止しました。以前保存したプロジェクト内の描画データは再生できますが、選択中ツールは現在使えるPencilモードへ戻します。

- **Apple Pencil pressure**：筆圧をMin〜Maxのサイズに反映します。マウスはMaxの固定サイズです。指で描く場合は **Draw with touch** をONにします。
- **Timeline**：再生／一時停止、リスタート、Duration、シークバー、時間表示をすべて横一列に配置しています。シークすると一時停止します。
- **Preview**：同じキャンバス上のプレビューだけをぼかします。配信と動画にはぼかしを付けません。
- **左パネルの開閉**：キャンバス下のパネルボタンで左側を開閉し、描画面をさらに広げられます。スマートフォン幅ではパネルは引き出し式です。

キャンバスは縦・横のどちらでも1つで16:9を保ちます。編集画面・ライブ配信・動画書き出しのフレームレートは **60fps固定** で、変更するUIはありません。

## TouchDesigner

Web Render TOPを1つ作り、次のように設定します。

| 項目 | 設定 |
| --- | --- |
| URL or File | `http://localhost:5181/output` |
| Output Resolution | Custom Resolution |
| Resolution | 1920 × 1080 |
| Use Global Res Multiplier | OFF |
| Active / Cook Always | ON |
| プロジェクトのFPS | 60 |

[公式Web Render TOPドキュメント](https://docs.derivative.ca/Web_Render_TOP)に基づく設定です。[TD/direct_painting.py](TD/direct_painting.py)をText DATで実行して同じ構成を作ることもできます。[接続手順](TD/README.md)を参照してください。TouchDesigner本体での実機確認は含みません。

## 保存・読み込み

編集状態はブラウザのIndexedDB（`direct-painting-cache`）と、サーバーの `.direct-painting/loop.json` に自動保存します。元ツールの `.imagraph` とIndexedDBは使用しません。外部サービスには送信しません。

**Files → Save project** で `direct-painting-日時.json` を保存し、**Files → Import project** で端末内のファイルまたは同じサーバーの最近の書き出しを読み込めます。

旧 `imagraph-project` 形式も読み込めます。左右のレイヤーを1つのキャンバスへ統合し、左右共通レイヤーは1回だけ描画します。左右別の編集があるレイヤーは独立したレイヤーに展開します。座標・サイズ・タイミングは元データの値を保持します。

## 動画書き出し

**Files → Export loop** で1920×1080 / 60fpsの1周分をサーバー側で書き出します。サーバーPCにFFmpegが必要です。macOSでは `brew install ffmpeg` で導入できます。

- **MOV · ProRes 4444 + Alpha**：透明背景とフェードを保持するMOVに加え、黒背景の確認用MP4を作ります。
- **MP4 · H.264**：黒背景のMP4を作ります。

書き出し後、Filesタブ内に動画と編集用JSONのダウンロードボタンが表示されます。左右別の動画は作成しません。同じサーバーの他の端末からも、完了後1時間まで取得できます。ループ長の上限は10分です。

## GPU描画と将来の3D対応

編集画面とWeb Render TOP向け出力は、**Three.js / WebGL2**でGPU描画します。キャンバス下の表示が **60 fps · GPU** ならGPUバックエンドが有効です。WebGL2を利用できない環境ではCPU描画へ切り替わります。

- 全画素をCPUで毎フレーム更新せず、新しく描いた部分だけをGPUへ追加します。フェード・レイヤー合成・グラデーション・混色・プレビューのぼかしもGPUで処理します。
- 描画済みレイヤーのGPUデータを再利用します。色やタイミングを変更しても、同じ形の描画データは作り直しません。
- レイヤー一覧は軽い行だけを生成し、詳細UIは選択したレイヤーの分だけ作ります。描き始めの全プロジェクト即時送信も省き、入力中のローカル保存を後回しにしています。
- WebGLコンテキストが復帰すると元の描画データから再構築します。JSON保存・Undo / Redo・60fps動画書き出しは維持しています。動画エンコードはサーバー側CPUで行います。

入力・レイヤーデータ・GPU処理を分離し、Three.jsのシーン、カメラ、描画テクスチャを独立させています。将来はカメラやメッシュを使った3D表示を追加できます。現在の操作画面は2Dです。[描画基盤の実装メモ](src/render/README.md)に構成と拡張点を記載しています。

`http://localhost:5180/benchmarks/render.html` で、既存CPU描画との画素比較と10レイヤー・1920×1080の描画時間を測定できます。この検証ページは編集プロジェクトを変更しません。計測は描画処理の比較で、iPad実機の入力遅延や実効FPSを保証する値ではありません。

## 設定と検証

| 環境変数 | 初期値 |
| --- | --- |
| `DIRECT_PAINTING_EDITOR_PORT` | `5180` |
| `DIRECT_PAINTING_OUTPUT_PORT` | `5181` |
| `DIRECT_PAINTING_CACHE_FILE` | `.direct-painting/loop.json` |
| `DIRECT_PAINTING_FFMPEG` | `ffmpeg` |

```sh
npm test
npm run build
npm run preview
```

Previewの編集画面は `http://localhost:4180/`、映像は通常と同じ5181です。描画済みデータはGPUキャッシュで再利用し、不要なキャッシュが大きくなった場合に古いものから解放します。
