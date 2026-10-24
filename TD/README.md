# direct-painting / TouchDesigner

1. direct-paintingのフォルダで `npm run dev` を起動します。
2. Web Render TOPを1つ作り、URL or Fileを `http://localhost:5181/output` にします。
3. CommonのOutput Resolutionを **Custom Resolution**、Resolutionを **1920 × 1080**、Use Global Res MultiplierをOFFにします。
4. ActiveとCook AlwaysをONにし、TouchDesignerプロジェクトのFPSを60にします。

[Web Render TOP公式ドキュメント](https://docs.derivative.ca/Web_Render_TOP)でパラメーター名を確認できます。

自動で作る場合は、Text DATに `direct_painting.py` の内容を貼り付けてRun Scriptを実行してください。同じCOMP内に `direct_painting_web` と `direct_painting_out` を作成します。同名のTOPがあれば設定を更新します。

別PCでTouchDesignerを動かす場合は、URLのlocalhostをサーバーPCのLAN IPに変更します。編集用UIは5180、映像は5181です。フルHD映像は16:9を保って表示し、出力ページには操作パネルを表示しません。

`legacy/imagraph_out.toe` は元ツールの左右320×320構成を残した参照用バックアップです。direct-paintingでは上記の単一出力設定を使用してください。TouchDesigner本体での動作確認は別途必要です。
