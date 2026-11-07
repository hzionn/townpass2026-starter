import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:town_pass/page/carepass/carepass_view.dart';
import 'package:town_pass/page/city_service/model/my_service_model.dart';
import 'package:town_pass/page/city_service/model/trending_service_model.dart';
import 'package:town_pass/util/tp_route.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('照護通的服務入口與熱門捷徑指向已註冊的路由', () {
    final service = MyServiceItemId.carePass.item;
    final uri = Uri.parse(service.destinationUrl);
    expect(service.category, MyServiceCategory.healthCare);
    expect(service.title, '照護通');
    expect(uri.scheme, 'local');
    expect('/${uri.host}', TPRoute.carePass);
    expect(TPRoute.page.any((page) => page.name == TPRoute.carePass), isTrue);
    expect(
      TrendingServiceModel.serviceList.any(
        (item) => item.url == service.destinationUrl,
      ),
      isTrue,
    );
  });

  test('隨 App 封裝的 CarePass HTML 存在且沒有依賴外部建置資產', () async {
    final html = await rootBundle.loadString(CarePassView.bundledAsset);
    expect(html, contains('照護通 CarePass'));
    expect(html, contains('root'));
    expect(
      RegExp(r'''(?:src|href)=["'](?:\./)?assets/''').hasMatch(html),
      isFalse,
    );
  });
}
