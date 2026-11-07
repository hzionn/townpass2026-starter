import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:integration_test/integration_test.dart';
import 'package:town_pass/main.dart' as app;
import 'package:town_pass/util/tp_route.dart';
import 'package:town_pass/util/tp_web_view.dart';

Future<void> waitForText(
  WidgetTester tester,
  InAppWebViewController controller,
  String text,
) async {
  for (var i = 0; i < 80; i++) {
    await tester.pump(const Duration(milliseconds: 200));
    final body = await controller.evaluateJavascript(
      source: 'document.body ? document.body.innerText : ""',
    );
    if (body is String && body.contains(text)) return;
  }
  fail('WebView 未出現預期文字：$text');
}

Future<void> clickButton(
  WidgetTester tester,
  InAppWebViewController controller,
  String label,
) async {
  await controller.evaluateJavascript(
    source: '''Array.from(document.querySelectorAll('button'))
      .find(button => button.textContent.trim() === '$label')?.click();''',
  );
  await tester.pump(const Duration(milliseconds: 300));
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('從服務開啟內建 CarePass，完成引導並重開保存的清單', (tester) async {
    await app.initServices();
    // 使用實際路由與服務畫面，略過與此測試無關的啟動通知權限要求。
    await tester.pumpWidget(
      GetMaterialApp(
        getPages: TPRoute.page,
        initialRoute: TPRoute.main,
        theme: ThemeData(fontFamily: 'PingFangTC'),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('服務').last);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('照護通').first);
    await tester.tap(find.text('照護通').first);
    await tester.pumpAndSettle();
    final view = tester.widget<TPWebView>(find.byType(TPWebView));
    final controller = view.webViewController.value!;
    await waitForText(tester, controller, '幫我找到下一步');
    await controller.evaluateJavascript(
      source: 'localStorage.removeItem("carepass.plan.v1"); location.reload();',
    );
    await waitForText(tester, controller, '幫我找到下一步');
    await clickButton(tester, controller, '幫我找到下一步');
    await waitForText(tester, controller, '家人在哪裡需要服務');
    await controller.evaluateJavascript(
      source: '''
      document.querySelector('#district').value = '文山區';
      document.querySelector('#district').dispatchEvent(new Event('change', {bubbles: true}));
    ''',
    );
    await tester.pump(const Duration(milliseconds: 200));
    await clickButton(tester, controller, '下一步');
    await waitForText(tester, controller, '你希望獲得什麼協助');
    await controller.evaluateJavascript(
      source: 'document.querySelector("input[value=home]").click();',
    );
    await tester.pump(const Duration(milliseconds: 200));
    await clickButton(tester, controller, '下一步');
    await waitForText(tester, controller, '目前有使用長照服務嗎');
    await controller.evaluateJavascript(
      source: 'document.querySelectorAll("input[name=hasCare]")[1].click();',
    );
    await tester.pump(const Duration(milliseconds: 200));
    await clickButton(tester, controller, '下一步');
    await waitForText(tester, controller, '有希望協助的時段嗎');
    await clickButton(tester, controller, '查看我的下一步');
    await waitForText(tester, controller, '第一步，從 1966 開始');
    await clickButton(tester, controller, '建立我的行動清單');
    await waitForText(tester, controller, '已保存在這台裝置');
    final saved = await controller.evaluateJavascript(
      source: 'JSON.parse(localStorage.getItem("carepass.plan.v1")).ruleId',
    );
    expect(saved, 'R3');

    Get.back<void>();
    await tester.pumpAndSettle();
    await tester.tap(find.text('照護通').first);
    await tester.pumpAndSettle();
    final reopened = tester.widget<TPWebView>(find.byType(TPWebView));
    await waitForText(tester, reopened.webViewController.value!, '接著完成你的行動清單');
  });
}
