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
| 一筆書きの対象 | 最大時の図形の輪郭。元の指の移動経路をなぞる機能ではない。 |
| 最大の判定 | Circleは直径最大、Rectangleは面積`width × height`最大。同率なら最初の時刻。 |
| 最大時の位置 | 最大になった瞬間の中心・サイズ・角度・描画平面をセットで採用する。Rectangleの幅最大と高さ最大を別々に合成しない。 |
| 最大判定に使う値 | 生の筆圧サンプルだけでなく、現行のイージング後の初回表示形状を基準にする。評価範囲は初回の描画とリリース後のイージングを含む可視期間とし、毎回再現できる方法で確定する。 |
| 開始時刻 | 次周回の、最初にタッチしたのと同じループ内時刻。3秒位置でタッチしたら次周回の3秒位置からTrace開始。 |
| 入力が16秒境界をまたぐ場合 | タッチ中は通常表示を続け、入力確定後に来る次の開始位相からTraceに切り替える。 |
| 開始点・方向 | Rectangleは図形ローカル座標の左上頂点、Circleは上端。いずれも時計回り。 |
| 進行速度 | smoothstepのイーズイン・アウトで周長上を進む。サイズに関係なく指定時間で一周する。 |
| 輪郭線幅 | 既存のStroke設定を再利用し、編集可能にする。 |
| 先端の円 | 動く描画先端に中心を置く塗り円。終了後は閉じた輪郭と一緒にフェードする。 |
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
