# Trace Motion・白色交点マーカー・iPad mini UI 実装計画

更新日: 2026-10-27

この文書は、別のモデルが会話履歴なしで実装を把握・継続できるように、仕様・設計判断・確認先をまとめたものです。Trace、交点表示、UI変更の初回実装は完了しています。現行コードと確認状況は第8節を参照してください。

## 1. 最初に把握すること

- 対象は、このリポジトリの既存描画アプリ。主な追加は「Trace」「白い交点マーカー」「iPad mini向け操作パネル」の3点。
- 現行の図形はCircle/Rectangle、Ring系、Line。UI上のCircleの名称はEllipseで、データ上は`circle`。
- ループは16秒固定。編集画面と`/output`は同じプロジェクト・再生状態を共有する。
- 既存Lineに「初回は通常のRing表示、次の周回からLine表示」の仕組みがある。Traceの切り替えはここを参考にする。
- 本番レンダラーは`VolumePaintingRenderer`、CPUフォールバックは`CPUVolumeRenderer`。旧レンダラーだけを変更しても本番表示には反映されない。
- 白い円は、図形の色やAnalog混色に影響されない描画が必要。
- FPS表示の移動先は左パネルの`SAVED LOCALLY`の直下。
- キャンバス下の操作パネルはiPad miniでも一列。ズーム操作の横幅を小さくしてよい。

別件の`/output`解像度対応が作業ツリーにある。1920×1080が表示領域に収まる場合はFHD、収まらない場合は1280×720に切り替える変更であり、今回も維持する。実装前に`git status`と差分を確認し、既存の変更を上書きしない。

## 2. ユーザー指定の要件

### 2.1 Trace: 最大になった図形を次の周回から一筆書きする

1. Motionに、図形の軌跡を描く機能を追加する。
2. Circle/Rectangleを最初にタッチしたときは、現在と同じように表示する。
3. 次の16秒ループからは、初回に最も大きくなった部分の図形を一筆書きで描く。
4. 一筆書きが完了する時間は初期値0.5秒。描画時間を変更できるようにする。
5. 消える時間は現在の図形と同じ扱いにし、変更できるようにする。
6. 描画の先端に直径15pxの円を付ける。
7. 先端の円は、図形の色に関係なく白色固定にする。以前の計画にあった「図形と同色」は撤回済み。
8. Ring ONでは輪郭を一筆書きする。Ring OFFでは、中心と周回中の先端を結ぶ線が通過した部分を塗り、完了時には図形全体を塗りつぶす。円は扇形、四角形は中心から各辺へ塗り進める。

### 2.2 別レイヤー間の交点に白い円を表示するモード

1. 別レイヤーの図形面が3D座標上で実際に交差・重複する箇所に、直径15pxの白い円を一時表示するモードを追加する。画面投影上だけの交差は表示しない。
2. 太いStrokeの輪郭交差を数えず、図形の面領域から交点を求める。交差を検出した時点から表示し、設定時間後に消す。
3. 交点の円は、図形の色に関係なく白色固定にする。

### 2.3 FPS表示とキャンバス下のUI

1. `60 fps · GPU`表示を`SAVED LOCALLY`の下へ移動する。
2. キャンバス下の操作パネルは横一列に並べる。
3. iPad miniのサイズでも一列に収める。
4. ズームUIは小さくしてよい。倍率の上下に＋/−を置くなど、横幅を抑える工夫をする。

## 3. 計画上の前提・未指定部分の初期案

以下は会話中の計画で採用した解釈。ユーザーが明示した要件とは区別する。実装中に解釈が結果を大きく左右する場合は、この節を見直す。

| 項目 | 初期案 |
| --- | --- |
| 一筆書きの対象 | 最大時の図形。Ring ONは輪郭、OFFは中心から輪郭までを掃く塗り。元の指の移動経路をなぞる機能ではない。 |
| 最大の判定 | Circleは直径最大、Rectangleは面積`width × height`最大。同率なら最初の時刻。 |
| 最大時の位置 | 最大になった瞬間の中心・サイズ・角度・描画平面をセットで採用する。Rectangleの幅最大と高さ最大を別々に合成しない。 |
| 最大判定に使う値 | 生の筆圧サンプルだけでなく、現行のイージング後の初回表示形状を基準にする。評価範囲は初回の描画とリリース後のイージングを含む可視期間とし、毎回再現できる方法で確定する。 |
| 開始時刻 | 次周回の、最初にタッチしたのと同じループ内時刻。3秒位置でタッチしたら次周回の3秒位置からTrace開始。 |
| 入力が16秒境界をまたぐ場合 | タッチ中は通常表示を続け、入力確定後に来る次の開始位相からTraceに切り替える。 |
| 開始点・方向 | Rectangleは図形ローカル座標の左上頂点、Circleは上端。いずれも時計回り。 |
| 進行速度 | smoothstepのイーズイン・アウトで周長上を進む。サイズに関係なく指定時間で一周する。 |
| 輪郭線幅 | Ring ONで既存のStroke設定を再利用し、編集可能にする。OFFの面には線幅を加算しない。 |
| 先端の円 | 動く描画先端に中心を置く白い塗り円。一周を描き終わった瞬間に消える。 |
| 白色 | `#FFFFFF`。図形の色・グラデーション・Analog混色で着色されない。フェードによる不透明度変化は許容する。 |
| 15pxの基準 | FHDビューポート上の画面サイズとし、720p出力では絵と同じ比率で縮小する。先端と交点で同じ表示方法にする。 |
| 交点表示の選択 | Motion内の独立した`Intersections ON/OFF`。初期値OFF。通常MotionとTraceの両方で使える全体設定とする。 |
| 交点マーカーの表示時間 | In 0秒、Hold 0.2秒、Out 0秒を初期値とし、3つの時間をUIで編集できるようにする。 |
| 交点の空間 | 投影前の3D幾何で判定する。異なる平面の面同士は3Dの交差線分、同一平面上の面同士は実際の重なり領域を対象にする。画面上だけ重なり奥行きが異なる図形は対象外。 |
| 交点の対象 | 最優先の受入対象はCircle/RectangleとTraceの描画済み経路。既存Ring/Lineにも適用する場合、外周・内周・線の中心のどれを使うかを統一してから実装する。 |
| 交点の寿命 | 交点を初めて検出したときに表示を開始し、In/Hold/Outの設定時間で消す。同じ交差が継続しても寿命を延長しない。両レイヤーの可視性・フェードを反映する。 |
| 重複・接触 | 同じ位置の交点をまとめる。接する点は1点として扱う。輪郭の完全一致や線分の共有は無数のマーカーを生成しない規則を決める。 |
| 検出から除くもの | 同一レイヤー内の自己交差、非表示・不透明度0のレイヤー、白い先端円と交点円そのもの。 |
| 白い円へのEffects | 色を固定するため図形のEffects/Analog合成後のオーバーレイを基本案とする。円自身へBlur/Motion blurをかけるかはユーザー未指定。 |
| UIの一列化の範囲 | `.canvas-controls`の操作群。タイムラインの`.loop-controls`は別の既存行として扱う想定。 |

## 4. 読むファイルと読む順番

