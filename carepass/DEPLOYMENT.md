# 部署 CarePass 至 Vercel

此 repository 只維護網站服務；Flutter App 位於獨立的 `TownPass` repository。兩邊分支皆為 `feature/caregiver`。目前為靜態網站，沒有後端 API、資料庫或必要的環境變數。

## 部署前檢查

使用 Node.js 24.x，在本 repository 執行：

```bash
cd carepass
npm ci
npm run check
npm test
npm run build
npm run preview
```

`build` 僅輸出 `carepass/dist/`，不讀取或寫入 Flutter 專案。Vite 預設預覽網址為 `http://127.0.0.1:4173/`；一般瀏覽器可驗證問卷與清單，原生 bridge 仍須在 App 內驗證。

## Vercel Git 部署

1. 將修改提交並推送至 `townpass2026-starter` 的 `feature/caregiver`。
2. 在 Vercel 匯入 **townpass2026-starter** repository。
3. 將 **Root Directory 設為 `carepass`**。`vercel.json` 就在這個目錄，不能選獨立的 TownPass repository。
4. 設定如下；建置相關欄位已寫入 `vercel.json`，Node.js 版本由 `package.json` 的 `engines.node` 指定。

   | 設定 | 值 |
   |---|---|
   | Framework Preset | Vite |
   | Install Command | `npm ci` |
   | Build Command | `npm run build` |
   | Output Directory | `dist` |
   | Node.js | 24.x |
   | Environment Variables | 不需要 |

5. 若要把此開發分支用於正式網址，將 **Production Branch 設為 `feature/caregiver`**；日後改用 `main` 時再調整。
6. 部署完成後，確認正式 HTTPS 網址可直接開啟網站，不需登入 Vercel。若啟用 Deployment Protection，需讓準備供 App 使用的部署可公開存取。

`vercel.json` 設定 HTML 每次需重新驗證快取；網站採 hash 導覽（例如 `/#providers`），不需要 SPA catch-all rewrite。保留 Vite 的單檔 HTML 輸出只是網站建置方式，沒有 Flutter 封裝步驟。

Root Directory 屬於 Vercel 專案設定，須在介面設定，不能在 `vercel.json` 宣告。官方參考：[建置設定](https://vercel.com/docs/builds/configure-a-build)、[vercel.json](https://vercel.com/docs/project-configuration/vercel-json)、[Node.js 版本](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)。

## Flutter 連接部署網址

在獨立的 **TownPass repository 根目錄**執行，將以下範例替換為實際部署網址：

```bash
flutter pub get
dart run build_runner build
flutter run --dart-define=CAREPASS_URL=https://your-project.vercel.app/
```

建置 APK／IPA 也需加上相同 `--dart-define`。使用 FVM 時，在 Flutter／Dart 指令前加上 `fvm`。`CAREPASS_URL` 由 Flutter 編譯時讀取，設定在 Vercel 的環境變數不會更新 App。

沒有設定有效 HTTPS 網址時，App 顯示「照護通服務尚未設定」。網路或主頁 HTTP 錯誤時可重新載入。App 不包含離線網頁；網站內容更新後，在相同正式網址重新開啟即可取得新版，更換網域才需要重新建置 App。

## 部署後驗收

- 瀏覽器：首頁 → 問卷 → 結果 → 保存清單 → 重新整理後仍能恢復。
- App：服務 ＞ 熱門 ＞ 照護通 → 同一流程 → 關閉並重開清單。
- App：撥號及官方外連可交由既有 bridge 處理，返回後清單仍在。
- 斷網或服務錯誤時，App 顯示載入失敗與重新載入操作。

localStorage 依 origin 保存。正式網址、Preview 網址、舊 App 內建網頁之間的清單不會自動移轉，請固定正式網域供使用者操作。網頁可直接使用，一般瀏覽器沒有原生 bridge 時會使用 `tel:` 與一般連結。

本次只準備部署檔案，不會連接 Vercel 帳號或執行公開部署。
