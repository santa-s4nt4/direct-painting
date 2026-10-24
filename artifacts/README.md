# 画面と描画検証の記録

## 現行版（4K対応）

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