リポジトリ全体を最初から読む必要はない。まず次の作業別の入口を読む。行番号は編集で変わるため、関数名・セレクターを目印にする。

### A. Traceの入力・最大形状・次周回への切り替え

| 優先順 | ファイル | 注目箇所・読む目的 |
| --- | --- | --- |
| 1 | [src/main.js](../src/main.js) | `pointerdown`、`point`、`samplePoint`、`cacheStroke`、`cacheLineGesture`、`animate`。入力から保存・再生へ渡る経路を把握する。 |
| 2 | [src/motion.js](../src/motion.js) | `SmoothedCircle`の`setTarget`、`update`、`displayPoint`。CircleだけでなくRectangleの幅・高さ・角度のイージングにも使われる。 |
| 3 | [src/loop.js](../src/loop.js) | `CachedGesture`、`gestureTime`、`gestureVisible`、`gestureLength`、`gestureOpacity`、trim関連。入力時間とTraceの描画時間を分離する場所。 |
| 4 | [src/line-tool.js](../src/line-tool.js) | `LineSchedule.rebase/advance`。初回表示から次周回へ切り替える既存の参考実装。 |
| 5 | [server/loop-relay.js](../server/loop-relay.js) | `revealLines`、`lineTicker`、`releasedLines`、`restartFromMidi`、POSTの古い状態の抑制。編集タブ休止中も切り替えを続ける仕組み。 |

`src/main.js`の`receiveTransport`、シーク、`#restart`、`applyProject`も切り替え状態を変更している。`LineSchedule`だけの修正で完了と判断しない。

### B. Trace描画・白色マーカー・交点検出

| 優先順 | ファイル | 注目箇所・読む目的 |
| --- | --- | --- |
| 1 | [src/render/README.md](../src/render/README.md) | 現行GPU/CPU構成、座標系、Effectsと初回Line表示の概要。 |
| 2 | [src/render/volume.js](../src/render/volume.js) | 本番GPUレンダラー。`draw`の描画ジョブ生成、3D順序、`compose`、最終表示を読む。Traceと白色オーバーレイの主な組込先。 |
| 3 | [src/render/volume-cpu.js](../src/render/volume-cpu.js) | 本番CPUフォールバック。`draw`と`polygons`。GPUと同じ進行位置・交点を使う。 |
| 4 | [src/space.js](../src/space.js) | `pointInSpace`、`projectSpace`、`planeHomography`、`clipPolygonToBox`。図形の描画平面・3D投影・ボックス外のクリップを扱う。 |
| 5 | [src/view.js](../src/view.js) | `viewRotation`、`viewHomography`。ズーム・パン・角度・遠近の共有変換。 |
| 6 | [src/render/stroke.js](../src/render/stroke.js) | `sameGeometry`、`strokeBounds`、`LiveStroke`。新しいTrace設定をキャッシュの更新判定へ含める。 |

必要に応じて次を追加で読む。

- [src/render/webgl.js](../src/render/webgl.js): Volumeの基底クラス、レンダーターゲット、マテリアル、キャッシュ管理、出力サイズ。
- [src/render/shaders.js](../src/render/shaders.js): 図形の塗り・輪郭・Analog合成。白い円をAnalog経由で合成しない設計を確認する。
- [src/render/motion-blur.js](../src/render/motion-blur.js)、[src/render/motion-shader.js](../src/render/motion-shader.js): 物体の時間サンプリング。Traceは可視経路自体が伸びるので、位置とサイズのサンプリングだけで十分か確認する。
- [src/render/camera-exposure.js](../src/render/camera-exposure.js)、[src/render/camera-view.js](../src/render/camera-view.js): Camera Motion Blurと実カメラの配置。
- [src/geometry.js](../src/geometry.js): `prepareShapeClip`、`renderSignature`、寸法編集。形状編集時のTrace再計算・キャッシュ更新に関係する。
- [src/render/index.js](../src/render/index.js): レンダラーの生成とCPUフォールバック時のcanvas置換。

### C. FPS表示とiPad miniの一列UI

| 優先順 | ファイル | 注目箇所・読む目的 |
| --- | --- | --- |
| 1 | [src/editor-shell.js](../src/editor-shell.js) | `setupEditorShell`、`sidebar-footer`、`cacheStatus`、`fps`、`canvas-controls`、`zoom-controls`。実際のDOMを組み替えている。 |
| 2 | [src/style.css](../src/style.css) | `.sidebar-footer`、`.fps-label`、`.canvas-controls`、`.canvas-tools`、`.navigation-tools`、`.view-tools`、`.zoom-controls`、`@media`。後方の上書きも含めて読む。 |
| 3 | [src/main.js](../src/main.js) | `createPaintingRenderer`の`onBackendChange`で`.fps-label`を書き換える。`syncViewUI`とズームボタンのイベントも確認する。 |
| 4 | [src/orientation-cube.js](../src/orientation-cube.js)、[src/camera-controls.js](../src/camera-controls.js) | 回転ボックス、Front、Camera modeのDOM配置。操作を失わず横幅を調整する。 |

現状の原因と注意点:

- `src/style.css`の`@media (max-width: 850px)`が`.canvas-tools`を`grid-row: 2`へ送っている。
- `@media (max-width: 1100px)`には`.view-tools .fps-label { display: none; }`がある。移動後はフッター用の表示規則を整える。
- `.canvas-controls`の指定がファイル内に複数ある。末尾へ場当たり的に追加するだけでなく、競合する指定を整理する。
- `60 fps`は現状`FPS`定数から作られる表示で、実測FPSカウンターではない。表示の移動と性能計測を混同しない。

### D. 保存・同期・互換性

| ファイル | 注目箇所・読む目的 |
| --- | --- |
| [src/project.js](../src/project.js) | `DEFAULT_SETTINGS`、`normalizeProject`、`singleCanvasProject`、JSON入出力。新しい項目の初期値・検証・旧形式の読み込み。 |
| [src/loop.js](../src/loop.js) | `validateProject`。mode・sample・duration・trimの検証が新データを受け入れる必要がある。 |
| [src/layers.js](../src/layers.js) | `EYE_FIELDS`、`editLayer`、`layerVariants`。新設定がレイヤー編集や旧左右形式の変換で落ちないようにする。 |
| [src/history.js](../src/history.js)、[src/cache.js](../src/cache.js) | Undo/Redoとローカル保存。新データを含めた往復を確認する。 |
| [src/relay.js](../src/relay.js)、[server/loop-relay.js](../server/loop-relay.js) | プロジェクト・live入力・再生状態の配信と検証。新しいmodeを増やす場合はliveの許可値も確認する。 |
| [src/output.js](../src/output.js)、[src/output.css](../src/output.css) | `/output`の受信・描画ループ・解像度切り替え。白色マーカーの設定も届くようにする。 |
| [src/canvas.js](../src/canvas.js)、[src/transport.js](../src/transport.js)、[src/timing.js](../src/timing.js) | 描画座標・FHD基準・16秒固定・60fpsの定数。 |

### 最初の調査で優先しなくてよい領域

`src/p5-*`、`src/render/vendor/`、`TD/*.toe`、過去の画像を含む`artifacts/`は今回の主な入口ではない。旧CPU実装の`src/render/cpu.js`や`src/rgba.js`も、まず本番Volumeの処理を把握してから互換性確認の必要に応じて読む。性能確認段階では`benchmarks/`を参照する。

