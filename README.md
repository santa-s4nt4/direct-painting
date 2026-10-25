# direct-painting

iPadとApple Pencilで描いた動きを、そのままTouchDesignerへ送るローカル描画ツールです。描画領域は **4K（3840 × 2160）/ 16:9の単一キャンバス**、初期表示は4K中央の **1920 × 1080**、配信も **1920 × 1080** です。旧imagraph-editorとは別のポートと保存領域で動作します。

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

映像ページはUIなしの1920×1080出力です。4Kの描画領域から編集画面と同じ範囲を表示します。表示領域が16:9以外の場合は、縦横比を保って黒い余白を付けます。`/render`、旧設定の `/left` と `/right` も同じ単一映像への互換URLです。

## UIと操作

画面上部のタイトルバーと右パネルを廃止し、**左パネル＋キャンバス**の2列にしています。左パネルのタブは次の3つです。

- **Draw**：図形、筆圧によるサイズ範囲、Blur、Pencil・タッチ入力、リリースフェードを設定します。Motionはここには置かず、キャンバス下のツールバーから切り替えます。
- **Layer**：レイヤー一覧と、選択したレイヤーの塗り・エフェクト・Analog混色・サイズ・形・開始時刻・フェード・トリムを同じタブに表示します。↑／↓で重なり順、目で表示、ゴミ箱で削除を操作します。
- **Files**：Save project、Import projectをまとめています。

**Clear canvas**とUndo / Redoは左パネル下部に固定され、どのタブを開いても、設定をスクロールしても同じ位置にあります。Undo / Redoは⌘/Ctrl+Z、⌘/Ctrl+Shift+Zでも操作できます。

キャンバス下は **Move / Line** の2ツールです。Moveは移動する図形、Lineは2点を結ぶ直線です。Trail / Returnの新規作成は廃止しました。保存済みのレイヤーは互換再生でき、旧ツール選択はMoveへ戻します。Placeとp5.jsの新規作成・編集も廃止しています。

**Ring** は円または四角形の輪郭を描く切り替えです。Shapeの **Rectangle · outline** からも選べます。四角形はRotationの **0° / 45°** プリセットと数値入力で角度を調整し、Strokeで枠の太さを指定します。Layerからも変更できます。

**Line** はペンで2点をタップします。初回は2つのRingを表示し、次の周回の **1点目に触れた時刻** に直線全体が現れます。Widthで太さ、Release fadeで表示後のフェードを調整します。1点だけの取り消しはCancel first point、完成後は通常のレイヤーとして編集・削除できます。

- **Apple Pencil pressure**：筆圧をMin〜Maxのサイズに反映します。マウスはMaxの固定サイズです。指で描く場合は **Draw with touch** をONにします。
- **Timeline**：再生／一時停止、リスタート、Duration、シークバー、時間表示をすべて横一列に配置しています。シークすると一時停止します。
- **左パネルの開閉**：キャンバス下のパネルボタンで左側を開閉し、描画面をさらに広げられます。スマートフォン幅ではパネルは引き出し式です。

キャンバスは縦・横のどちらでも1つで16:9を保ちます。編集画面・ライブ配信のフレームレートは **60fps固定** で、変更するUIはありません。

## カラーとキャンバスの拡大縮小

画面右上の **Color** ボタンで、小さな円形カラーパネルを表示・非表示にできます。円で色相・彩度、下のバーで明るさ・不透明度を設定します。Hex値の入力にも対応します。Drawでは新しいブラシ、Layerでレイヤーを選ぶとその塗り色と不透明度を編集します。グラデーションのBスウォッチを押すとB色を編集できます。

ブラシの直径と矩形の幅・高さは **最大3000px** です。DrawとLayerの両方から指定でき、Apple Pencilの筆圧範囲とJSON保存・ライブ転送にも反映します。

キャンバス上の **2本指で50%〜500%の拡大縮小・パン・ひねり回転** ができます。初期100%は4K中央の1920×1080（左上960,540）、50%は正面で4K全体を表示します。Draw with touchがOFFでも操作でき、片指を残しても線は描かれません。

左下の **回転ボックス** を1本指でドラッグすると描画面を3D空間で傾けられます。**前 / 3D / 上 / 右** の姿勢選択、X/Y/Zの角度表示にも対応します。傾いた画面でもペンの位置を逆算し、同じ地点に描きます。

