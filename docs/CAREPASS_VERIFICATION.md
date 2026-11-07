# CarePass 初版驗證紀錄

日期：2026-11-07。版本對應本次 `feature/caregiver` 的照護通服務實作。

## TownPass UI 對齊

本輪聚焦網頁 UI，未修改需求規則、官方資料、電話或清單儲存邏輯，也未修改既有的 iOS 簽章與裝置設定。

- 依原專案 TPColors／TPTextStyles／TPButton／TPCard 建立 CSS tokens，統一藍綠主色、灰白背景、卡片、按鈕、表單及導覽。
- 手機版縮短裝飾區域，將待辦狀態移至任務文字下方，保留 48px 以上操作區域。
- App 內偵測 bridge 後隱藏重複網頁標頭；一般瀏覽器仍顯示網站標頭。此行為以瀏覽器模擬 bridge 檢查，尚未在本輪重新安裝真機。
- Chrome 檢查首頁、問卷、結果、資源清單、詳情及行動清單等七個畫面；320／390／768／1200 CSS px 與首頁、問卷、清單、資源頁 200% 文字放大無水平溢出。
- 主按鈕正常狀態使用 primary500 背景與 primary950 文字，量測文字對比為 7.87:1。
- 前端 16 項測試、TypeScript 檢查與 production build 通過，Flutter 2 項服務／資產測試通過。前一輪 iOS 整合測試紀錄保留於下方，本輪未重跑原生整合測試。
- 已重新產生 App 內建 HTML。既有手機上的版本需重新建置並安裝，才會顯示新版 UI。

## 已完成

| 項目 | 結果與範圍 |
|---|---|
| `carepass: npm run check` | TypeScript 型別檢查通過 |
| `carepass: npm test` | 16 項測試通過，涵蓋規則、區域篩選、來源解碼、保存、服務狀態註記與電話格式／bridge |
| `carepass: npm run build` | 產生約 340 KB 單一 HTML，並同步至 Flutter 資產目錄 |
| `TownPass: flutter test --no-pub` | 2 項測試通過，驗證服務／熱門入口路由與內建 HTML 資產 |
| Flutter 修改範圍分析 | 服務頁、兩份入口模型、路由、WebView、單元及整合測試共 7 個檔案，無問題 |
| iOS 模擬器建置 | iPhone 17 Pro／iOS 26.5，Flutter 3.47.8，可建置並執行 |
| iOS 模擬器整合測試 | 1 項通過：由城市通服務開啟內建 CarePass、完成文山區到府需求與首次申請分流、保存行動清單、關閉並重新開啟仍可讀取 |
| 瀏覽器操作 | Chrome 手機尺寸 390 × 844：首次申請分流、選用單位、更新已有計畫、待辦狀態、重新整理恢復、清除及損壞資料提示通過 |
| 響應式與文字放大 | 320、390、1100 CSS px 寬度無頁面水平溢出；首頁文字放大 200% 後可重排，修正手機插圖與文字重疊 |
| 官方資料快照 | 165 筆居家單位，90 筆完整解析服務區別，75 筆範圍待確認；另有停業／暫停等來源註記與 22 筆電話格式異常，分別標示或阻止直接撥號；原始 CSV、來源資訊與異常報告可追溯 |

瀏覽器自動化使用獨立測試環境。沒有實際撥出 1966 或單位電話；bridge 的電話訊息以模擬回覆測試。

## 已知環境訊息

- 全 TownPass 靜態分析仍有原始程式的 unused import、deprecated API 等 warning／info；本次修改範圍分析通過。
- 本機 CocoaPods 為 1.15.2，Flutter 建議 1.16.2 以上；本次模擬器建置及整合測試仍成功。
- 既有 `flutter_inappwebview_ios` 尚未支援 Swift Package Manager，Flutter 目前使用 CocoaPods；這是既有套件的提示。
- CUA 預覽控制未回應，瀏覽器驗證改以本機獨立的無頭 Chrome 執行；沒有以其取代原生 WebView 驗證。

## 尚未驗證／交付前待辦

- Android 模擬器本次未成功啟動，Android 平台行為尚未驗收。
- 真實手機的撥號介面、電話接通、App 重啟後持續保存與讀屏需另行驗收。
- 三位照顧者的使用測試及長照流程專業複核尚未完成，不能宣稱已證實降低照顧負擔。
- 官方「全區」的服務範圍定義仍待確認，已在畫面另列，不當作指定行政區的確定命中。
- 尚未建立公開 HTTPS 代管網址。App 預設使用內建網頁，`CAREPASS_URL` 可在實際部署後切換。
- 主辦指定授權聲明尚待取得原文；AGPL-3.0 與既有 TownPass 授權告示已保留。

## 重現方式

```bash
cd carepass
npm ci
npm run check
npm test
npm run build
cd ../TownPass
flutter pub get
dart run build_runner build
flutter test --no-pub
flutter analyze --no-pub lib/page/carepass/carepass_view.dart lib/page/city_service/model/my_service_model.dart lib/page/city_service/model/trending_service_model.dart lib/util/tp_route.dart lib/util/tp_web_view.dart test/carepass_service_test.dart integration_test/carepass_test.dart
flutter test integration_test/carepass_test.dart -d <測試裝置ID> --no-pub
```