## 5. 推奨する実装の順序

### Step 1: 仕様とデータの境界を決める

- 第3節の前提を確認し、15pxの座標基準とRing/Lineの交点対象を決める。
- ツール種別、初回プレビュー、Trace再生を分けて扱う。入力中は既存Move相当の経路を再利用する。
- データ項目の概念は、Trace選択、描画時間、最大形状、初回待ち状態、交点表示ON/OFF、交点マーカーのIn/Hold/Out時間。名称と配置は既存コードに合わせる。
- 元の`samples`と入力`duration`を保持し、Traceの描画時間を別の再生時間として管理する。入力が5秒でもTraceは設定した描画時間で終わること。
- 新しい`mode: 'trace'`を増やすか、既存MoveへTrace設定を付けるかを先に決める。現在はmodeの許可リストや`singleCanvasProject`の正規化が複数ある。

### Step 2: 最大形状と一筆書きの共通計算を作る

- `SmoothedCircle`と`CachedGesture`のイージングを基準に、最大時の形状を決定する。
- 形状から周長と経路を生成し、`progress = clamp(time / drawMs, 0, 1)`から描画済み経路と先端位置を求める。
- 計算は時間から再現可能にする。シークやループで、前フレームの描画履歴に依存しない。
- 形状・寸法・角度のレイヤー編集後は、最大形状や経路の派生データを適切に再計算する。
- `src/trace-motion.js`にGPU/CPU/UIが共有する純粋な形状・時間計算を集める。

### Step 3: 初回表示からTraceへの切り替えを通す

- `LineSchedule`を参考に共有スケジューラーを拡張し、編集画面とサーバーの双方へ組み込む。
- 待機中は既存Move相当の見た目、次の開始位相以降はTraceにする。自動切り替えで元の入力を破棄しない。
- 停止中は待機時間と描画進行を止め、再開で続ける。シーク時は位相との対応を再設定する。
- MIDI頭出し・Restartは既存Lineの規則に揃える案。入力確定済みの待機中Traceは再生状態へ進め、初回入力へ巻き戻さない。
- サーバーで切り替わった状態を、古い編集スナップショットが待機状態へ戻さないようにする。
- 待機中/切り替え済みの保存、再読込、Undo/Redoを扱う。自動切り替えは通常のユーザー編集履歴を不要に増やさない。

### Step 4: GPU/CPU描画と白色先端を追加する

- 本番Volumeレンダラーに、描画済みの輪郭と先端を組み込む。
- 輪郭は元の図形の色・既存Effects・描画平面を使う。白い円は別の合成経路にして白色を保つ。
- CPUでも共通計算による同じ輪郭・先端位置を使う。
- Traceの実効再生長は`drawMs + fadeMs`とし、`gestureOpacity`、表示判定、タイムライン、trimを整合させる。
- 3D投影、ボックスのクリップ、カメラ、Motion blur、Camera Motion Blurを確認する。

### Step 5: 交点計算と白色交点マーカーを追加する

- 両レンダラーで共通の、その時刻に表示される形状・経路一覧を作る。記録済みだけでなく描画中のlive図形も含める。
- レイヤーID、可視性、不透明度、描画済み範囲、投影・クリップを反映する。
- 外接範囲で候補ペアを絞り、その後に輪郭の交点を求める。円の投影を分割近似する場合は、ズーム後の誤差に応じて分割数を決める。
- 接点、近接した重複点、平行/共有区間を安定して扱い、フレーム間の点滅を抑える。
- 交点マーカーはオーバーレイにまとめて描き、図形の混色・色変更から独立させる。
- ピクセル読み戻しや、毎フレームの大きなCPU画像生成を交点検出に使わない。マーカーを新たな交点検出対象にしない。
- `src/intersections.js`に共通計算をまとめる。

### Step 6: UIと保存を仕上げる

- DrawにMove/Trace選択、Trace描画時間、既存Release fade、Intersections ON/OFF、交点マーカーのIn/Hold/Out時間を配置する。
- LayerでもTraceの描画時間・輪郭線幅・Release fadeを変更できるようにする。
- `.fps-label`を`sidebar-footer`内の保存状態表示の直後へ移動し、GPU/CPU/GPU pausedの更新を維持する。
- 操作パネルを「パネル/回転・カメラ操作｜図形ツール｜ズーム」の一列へ整理する。
- ズームは縦積みの`＋ / 倍率 / −`を基本案とする。狭い幅では図形ツールをアイコン中心にし、操作可能なタップ領域を確保する。
- 左パネルを除いた実際の利用可能幅に応じて調整する。画面幅だけのブレークポイントで一列化したつもりにならない。
- 新設定の初期値・入力検証・保存・インポート・Undo/Redo・配信を通す。旧プロジェクトは従来表示を既定とする。

## 6. 確認項目と関係するテスト

実装時に必要な確認を行う。実施済みのテストと範囲は第8節に記録する。

| 分類 | 受入確認 | 既存テストの入口 |
| --- | --- | --- |
| 初回表示・最大形状 | 通常表示との一致、筆圧変化、Rectangleの単一時刻での面積最大、短いタップ、長押し | [tests/motion.test.js](../tests/motion.test.js)、[tests/loop.test.js](../tests/loop.test.js)、[tests/geometry-layers.test.js](../tests/geometry-layers.test.js) |
| 周回切り替え | 次の開始位相、境界をまたぐ入力、停止/再開、シーク、MIDI、編集タブ休止、古い状態の到着 | [tests/line-relay.test.js](../tests/line-relay.test.js)、[tests/relay.test.js](../tests/relay.test.js)、[tests/midi.test.js](../tests/midi.test.js) |
| Trace再生 | 初期値0.5秒で一周、途中フレーム、イーズイン・アウト、先端と経路の接続、可変描画時間とfade、trim | [tests/trim.test.js](../tests/trim.test.js)、[tests/gpu-stroke.test.js](../tests/gpu-stroke.test.js)、[tests/spatial-volume.test.js](../tests/spatial-volume.test.js) |
| 交点 | Circle同士、Circle/Rectangle、回転Rectangle、接点、複数交点、包含、重複、live図形、fade、Traceの未描画部分 | 共通計算に対して、新たな意味のある幾何テストを追加する。 |
| 白色 | 図形の色変更・グラデーション・Analog混色後も白いこと。両マーカーの径とフェード | GPU/CPUの画素確認とブラウザーの実表示。 |
| 保存・編集 | 待機中/切り替え済みのJSON往復、旧形式、Undo/Redo、寸法変更後の再計算 | [tests/project.test.js](../tests/project.test.js)、[tests/history.test.js](../tests/history.test.js)、[tests/live-relay.test.js](../tests/live-relay.test.js) |
| UI | 保存状態直下のFPS表示、一列配置、重なり・横スクロールなし、既存操作の維持 | [tests/direct-painting.test.js](../tests/direct-painting.test.js)、[tests/camera-ui.test.js](../tests/camera-ui.test.js)と実ブラウザー。仮想DOMだけではレイアウトを保証できない。 |
| 出力・性能 | 編集と`/output`の同期、FHD/720pでの整合、代表的な複数レイヤーで交点ON時の描画時間 | [benchmarks/motion.html](../benchmarks/motion.html)、[benchmarks/volume.html](../benchmarks/volume.html)、[package.json](../package.json)の既存コマンド。 |

