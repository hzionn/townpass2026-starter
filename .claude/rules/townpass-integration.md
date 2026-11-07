# 作品和城市通 App 的關係

本 repository 僅保留 `carepass/` 照護通網頁，Flutter App 位於獨立的 `TownPass` repository，兩邊分支皆為 `feature/caregiver`。網頁 build 只輸出 `carepass/dist/`；Vercel 部署設定與 Root Directory 步驟見 `carepass/DEPLOYMENT.md`。App 透過 `CAREPASS_URL` 載入實際 HTTPS 網址，不含內建網頁；App 整合步驟見 TownPass repository 的 `docs/CAREPASS_INTEGRATION.md`。下方 `lib/` 路徑皆相對於獨立的 TownPass repository。

參賽作品通常是一個微服務網頁，視需求搭配後端，App 本身不一定要改。官方範例用 Vue 3，但語言和框架都不限，React 或純 HTML 也可以，後端同樣不限語言。

```text
城市通 App（Flutter）→ 點服務 → 開啟 WebView → 載入 https://我們的網址
                                     ↕ 雙向溝通（定位、掃碼、通知…）
                     我們的網頁 → API → 開放資料／我們的後端（選配）
```

驗證狀況（2026-11-07）：下面的檔案路徑和訊息名稱已對照 TownPass 程式碼；App 在 Android 模擬器跑過。雙向溝通和部署流程整理自手冊與程式碼，**我們還沒有實際跑過**。

## 跑起 App

App 的程式碼在隊伍的 fork：https://github.com/hzionn/TownPass（上游是 `taipei-doit/TownPass`）。

```bash
git clone https://github.com/hzionn/TownPass.git
cd TownPass
fvm install
fvm flutter pub get
fvm dart run build_runner build --delete-conflicting-outputs
fvm flutter run
```

- 沒有用 FVM 的話，拿掉每行開頭的 `fvm`。`.fvmrc` 指定 Flutter 3.47.6，手冊要求確認版本相符；我們用 3.47.8 跑 Android 也成功過。
- Android 工具鏈需要 Java 17。
- iOS 需要 Mac 和 Xcode。
- 不用上架也能裝到手機：Android 可以安裝 `flutter build apk` 產生的 APK，或用 USB 接電腦跑 `flutter run`。

**發 PR 前先確認目標：** 隊伍的 fork 上游是官方 repo，GitHub 網頁和 `gh pr create` 可能預設把 PR 發到 `taipei-doit/TownPass`。目標要選 `hzionn/TownPass`，或先在 clone 裡跑 `gh repo set-default hzionn/TownPass`。

## 把服務掛進 App

1. SVG 放進 `assets/svg/`，檔名用 snake_case，再跑一次 build_runner。程式裡用 `Assets.svg.iconXxx.svg()` 取用；專案已有上百個圖示可以直接用。
2. 在 `lib/page/city_service/model/my_service_model.dart` 的 `MyServiceItemId` 加一個 id，並在 `MyServiceIdExt` 補 case：

   ```dart
   MyServiceItemId.myService => MyServiceItem(
     title: '我的新服務',
     description: '一句話介紹這個服務',
     icon: Assets.svg.iconMyService.svg(),
     category: MyServiceCategory.cityLife,
     destinationUrl: 'https://my-service.web.app/',
   ),
   ```

   `category` 可用 `cityService`、`healthCare`、`cityLife`、`explore`、`other`。
3. `flutter run`，到「服務 › 更多」把服務加入我的服務。
4. 想放進「熱門」就改同目錄的 `trending_service_model.dart`。

## 雙向溝通

網頁透過 `window.flutterObject` 呼叫 App 功能。送出和回傳都是 JSON 字串，格式是 `{ name, data }`。

```js
// 一般瀏覽器沒有 flutterObject，要先判斷，必要時改用模擬資料
if (window.flutterObject) {
  const onReply = (event) => {
    const { name, data } = JSON.parse(event.data);
    if (name === 'location') {
      console.log(data.latitude, data.longitude);
      window.flutterObject.removeEventListener('message', onReply);
    }
  };
  window.flutterObject.addEventListener('message', onReply);
  window.flutterObject.postMessage(JSON.stringify({ name: 'location', data: null }));
}
```

內建訊息（`lib/util/web_message_handler/tp_web_message_handler.dart`）：

| `name` | 功能 |
|---|---|
| `userinfo` | 取得使用者資料 |
| `location` | 取得定位；失敗時回傳空陣列 |
| `qr_code_scan` | 開啟掃碼並回傳結果 |
| `notify` | 發送手機通知，`data` 是 `{ title, content }` |
| `deviceinfo` | 取得裝置資訊 |
| `phone_call` | 撥電話 |
| `1999agree` | 撥打 1999，會先要求同意並顯示撥號確認 |
| `launch_map` | 開啟地圖 |
| `open_link` | 開啟連結 |

要新增 App 能力才需要動 Flutter：繼承 `TPWebMessageHandler`，再加入 `tp_web_message_listener.dart` 的 `_cachedMessageHandlers`。名稱不要和內建的重複，套件要選開源、免費的。

## 測試注意事項

- 多數畫面可以用 Chrome 的手機模擬開發，但雙向溝通只有在 App 內才能運作。
- 假帳號在 `assets/mock_data/account.json`，改 `citizen`、`birthday` 就能展示非市民或長者情境。
- 手冊提醒要兩個平台都測：彈出視窗在 iOS 預設會被擋，Android 要自行處理。

## 設計

- 主色 `#5AB4C5`、輔色 `#F5BA4B`、灰階 `#738995`。
- 中文字體 PingFang TC，英數 Roboto。
- Figma 有免費 UI Kit，連結在開發文件首頁，可搜 Town Pass Design Tokens。
- 主題是數位平權，無障礙直接相關：觸控目標至少 48dp、文字放大 200% 仍可閱讀、圖示要有替代文字。

## 部署

網址要支援 HTTPS。平台不限，用免費方案即可。

- **前端：** GitHub Pages、Firebase Hosting、Cloudflare Pages、Vercel。Firebase 的流程是 `firebase init hosting`（public 填 build 輸出資料夾，Vite 是 `dist`），再 `firebase deploy --only hosting`。
- **後端（需要時才做）：** Cloud Run（`gcloud run deploy my-service --source . --region asia-east1`）、Render、Fly.io；比賽期間也可用 ngrok 對外提供本機服務。前後端網域不同時要設定 CORS。

## 往屆範例

都在 `github.com/taipei-doit/`，當年的地圖套件今年不一定合規：

- `townpass2024-weather`：Flask、純 HTML/JS、Leaflet，最精簡
- `townpass2024-parking`：Vue 3、FastAPI，有自訂 Handler
- `townpass2025-RideFlow`：Vue 3、FastAPI，README 很完整

共同點是需求一句話說得清楚、資料來自開放資料、主流程單純、README 完整。

## 裝置端 AI

需要實機。手冊建議 `flutter_edge_ai` 或 `llamadart` 搭配 Gemma 4 E2B，做法是自訂 Handler。模型首次載入要數十秒，demo 前要預熱，並用飛航模式完整測一次。手冊也明說沒有 AI 也能做出好作品，先確認它真的解決使用者的問題。
