# レイヤーが一覧にあるのに描画されない不具合

Camera Motion Blurで追加した`cameraCount`を、頂点とフラグメントの両シェーダーで`uniform int`として宣言していました。GLSL ESでは頂点側の既定精度がhighp、フラグメント側がmediumpなので、同じuniformの精度が一致せずプログラムのリンクに失敗します。

macOS上でANGLEのOpenGL ES 3.0コンテキストを作り、本番シェーダーを使って次のエラーを再現しました。

```text
Precisions of uniform 'cameraCount' differ between VERTEX and FRAGMENT shaders.
```

両方を`uniform highp int cameraCount;`へ修正しました。[GLSL ES 3.00の仕様](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf)は、共有するuniformの型と精度の一致を要求します。以前のデスクトップOpenGL／CGLテストではこのES固有の不一致を検出できていませんでした。

`npm run test:gles -- artifacts/gles-layer-checks.json`は、旧宣言でリンクが失敗することを確認した後、修正済みの通常・Analog両シェーダーをリンクして描画します。64×36の描画先で両方とも556画素が出力され、GLエラーは0でした。[実測結果](../artifacts/gles-layer-checks.json)を保存しています。

この補助テストはmacOSと`clang++`、既にインストールされているANGLEの`libEGL.dylib`・`libGLESv2.dylib`を使います。VS Code／TouchDesignerの既定候補を探し、別の場所では`ANGLE_LIBRARY_DIR`でライブラリーのあるディレクトリーを指定します。アプリやブラウザーのUIを起動・操作するテストではありません。

実ブラウザーの操作機能には接続できていないため、実画面・Three.js統合・iPad実機の動作確認は未実施です。ただし、今回はデスクトップGLだけでなく、GLSL ES 3.00の実リンクとGPU画素出力まで確認しています。