iPad miniでは縦向き・横向き、および左パネルの開閉を確認する。実機が使えなければ、対象端末相当のviewportとタッチ条件で確認し、実機未確認であることを報告する。FPSラベルの文字が`60 fps`であることだけで性能達成と判断しない。

関連する実行コマンドは`npm test`、`npm run build`。GLSLを変更した場合は、環境が対応していれば`npm run test:gles`や`npm run test:motion-gpu`も参照する。必要な対象を確認した後、理由なく検証を繰り返さない。

## 7. 完了時に報告すること

1. 実装したTrace・交点モード・UIの使い方と初期値。
2. 第3節で採用した前提、特に15pxの座標基準と交点対象。
3. 実際に行ったテスト・ブラウザー確認・性能計測と結果。
4. 未確認の端末や、残っている具体的な制約。

古い仕様の「先端の円は図形と同色」を実装しないこと。先端と交点の円は、どちらも白色固定という最新の指示を優先する。

## 8. 実装状況と採用した詳細

- Traceは`trace.pending`を使い、最初の周回は通常のMove、次の開始位相からは決定的なRETURN経路へ切り替える。エディターとサーバーリレーの双方でゲートを進め、Undo/Importの明示的な復元以外では古いスナップショットから待機状態へ戻らない。
- Circleは最大直径、Rectangleは単一時点の最大面積を採用する。`SmoothedCircle`と同じ60fpsイージングを入力終了後750msまで再生して比較する。Rectangleの幅・高さ・角度・位置は同じ時点の組で保存する。
- 先端と交点の白い円は直径15px。FHDビューポート上の画面サイズとして扱い、720p出力では絵と一緒に2/3へ縮小する。カメラの遠近やズームで円の表示径は変えない。
- Traceは上端/Circleまたは左上/Rectangleから時計回りに、周長に沿ってsmoothstepでイーズイン・アウトしながら描く。Draw timeの初期値は0.5秒で、Motion全体と各Layerで変更できる。線幅は記録時のStrokeを初期値にし、Layerで編集できる。Release fadeは既存の図形ごとの設定を使う。
- Intersectionsは初期値OFFの全体設定。In 0秒、Hold 0.2秒、Out 0秒で、各値はDrawパネルから編集できる。Circle、Rectangle、Ring、Rectangle Ring、Capsuleの面同士を3D座標で比較する。同一平面の重なり領域には代表点を1つ、異なる平面の交差線分にはその線分ごとに代表点を出す。線ツールは太さを交点判定に使わず、保存された3D中心線が面を横切る点または別の中心線と実際に交わる点を使う。Traceは描画済みパスの実幅を面として扱う。画面上だけの重なりは対象外。交点マーカーの合成アルファが50%未満なら描画しない。マーカーの保持位置はワールド座標で保存して現在のカメラへ再投影し、Camera motion blur合成後のシャープな画面オーバーレイとして描く。
- FPSラベルは`SAVED LOCALLY`の直下に9pxで配置する。表示値は成功した描画フレームを0.5秒ごとに集計する実測値。幅850px以下ではキャンバス下の操作群を一列に維持する。iPad mini相当の縦幅では図形ツールの文字ラベルを隠し、ズームを縦積み表示にする。MotionのMove/Traceもこの操作列から切り替えでき、サイドバー設定と同期する。
- UIの静的表示と全機能のブラウザー上の視覚確認、実機iPad miniでの計測は別に確認する。実装者の環境にない場合は、完了報告でその旨を明記する。

確認結果:

- `node --test --test-concurrency=1 tests/*.test.js`: 189 tests passed after the intersection performance and measured FPS changes. The default-concurrency `npm test` run can intermittently miss timing-sensitive camera UI / relay assertions under load; the full serial run passed.
- `npm run build`: succeeded. Vite emitted its existing warning that a minified WebGL bundle exceeds 500 kB.
- Local Chrome preview started the WebGL renderer, showed the `60 fps · GPU` status beneath `SAVED LOCALLY`, and kept the drawing tools and vertical zoom control in one row at the available desktop viewport.
- The preview was not emulated at an iPad mini viewport and no physical iPad mini was available. The <=850px CSS keeps the controls in one row, but that exact viewport and touch target fit still need device-sized visual confirmation. The preview above predates the measured FPS display added below.

実装入口の新規ファイルは[Trace計算](../src/trace-motion.js)と[交点計算](../src/intersections.js)。レンダラー接続は[GPU](../src/render/volume.js)、[CPUフォールバック](../src/render/volume-cpu.js)、[白色オーバーレイ](../src/render/webgl.js)。初回周回ゲートは[src/line-tool.js](../src/line-tool.js)と[server/loop-relay.js](../server/loop-relay.js)。ユニット確認は[Trace](../tests/trace-motion.test.js)、[交点](../tests/intersections.test.js)、[リレー](../tests/line-relay.test.js)を見る。

## 9. 交点計算の負荷と実測FPS（2026-10-27）

GPU表示中でも、3D交点計算はCPUで行う。以前の実装はTraceを多数のCapsuleへ分割した後に全組み合わせを比較し、さらに候補点ごとにパス全体を調べていた。保存済み26レイヤー・22 Traceのプロジェクトでは、13.8秒位置の交点処理に約1,208msかかった。50%未満のため画面へ出ない図形も計算していた。

`IntersectionDetector`で図形のワールド境界とTraceパッチの空間検索を使い、離れた候補を除外する。重複した直線区間は形状を変えずにまとめ、面の重なり領域を直接クリップする。図形と交点の計算結果はWeakMapで再利用し、カメラ移動だけなら再投影だけを行う。50%未満の図形は幾何計算から除外し、保持中の交点も元の図形の可視性で止める。

再現用コマンドは`node benchmarks/intersections.mjs --project .direct-painting/loop.json`。修正後のローカルCPU計測では、同プロジェクトの1ループ全体で交点処理は最大約2.7ms、95パーセンタイル約0.35msだった。これは交点処理の計測であり、GPU処理を含む最終FPSとは区別する。

`FrameRateMeter`は成功した描画回数からFPSを測定し、`SAVED LOCALLY`直下へ0.5秒ごとに表示する。同一フレームの強制再描画を重複計上せず、待機中は0、タブ復帰時は集計をリセットする。ツールチップの描画時間はCPU側の処理時間で、GPU同期を強制する計測は追加しない。

## 10. GPU負荷と輪郭の改善（2026-10-31）

### 実装内容

