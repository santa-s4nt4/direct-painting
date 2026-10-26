# 画面と描画検証の記録

## OpenGL ES描画の修正（2026-10-26）

- [ANGLEのリンク・画素検証](gles-layer-checks.json)：修正前の`cameraCount`精度不一致によるリンクエラーを再現。修正後は通常・Analog両プログラムがリンクし、両方で556画素、GLエラー0。
- [原因と検証方法](../docs/shader-precision.md)。デスクトップCGLでは検出できなかったため、GLSL ES 3.00の検証を追加しました。ブラウザーUIのスクリーンショットではありません。

MIDIタブの余白、ADSR初期値、20pxの線幅、Front／Cameraの2段配置、Pause削除、ペンと立方体の同時入力はこの修正と同時に変更しています。以下の過去画像は変更前のUIを含みます。

## Camera motion（2026-10-26）

- [カメラを含む実シェーダー検証](camera-shader-checks.json)：オフスクリーンGPUで17項目成功。カメラの8項目は最大RMS 0.0334／255、一部境界の最大差16／255。
- [Camera Motion Blur ON／OFF比較](camera-motion-blur-comparison.png)：本番GLSLのGPU出力です。アプリ画面のスクリーンショットではありません。
- [実CoreMIDI入力](camera-midi-checks.json)：頭出し・カメラの対象ノート変更・Note Off・切断を含む7項目成功。

UIのイベント連携はHappy DOMで確認しています。実画面・ブラウザーWebGL2統合・iPad実機は未確認です。[操作と確認範囲](../docs/camera-motion.md)を参照してください。


## Motion blur（2026-10-26）

- [実シェーダーのオフスクリーンGPU検証](motion-gpu-checks.json)：9項目成功。通常の各時刻の描画を平均した画像と比較し、最大誤差1／255。
- [Motion blur ON／OFF比較](motion-blur-comparison.png)：同じシェーダーによるGPU描画の比較画像です。アプリのスクリーンショットではありません。

ブラウザー操作機能が利用できなかったため、今回の実UI・ブラウザーWebGL2・iPad実機確認は未実施です。以下の以前の画面・計測はMotion blur追加前の記録です。


## MIDI入力の切替

[MIDIタブ](direct-painting-midi-tab.png)：左パネルで独立したタブから入力デバイスを切り替えられます。接続手順と受信状態、頭出しノート24固定を日本語で表示します。カラーパネルは外側タッチで閉じます。


## 現行の描画ツール

[Ellipse / Rectangle / Line｜Ring](direct-painting-shape-tools.png)：Move表示を廃止し、Lineは30px固定。1133×744と744×1133で配置を確認しました。以下の過去画像には変更前のMoveボタンが含まれます。


## 現行：3DボックスとMIDI同期

- [MIDI設定・固定16秒・下部回転UI](direct-painting-midi.png)：1133×744、実MIDI入力の接続状態。
- [3D空間の編集画面](box-volume-editor.png)／[映像出力](box-volume-output.png)：異なる向きの平面と3D Line。編集画面の旧スクリーンショットは16秒固定前の表示です。
- [初回Ring](box-line-ring-active.png)／[リリース後の消失](box-line-ring-faded.png)。
- [既存描画の回帰33項目](box-legacy-render-checks.json)：旧GPU／CPUの画素比較、キャッシュ、復帰とフォールバック。
- [3D描画15項目・10レイヤー計測](volume-render-checks.json)：全レイヤーを表示したまま測定。
- [入力座標と保存平面・奥行き](box-volume-ui-checks.json)：再投影の誤差0。
- [実CoreMIDI仮想入力4項目](midi-native-checks.json)：MIDI24、旧12／36やNote Off等の無視、切断。


## 現行版（3Dビュー・Move / Line）

- [3Dビューと描画ツール](direct-painting-3d-tools.png)：1133×744、0°／45°の四角形Ringと直線、左下の回転ボックス。
- [直線の初回](direct-painting-line-first-cycle.png) / [次周回](direct-painting-line-next-cycle.png)：2つのRingから全長の直線へ切り替え。
- [3D姿勢の出力](direct-painting-3d-output.png) / [50%表示](direct-painting-3d-fit-50.png)。
- [描画比較JSON](3d-tools-render-checks.json)：33項目成功。
- [画面操作の確認JSON](3d-tools-ui-checks.json)：500%／50%、傾いた平面への入力座標誤差0px、直線の開始時刻を記録。

詳細は[3Dツールの記録](../docs/3d-tools.md)を参照してください。

## 以前の中央表示・Trail負荷対策

- [中央100%](direct-painting-center-100.png)：iPad mini相当の1133×744で、4K中央1920×1080に描画。
- [中央10%](direct-painting-center-10.png)：4K全体を中央に縮小し、描画範囲の枠を表示。
- [10%の出力同期](direct-painting-output-10.png)：出力canvasは1920×1080、同じ表示変換を適用。
- [画素比較と回帰検証](center-trail-render-checks.json)：26項目成功。
- [Trail変更前](trail-before.json) / [Trail変更後](trail-after.json)：M4 Max / Chromeの28条件と長い筆跡のシーク計測。iPad実測ではありません。

原因と推定本数の条件は[Trail負荷調査](../docs/trail-performance.md)を参照してください。

## 以前の4K対応時

- [4K全体表示](direct-painting-4k-overview.jpg)：内部3840×2160を50%で表示。右下のFull HD範囲外にも描画しています。
- [初期Full HD表示](direct-painting-4k-default.jpg)：100%・初期位置で1920×1080の範囲を表示します。
- [4K描画検証と10レイヤー計測](4k-canvas-benchmark.json)：24項目成功。Full HD出力、4Kの端、50〜200%・移動制限、Blur、GPUキャッシュ、CPUフォールバックを含みます。

![4K全体表示](direct-painting-4k-overview.jpg)

## 過去の段階

- `direct-painting-blur-palette-zoom.jpg` / `blur-zoom-benchmark.json`：4K対応前のパレット・ズーム追加時。ブラウザ検証22項目成功。

- `direct-painting-ipad.jpg`：単一キャンバスへの変更時。
- `direct-painting-left-panel.jpg`：左パネル統合時。
- `direct-painting-gpu.jpg` / `gpu-benchmark.json`：WebGL2移行時。ブラウザ検証15項目成功。
- `direct-painting-layer-effects.jpg` / `layer-effects-benchmark.json`：レイヤーエフェクト追加時。ブラウザ検証20項目成功。

過去の画像には現在廃止したUIも含まれます。現行仕様と確認範囲は[実装履歴](../docs/implementation-log.md)を参照してください。計測は記録されたPC・ブラウザでの描画時間で、iPad実機の入力遅延やFPSを保証するものではありません。