キャンバス下の **− / 倍率 / ＋** でもズームでき、倍率ボタンで **100%・中央・正面** に戻ります。トラックパッドのピンチ、Ctrl＋ホイールも使えます。倍率・位置・角度は **/outputへ即時反映** し、プロジェクトにも保存します。出力は1920×1080のままです。[3Dビュー・四角形Ring・直線の操作と検証](docs/3d-tools.md)に詳細を記載しています。

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

**Files → Save project** で `direct-painting-日時.json` を保存し、**Files → Import project** で端末内のJSONファイルを読み込めます。

旧 `imagraph-project` 形式も読み込めます。左右のレイヤーを1つのキャンバスへ統合し、左右共通レイヤーは1回だけ描画します。左右別の編集があるレイヤーは独立したレイヤーに展開します。座標・サイズ・タイミングは元データの値を保持します。旧Full HDプロジェクトも100%では以前と同じ位置・大きさで表示し、旧10〜800%の表示設定だけを新しい4Kの範囲へ収めます。

## レイヤーエフェクト

エフェクトはBlurのみです。Drawタブで新しく描くブラシのBlurを設定し、LayerタブのEffectsで既存レイヤーのBlurを個別にON/OFF・半径調整できます。Glitchと色収差は廃止し、旧ファイルの該当設定は無視します。

- **Blur**：初期ON、半径 **16px**。OFFにすると元の輪郭に戻せます。

エフェクトは編集キャンバスとWeb Render TOP出力の両方に反映され、JSON保存・読み込み・Undo / Redoに対応します。元の筆跡データを変更しません。未設定のレイヤーと新規ブラシのBlurは16pxが初期値です。既存ファイルの明示的なBlur値は保持します。混色は **Analogのみ**、縁の独立した色指定は廃止し、既存ファイルの縁色も塗り色へ統一します。Previewと動画書き出し機能は廃止しました。FFmpegは不要です。

## GPU描画と3Dビュー

編集画面とWeb Render TOP向け出力は、**Three.js / WebGL2**でGPU描画します。キャンバス下の表示が **60 fps · GPU** ならGPUバックエンドが有効です。WebGL2を利用できない環境ではCPU描画へ切り替わります。

- 全画素をCPUで毎フレーム更新せず、新しく描いた部分だけをGPUへ追加します。フェード・レイヤー合成・グラデーション・混色・レイヤーエフェクトもGPUで処理します。
- 描画済みレイヤーのGPUデータを再利用します。色・エフェクト・タイミングを変更しても、同じ形の描画データは作り直しません。
- レイヤー一覧は軽い行だけを生成し、詳細UIは選択したレイヤーの分だけ作ります。描き始めの全プロジェクト即時送信も省き、入力中のローカル保存を後回しにしています。
- WebGLコンテキストが復帰すると元の描画データから再構築します。JSON保存・Undo / Redoとエフェクト設定を維持しています。

入力・レイヤーデータ・GPU処理を分離し、Three.jsのシーン、カメラ、描画テクスチャを独立させています。PerspectiveCameraと深度付きの描画面を使い、現在は3D空間内の平面へ描画します。立体ブラシや押し出しは含みません。[描画基盤の実装メモ](src/render/README.md)に構成と拡張点を記載しています。

`http://localhost:5180/benchmarks/render.html` で、CPU基準との画素比較、Blurの独立性、拡大縮小と3000pxブラシ、10レイヤー・4K描画領域とFull HD表示のGPU描画時間を測定できます。この検証ページは編集プロジェクトを変更しません。計測は描画処理の比較で、iPad実機の入力遅延や実効FPSを保証する値ではありません。

合成コピー・Blurを筆跡周辺へ絞る最適化を維持しています。以前の[Trail負荷調査](docs/trail-performance.md)は旧形式の記録として残しています。Trailの新規作成とFilesの計測入口は現在のUIから外しています。

## 設定と検証

| 環境変数 | 初期値 |
| --- | --- |
| `DIRECT_PAINTING_EDITOR_PORT` | `5180` |
| `DIRECT_PAINTING_OUTPUT_PORT` | `5181` |
| `DIRECT_PAINTING_CACHE_FILE` | `.direct-painting/loop.json` |

```sh
npm test
npm run build
npm run preview
```

ビルド確認用の編集画面は `http://localhost:4180/`、映像は通常と同じ5181です。描画済みデータはGPUキャッシュで再利用し、不要なキャッシュが大きくなった場合に古いものから解放します。

変更点・コミット別の実装内容・検証結果は[実装履歴と検証記録](docs/implementation-log.md)にまとめています。[画面と計測データ](artifacts/README.md)も参照できます。