- Volumeのレイヤー合成で、直前に書き換わった画面上の領域だけをコピーする。フレーム開始時の初期化を保ち、シーク・巻き戻し時も古い領域を残さない。
- 最初の図形、画面上で他の図形と重ならない図形、mixAmount=100は、同じ結果になる通常のsource-overで直接描画する。
- 画面外の図形を除外し、Gaussian Blurの各パスも投影範囲と必要な余白に限定する。未使用のBlur用ターゲットは起動時に確保しない。
- 図形の外接範囲が3Dボックス内に完全に収まる場合、Camera Motion Blurのサンプルごとのワールド座標変換・境界判定を省く。
- Normal/Analogのレイヤー入力を共有し、カメラの逆行列などを同じ図形について二度準備しない。
- GPUのTraceを、Circleの円弧／Rectangleの4辺を数式で描く方式に変更する。進行中・完了後ともTrace用マスクを確保せず、点の塗り重ねも行わない。CPUと交点計算は共通のサンプル経路を引き続き使う。
- 輪郭の透明度を`fwidth`で約1画素幅に調整する。解像度の引き上げや、AA専用の全画面パス・バッファは追加しない。途中の円弧は、線の届かない内側・外側を先に除外する。
- Traceの座標を小数で保持する。最終カラー画像の縮小には線形補間を使い、時刻をRGBに保存している旧マスクの補間方法は維持する。
- 追従円は描画完了時に消える。交点円の3D判定・白色・タイミング・50%閾値と、シャープなオーバーレイ描画は維持する。

### 重点的に読むファイル

| ファイル | 確認する処理 |
| --- | --- |
| `src/render/volume.js` | 画面上の範囲、合成バッファの同期、通常合成の適用条件、Blur範囲、TraceのGPU入力 |
| `src/render/shaders.js` | 1画素幅のcoverage、円弧と端点、矩形の線分、カラー合成 |
| `src/render/motion-shader.js` | Camera/Object Motion Blur中のcoverageとボックス判定の省略条件 |
| `src/render/camera-exposure.js` | カメラ露光全体と単一平面の投影範囲 |
| `src/trace-motion.js` | eased progress、GPU向け形状、CPU/交点向けの小数サンプル、追従円の終了 |
| `benchmarks/gpu-load.js` | 全画面参照との比較、Canvas参照、GPU時間とCPU投入時間の分離、GPU処理量の計測 |

ブラウザーでは`/benchmarks/gpu-load.html`から、保存中のプロジェクトに触れずに確認できる。GPU時間は非同期のtimer queryが利用できる場合に計測し、通常描画やFPS表示にはGPU待機処理を追加しない。実行結果と計測上の制約は検証成果物に記録する。

### 検証結果

Apple M4 / Chrome WebGL2（ANGLE Metal）、1920×1080。基準コミット`13c6873`と変更後を同じWebGLコンテキストで交互に実行し、それぞれ20フレームの準備後に32回計測した。CPUの投入時間ではなく、非同期GPU timer queryによる経過時間の中央値を比較した。

| 10レイヤーの条件 | 変更前GPU ms | 変更後GPU ms | 1フレームのコピー画素数（前→後） |
| --- | ---: | ---: | --- |
| 重なるRing | 15.30 | 11.28 | 1,866万→576万 |
| Gaussian Blur付きRing | 40.22 | 24.17 | 1,996万→692万 |
| 離れた小さな図形 | 10.14 | 2.62 | 1,866万→0 |
| Camera Motion Blur付きRing | 51.69 | 45.25 | 1,866万→593万 |
| 完了後のTrace | 12.88 | 9.19 | 1,866万→335万 |
| 描画途中のTrace | 9.40 | 6.28 | 1,866万→335万 |

Trace 10本のマスク常駐量は約15.1MBから0へ減った。Blurを一度も使用していない場合、約9.3MBの作業用ターゲットも確保しない。Blur使用後の作業用ターゲットは再利用のため保持する。

このMacでは他のアプリケーションも同じGPUを使用しているため、絶対時間には変動がある。全条件で60fpsになる保証や、M4 MacBook Airの消費電力・温度の測定値ではない。計測方法、CPU投入時間、各サンプルの統計は[検証JSON](../artifacts/gpu-optimization-2026-10-31.json)を参照。

- Nodeの既存189件が成功。共通Trace/交点の14件も最終状態で成功。
- 新しいブラウザーの13項目が成功。全画面参照との比較は、混色・Blur・Camera exposure・画面外・巻き戻しで最大チャンネル差0。
- Circle/Rectangle TraceはCanvasの独立した線描画と比較し、輪郭を除いた不一致0、GPUマスク追加0。Camera exposureも独立した各視点の平均と一致することを確認。Circleの境界のみ最大6/255、全体RMSは0.014/255未満。
- 描画完了の直前は追従円の白画素255、完了時には0であることをGPU画素で確認。
- 既存のVolumeブラウザーチェック15項目、GLSL ESのNormal/Analog両経路、プロダクションGLSLの17ケース、production buildを確認。

## 11. MIDIカメラ切り替え時の瞬間的なFPS低下（2026-10-31）

ユーザーが症状を確認したのは、カメラ移動・MIDI切り替え時。保存設定は200msの移動、Camera Motion Blur ONだった。前回のGPU最適化後のコードを基準に、急なカメラ移動を追加で調べた。

### 修正

- カメラ移動中、静止したCircle/Ringと描画完了後のCircle Traceを画面上の二次曲線で判定する。従来の「各画素×最大16視点で3D平面へ逆変換する処理」の割り算・座標変換・サンプルごとの色計算を減らす。
- 視点数・シャッター時間・出力解像度を維持する。元の16視点をすべて平均し、不透明度と描画色も保つ。新たなGPUバッファや全画面パスは追加しない。
- 原点を投影された円の中心へ移し、薄い輪郭でのfloat32の桁落ちを抑える。係数は既存の`cameraInverse`のuniform領域を再利用する。
- 図形全体が3Dボックス内に収まり、露光中の形状が同じ場合だけ適用する。ボックスで切れる形状、描画途中のTrace、Rectangle、移動する図形には従来の経路を使う。
- Analog混色・コピー用シェーダーを起動時に準備し、既存の透明な1×1ターゲットで一度描画する。ANGLE/Metalが初回描画まで遅らせる準備も、再生開始前に済ませる。
- 複数レイヤーのプロジェクトでは合成用の2枚目のターゲットをプロジェクト更新時に初期化する。カメラを回して初めて図形が重なるフレームで、シェーダー作成やテクスチャ確保を発生させない。Blur用バッファは必要になるまで確保しない。

### 読むべきファイルと確認方法

- `src/render/camera-exposure.js`: `cameraCircleConic`。逆射影行列から、画面上の円の二次式と投影中心を求める。
- `src/render/motion-shader.js`: `cameraConicCount`で選択する経路。16視点の平均と境界のcoverageを確認する。
- `src/render/volume.js`: 適用条件、行列uniformの再利用、起動時のシェーダー準備、合成ターゲットの初期化。
- `tests/camera-motion.test.js`: orbit・zoom・perspectiveを通じて元の円からの距離が一致することを独立した射影計算で確認する。
- `/benchmarks/gpu-load.html`: 最初の重なりで新規program/textureが0であること、従来の逆射影を使う参照画像との比較、200msの急なカメラ移動のGPU時間を確認する。

### M4での比較

前回の最適化後のコードと今回の変更後を、同じChrome WebGL2（ANGLE Metal）のコンテキストで交互に32回ずつ測定。GPU時間は非同期timer queryで取得した。GPUを他のアプリケーションと共有しているため、絶対値には変動がある。

