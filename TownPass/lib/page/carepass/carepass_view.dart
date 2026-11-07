import 'package:flutter/material.dart';
import 'package:town_pass/util/tp_web_view.dart';

/// 預設開啟隨 App 封裝的網頁；部署後可用 --dart-define=CAREPASS_URL=https://… 切換。
class CarePassView extends StatelessWidget {
  static const String bundledAsset = 'assets/carepass/index.html';
  static const String configuredUrl = String.fromEnvironment('CAREPASS_URL');

  const CarePassView({super.key});

  @override
  Widget build(BuildContext context) {
    final uri = Uri.tryParse(configuredUrl);
    final useHosted =
        uri != null && uri.scheme == 'https' && uri.host.isNotEmpty;
    return TPWebView(
      initialArgument: WebViewArgument(
        url: useHosted ? configuredUrl : null,
        assetPath: useHosted ? null : bundledAsset,
        forceTitle: '照護通 CarePass',
      ),
    );
  }
}