| 条件 | GPU中央値 前→後 | GPU p95 前→後 |
| --- | --- | --- |
| 1400pxの完了済み円Trace ×4、200msのMIDI orbit | 32.48→8.09ms | 81.29→22.85ms |
| 同じ円Trace ×8 | 67.60→19.98ms | 112.08→35.38ms |
| 保存済み11レイヤーのプロジェクト、6350ms位相 | 6.51→5.62ms | 7.45→6.45ms |

最初の重なりの別測定では、CPU時間が32.2→1.8ms、新規program数が1→0、新規texture数が1→0になった。円Trace・Circle・Ringの新経路と逆射影参照の画素差は最大1/255で、16視点を維持している。ボックスで切れる円は従来の経路を使い、参照との差は0だった。

8本の大きな円では修正後も16.7msを超えるため、この最適化だけで常時60fpsを保証するものではない。計測JSONにはCPU投入時間、GPUの最大値、適用されたレイヤー数と検証結果を記録する: [camera-stutter-2026-10-31.json](../artifacts/camera-stutter-2026-10-31.json)。

検証はNode 190件、GPU負荷・輪郭ブラウザーチェック18項目、既存Motion Blurブラウザーチェック16項目、GLSL ESの2経路、ネイティブGLSLの17ケース、production buildが成功。最終の`/benchmarks/gpu-load.html`には200msのカメラ切り替えの計測欄も追加した。

## 12. Web描画の上限を30fpsへ変更（2026-10-31）

表現として30fpsのコマ感を採用し、編集画面と`/output`の描画上限を30fpsに変更した。

- `src/timing.js`の`RENDER_FPS=30`と専用の`renderFrameNumber`で表示頻度を制限する。
- 入力・ライブ同期の60Hz基準と、既存の16.7msのMotion/Camera Motion Blurシャッターを分ける。ループは16秒、Trace描画は既定0.5秒、カメラ移動・交点のIn/Hold/Outも実時間で進む。
- エディターの入力・UI・MIDIイベントは次のRAF描画を要求する。即時再描画の経路で上限を超えないようにする。ペンの入力とlive状態の更新は待たせない。
- 出力側は、state/live/view/cameraの更新で表示が無効になっても、描画レートの制限をリセットしない。
- 保存状態直下の表示は引き続き実測FPSで、30を固定表示するものではない。TouchDesigner側が60fpsの場合もWeb由来の絵の更新は最大30fpsになる。
- `tests/timing.test.js`、`tests/camera-ui.test.js`、`tests/output-timing.test.js`で、60/120/144Hz画面や頻繁な入力・カメラ更新下でも30fpsに収まり、再生時間が半速にならないことを確認する。

関連テスト31件とproduction buildが成功。実際のChrome WebGL2で`/output`を計測したところ、1101.6msに33回、実測29.96fps、描画間隔33.2〜33.4msだった（1280×720出力）。[計測JSON](../artifacts/web-30fps-2026-10-31.json)。

## 13. 指の3D操作とPencilの同時入力・連続タップ（2026-10-31）

### 原因と修正

- 回転ボックスのSVG子要素から伝わる`lostpointercapture`までドラッグ終了としていた。子要素の通知と、ルートがまだキャプチャを保持している古い通知は無視し、実際の解放だけを終了として扱う。
- キャンバスの2本指操作への切り替えが、Pencilのストロークも終了させる場合があった。取り消す対象を指の描画に限定し、Pencil描画中の追加の指接触はキャンバス操作へ登録しない。回転ボックスの指は独立して動かせる。
- 入力の所有権を`pointerId`・`pointerType`・開始時刻で確認する。同じIDを再利用する連続タップでも、前の接触の通知や別の入力装置による終了を受け付けない。
- 新しいPencil接触で前の終了通知が抜けた状態から復帰する。押下中の移動から開始通知の欠落を、hoverへの移行から終了通知の欠落を回復する。キャプチャを取得できなかった場合にも、document上の終了通知で後始末する。
- 完了図形の送信は、更新のたびに100msの待ち時間を延長するdebounceから、100msごとに最新状態をまとめる方式へ変更する。連続タップ中も出力を更新し、同時送信は1件に保つ。
- 描画中の作業平面と30fps上限は維持する。次のPencil接触は、その時点のカメラの向きに合わせた平面から始める。

### 重点的に読むファイル

| ファイル | 確認する処理 |
| --- | --- |
| `src/pointer-input.js` | 接触の所有権、Pencilの押下判定、キャプチャの取得・解放、古い解放通知の除外 |
| `src/main.js` | `startStroke`・`endStroke`、Pencil優先、欠落通知からの復帰、指の描画からピンチへの切り替え |
| `src/orientation-cube.js` | 指の独立したキャプチャ、SVG子要素からの通知、要素外での移動・終了 |
| `src/view.js` | `PinchGesture.reset`によるPencil開始時のキャンバス指操作の解除 |
| `src/relay.js` | `createPublisher`の送信間隔とsingle-flight・最新状態の後続送信 |
| `tests/camera-ui.test.js` | 同時操作、同一IDの20連続タップ、手のひら、古いキャプチャ通知、通知欠落と要素外の解放 |
| `tests/publisher.test.js` | 連続更新中の定期送信、通信中の最新状態への集約 |

### ブラウザー確認

Chrome WebGL2で1133×744のタッチ対応viewportを使い、CDPからブラウザーのtouch/pen入力を送信した。左指で回転ボックスを押し続け、同じPencil IDで20回連続タップして各接触が1レイヤーずつ確定すること、追加の2接触でPencilが終了しないこと、Pencilを押したまま全ての指を離しても描画が続くことを確認した。10回目までに出力側へ9レイヤーが反映され、終了後は追加の1接触を含む21レイヤーが重複なく一致した。

これはブラウザーに入力を注入した検証で、実機iPad / Safari・Apple Pencilは未確認。SVG子要素からのキャプチャ解放や通知欠落は、上記の回帰テストでも確認する。[検証JSON](../artifacts/pointer-input-2026-10-31.json)。

`node --test --test-concurrency=1 tests/*.test.js`は197件成功。`npm run build`と`git diff --check`も成功した。ビルドには既存の500kB超のWebGLバンドル警告がある。

## 14. Ring OFFの塗りTraceとMIDI受信表示（2026-10-31）

### Traceの表示

- 最初の16秒周回のMoveと、次の同じ位相でTraceへ切り替えるゲートは維持する。
- Trace ON・Ring OFF（`circle` / `rect`）は、最大時の図形の中心と、時計回りに輪郭上を進む先端を結ぶ線で面を掃く。円は上端から扇形、四角形は左上から各辺に沿って塗る。矩形は角速度ではなく周長に沿って進める。
- Ring ON（`ring` / `rect-ring`）は従来どおり輪郭を描く。`trace.sourceShape`と保存された`shape`から表示を判定し、旧保存データの塗り図形も新しい塗りTraceとして再生する。JSON形式の追加は不要。
- どちらも既定0.5秒、smoothstep、既存のRelease fade、固定白色15pxの先端円を維持する。先端は一周の完了時に消える。
- GPUでは図形のcoverageと2つの半平面で掃いた面を判定する。追加のGPUマスク、テクスチャ、全画面パスは作らない。完成した円の塗りTraceもCamera Motion Blurの二次曲線による高速経路を使う。
- CPU描画と3D交点判定は、円を最大2つの凸な扇形、矩形を最大4つの三角形として同じ塗り面を扱う。塗りTraceの交点にStrokeの幅を加算しない。LayerのTrace Stroke入力は塗り図形では無効にする。

### MIDI受信ボックス

- キャンバスの外側、左横に白い枠を受信順に上から最大10個並べる。ノート番号を小さく表示し、同じ番号はチャンネルが異なっても同じ枠で点灯する。
- Note On（velocity > 0）の受信時に80msだけ白く塗り、フェードなしで透明へ戻す。Note Offで点灯を保持しない。再受信はその枠の80msを更新し、並び順は変えない。
- 11種類目の新しい番号は、最も古く追加した枠を取り除いて末尾へ追加する。表示履歴はページ内だけに保持する。
- サーバーのMIDI受信コールバックから`midi`イベントをSSEで送る。1秒ごとのデバイス情報ポーリングを待たず、Camera modeやプロジェクト読み込み状態に依存しない。epoch/revisionで重複した古いイベントを除外する。
- キャンバス左に32pxの余白を確保し、10個の高さはキャンバス内の高さに合わせる。描画や指操作の上に受信ボックスを重ねない。

### 重点的に読むファイル

| ファイル | 確認する処理 |
| --- | --- |
| `src/trace-motion.js` | `traceIsFilled`、周長に沿った正確な先端座標、`traceFillPolygons`、GPU向け`traceVisual` |
| `src/render/shaders.js` | `sweepCoverage`、Stroke=0の塗り面、円と矩形の先端方向 |
| `src/render/volume.js` | 塗りTraceの入力と完成した円の高速Camera Motion Blur経路 |
| `src/render/volume-cpu.js` / `src/intersections.js` | 描かれた面だけの描画と3D交点判定 |
| `server/loop-relay.js` | `receiveMidiNote`、即時のSSE送信、既存カメラへの受信通知 |
| `src/midi-panel.js` / `src/midi-indicators.js` | SSE受信、10枠の管理、80msの点灯と後始末 |
| `src/main.js` / `src/style.css` | エディターへの接続、Stroke入力の無効化、キャンバス左横の配置 |
| `tests/trace-motion.test.js` / `tests/intersections.test.js` | 塗り面の面積、回転、周回ゲート、未描画部分・Stroke幅・別平面の除外 |
| `tests/midi-indicators.test.js` / `tests/midi.test.js` | 即時点灯と再受信、10枠上限、SSE、Camera modeからの独立 |
| `benchmarks/gpu-load.js` | 塗り／輪郭をCanvasの独立したパスと比較し、カメラ露光とマスク追加0を確認 |

### 検証結果

- Nodeの全204件、production build、GLSL ESのNormal / Analog両経路が成功。ビルドは既存の500kB超バンドル警告のみ。
- Chrome WebGL2の描画チェック23項目が成功。円／矩形の塗り・輪郭ともCanvas参照との内側の不一致0、追加GPUマスク0。塗りTraceのカメラ露光は独立した各視点の平均と最大1/255の差。CPUフォールバックも円／矩形の途中・完了の4ケースでGPUとの内側の不一致0。
- 独立したテスト用サーバーのMIDI受信コールバックからSSEを送信し、実ブラウザーで即時点灯、80ms後の消灯、再受信時の同じ枠、10個の上限を確認した。
- 1133×744、744×1133（iPad mini相当の横／縦）、375×667のタッチviewportで、10枠全てがキャンバスの左外側に収まり、ページに横スクロールが出ないことを確認した。実機iPad / Safariと物理MIDI機器は今回未確認。
- 詳細: [検証JSON](../artifacts/trace-fill-and-midi-2026-10-31.json)、[横向きUI](../artifacts/midi-indicators-landscape.png)、[縦向きUI](../artifacts/midi-indicators-portrait.png)。

## 15. Draw timeとRelease fadeのデフォルト（2026-10-31）

Draw timeとRelease fadeの初期値を両方0.5秒に揃える。Draw timeの`traceDurationMs=500`は維持し、Release fadeは`src/loop.js`の`DEFAULT_FADE_MS=500`を`src/project.js`の初期設定、Drawの数値・スライダー、Layerの未設定値の表示で共有する。保存済みプロジェクトやレイヤーに明示された時間は引き続きその値を使う。

## 16. キューブを越える描画と負荷の維持（2026-10-31）

### 原因と変更

キューブの外側で、`startStroke` / `samplePoint`が入力を捨て、保存時の検証でも3D座標を拒否していた。GPUの通常描画とCamera Motion Blur、CPUポリゴン、先端円、交点にも別々のボックス制限があった。

- 3840×3480×3480のボックスは位置のガイドとして残す。新規の描き始め・移動、図形の外周、塗り／輪郭Trace、Line、交点をガイドの外側でも扱う。入力とファイルは有限の座標を検証し、NaN / Infinityは引き続き拒否する。
- GPUからボックス境界での切り取りと、そのためのワールド座標変換・境界判定を削除する。Circleの高速Camera Motion Blur経路はガイド外でも使える。
- 画面上の範囲は平面のhomographyを再利用して四隅から求め、画面外の図形とコピー／Blurの不要領域を引き続き除外する。通常時はボックス6面のクリッピングや、頂点ごとのワールド座標への再変換を行わない。
- カメラのnear / far面を跨ぐときだけ、透視除算前の座標をクリップする。Camera Motion Blurではその場合だけ逆行列の同次座標を`1 / cameraDepth`に正規化し、追加のワールド座標計算なしで隠れたサンプルを除外する。カメラの背後の図形や白い円を反転表示しない。
- CPUの輪郭Traceも固定サイズのビットマップからベクトル描画へ変更する。同一直線上の区間をまとめ、Capsuleをnonzero windingで一度に塗り、重なりが穴にならないようにする。投影行列は図形のサンプル内で共有する。旧Trail / Returnのビットマップ互換データは従来のラスタ範囲を維持する。
- FHDの作業バッファ、FHD / 720p出力、30fps上限、最大ブラシサイズ、ループ時間は維持する。新しいGPUターゲット、Traceマスク、全画面パスは追加しない。ガイド自体や、ズーム・パン操作の範囲は変更しない。

### 読むファイル

| ファイル | 変更箇所 |
| --- | --- |
| `src/main.js` | `startStroke` / `samplePoint`の有限値チェック、ガイド表示、実際のViewサイズ表示 |
| `src/loop.js` | ボックス外のサンプル・平面原点・Lineの3D終点の保存検証 |
| `src/space.js` / `src/view.js` | `projectPlanePolygon`、`projectVisibleSpace`、共通のcamera near / far |
| `src/render/camera-exposure.js` | 行列共有による投影範囲、必要時だけの同次座標正規化 |
| `src/render/volume.js` / `src/render/motion-shader.js` | ボックス境界判定の削除、ガイド外の二次曲線経路、深度を跨ぐ場合の除外 |
| `src/render/volume-cpu.js` | ガイド外のベクトル／Trace、ポリゴン間の投影行列共有 |
| `src/intersections.js` | 実際の図形面を使い、ボックスで交差線分を切らない。カメラの可視範囲だけへ再投影 |
| `tests/spatial-volume.test.js` / `tests/camera-ui.test.js` / `tests/intersections.test.js` | ガイド越えの入力・開始・JSON／live／出力、交点、near / farと背後の除外 |
| `benchmarks/gpu-load.js` | ガイド外の8組のGPU／CPU対Canvas比較、near面を跨ぐカメラ露光、背後の描画除外 |

### 性能と検証

基準コミット`bc073e6`と変更後を、Apple M4 / Chrome WebGL2（ANGLE Metal）の同じコンテキストで交互に32回ずつ計測した。GPU時間は非同期timer query、CPUは描画投入時間。各ケースは16フレーム準備後に測定し、既存の保存プロジェクトは読み取りだけに使った。

| 条件 | GPU中央値 前→後 | CPU中央値 前→後 |
| --- | --- | --- |
| 重なるRing 10個 | 4.55→4.44ms | 0.90→0.90ms |
| 完成した円Trace 4本・Camera Motion Blur | 14.79→14.45ms | 1.40→1.00ms |
| 保存済みプロジェクト・6350ms | 1.35→1.32ms | 1.00→0.90ms |
| ガイド外の円8個を表示 | 0.93→2.59ms | 0.40→0.70ms |

最後のケースは、旧版では切り捨てていた絵を新たに表示するため、描画する画素が増えた分の処理がある。全ケースで作業バッファは1920×1080、Traceマスクの常駐量は前後とも0。共有GPUの測定値には変動があり、常に負荷が増えないことやM4 MacBook Airの消費電力を保証するものではない。

- 最終のNodeテスト207件、production build、GLSL ESのNormal / Analog両経路、ネイティブGLSLの17ケースが成功。
- Chrome WebGL2の描画チェック33項目が成功。ガイド外のCircle / Ring / Rectangle / Rectangle Ringについて、通常／Traceの8組すべてでGPUとCPUの描画内部がCanvas参照と一致した。追加Traceマスクは0。
- near面を跨ぐCamera Motion Blurと、各視点を独立して描画した平均のRMS差は0.119/255、最大差6/255。カメラの背後は描画0。
- エディターの回帰テストでは50%・yaw 90°で、入力途中にガイドを越える操作と、外側から描き始める操作を追加し、保存と出力リレーへの反映を確認した。
- 実機iPad / Safariの確認、MacBook Airの温度・消費電力の計測は未実施。[検証と性能JSON](../artifacts/unbounded-drawing-2026-10-31.json)。

## 17. Trace先端の白点の連続感（2026-10-31）

### 原因と表示

30fpsで既定0.5秒のTraceを表示すると、一周の白点位置は約15回の更新になる。従来は現在位置に15pxの円を1個だけ描いていたため、大きな図形や速いTraceでは白点が大きく離れて見えていた。

- 30fpsとDraw timeを維持し、直近1表示フレーム分の輪郭上の移動を薄い白い点で密に補間する。先端は不透明、後方は二乗カーブで透明へ落とし、短い白い軌跡としてつなぐ。
- Circleは画面上のカーブとの差が0.4px以内になるように分割する。Rectangleは辺の境目を必ず挟み、角を対角線でショートカットしない。補間点の間隔はFHD座標で約3.75px。同じ接続位置の重複点も除く。
- 現在のカメラのhomographyで全点を投影する。過去のカメラ姿勢やフレーム画像は保持せず、Camera Motion Blurを白点に追加しない。交点の円は補間対象に含めず、従来の白い15pxの円とタイミングを維持する。
- フレームが短く欠けた場合は、source phaseと実時間の増分が一致する100ms以内の範囲だけ補う。シーク・逆再生・周回リセット・長い休止では既定の1フレームへ戻す。描画完了後は白点と補間軌跡を即座に消す。

### 負荷を抑える処理

- 既存の白いマーカーを描く1回のGPU描画へまとめる。追加の画像用バッファ、テクスチャ、全画面パスは作らない。
- 同次座標の段階でカメラの背後やnear / far外を除外し、画面外の線分を切ってから補間点を作る。1本あたりの補間点数は最大256で、上限時は先端に近い区間を優先する。
- 既存のマーカー用position/alpha配列だけをプロジェクト更新時に予約する。拡張時には古いGPUストレージを解放し、各点を書き込むための一時配列や重複したマーカーオブジェクトを作らない。容量は再利用する。
- CPUフォールバックも共通の投影済み補間点を使う。描画色や保存フォーマット、ループ時間の変更はない。

### 読むファイル

| ファイル | 確認する処理 |
| --- | --- |
| `src/trace-motion.js` | `traceHeadMarkers`、カーブ分割・矩形の角・画面クリップ・点数上限、`traceHeadFrameWindow`の欠落フレームと不連続の扱い |
| `src/render/volume.js` / `src/render/volume-cpu.js` | 現在の位相と描画時刻、レイヤー不透明度、共通の白点オーバーレイ |
| `src/render/webgl.js` | `reserveOverlayMarkers`、既存バッファの予約・拡張時の解放、1回の描画と一時配列を作らないアップロード |
| `tests/trace-motion.test.js` | 30fps間の連続性、矩形の角、ズーム時の上限、カメラ後方、完了・シーク・周回時のリセット |
| `benchmarks/gpu-load.js` | 形状と白点を独立に検証。白点の画素上の隙間0、GPU/CPU、描画回数、15px交点、完了時の消失 |

検証と変更前後の計測は[JSON](../artifacts/trace-head-continuity-2026-10-31.json)、白点の見た目は[比較画像](../artifacts/trace-head-continuity.png)を参照する。30fpsそのものの時間分解能を上げる変更ではなく、短い軌跡で連続感を補う方式。実機iPad / SafariとMacBook Airの温度・消費電力は今回未確認。

### 検証と性能

全211テスト、production build、Chrome WebGL2の36項目が成功。白点の移動区間を画素で調べ、GPU / CPUとも隙間0を確認した。通常のCircle / Rectangle、塗り／輪郭Trace、ガイド外、カメラ露光、完了時の白点消失、交点の15px円も確認する。形状と補間オーバーレイは独立した検証に分ける。

`1471b89`との比較は、Apple M4 / Chrome WebGL2（ANGLE Metal）の同じコンテキストで、16フレームの準備後、前後を交互に32回ずつ測定した。GPUは非同期timer query、CPUは描画投入時間。比較中にエディターの保存状態は書き換えない。

| 白点10個を同時表示する条件 | GPU中央値 前→後 | CPU中央値 前→後 |
| --- | --- | --- |
| 円Trace | 4.10→4.12ms | 0.60→0.90ms |
| 矩形Trace | 4.65→5.01ms | 0.60→0.70ms |
| 円Trace・16視点のCamera Motion Blur | 20.39→20.19ms | 1.90→1.90ms |

全ケースで描画回数は21→21、作業バッファは1920×1080、Traceマスク常駐量は0。既存マーカー用の数値バッファは、10本分の容量予約で768→49,152 bytes（48KiB）になる。追加の数値計算と点描画の処理はあるが、新しい画像用GPUバッファはない。GPUを他のアプリと共有しているため、表の微小差を常時の性能保証とは扱わない。
