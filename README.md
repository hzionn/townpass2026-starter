# 託你辦｜授權協作申辦與預約平台

**不方便自己上網申辦的人按一下產生 QR Code，信任的家人或照顧者用自己的手機掃碼，就能接手填表、上傳附件；本人確認內容後才送出，看得到進度和協助紀錄，也能隨時停止。**

2026 臺北秋季程式設計節「城市通微服務大黑客松」參賽作品，主題「數位平權 × 友善共融」，組別「用不了」。

> 目前是**模擬服務**：只用虛構資料，送出的內容不會交給政府或醫院。

## 連結

| 項目 | 連結 |
|---|---|
| 微服務原始碼（本 repo） | [`tuoniban/`](tuoniban/) |
| 城市通 App（加上託你辦入口的 fork） | <https://github.com/hzionn/TownPass>（上游 [`taipei-doit/TownPass`](https://github.com/taipei-doit/TownPass)） |
| 線上版本 | <https://35-236-174-189.sslip.io/> |
| 完整說明：執行、測試、部署、展示腳本 | [`tuoniban/README.md`](tuoniban/README.md) |
| 實作取捨 | [`tuoniban/docs/IMPLEMENTATION.md`](tuoniban/docs/IMPLEMENTATION.md) |

## 要解決的問題

長輩、視障者等不熟悉或不便操作數位服務的人，常要請子女或照顧者幫忙申辦。現在的做法多半是把帳號、密碼或手機交給對方，本人看不到對方做了什麼，也收不回權限。

託你辦的主張是：**你來幫忙，我來決定。**

- **申請者（本人）：** 只要產生協助碼、看狀態、確認內容，不用填複雜表單。
- **代辦者：** 用自己的手機接手，不用借本人的帳號或手機，也看不到本人的身分原值。
- **本人保有決定權：** 代辦者填好後要送交本人確認，本人按「確認內容」才能送出；每一步都留下協助紀錄，本人隨時可以停止協助。

範例服務是「長者健檢預約需求（模擬）」，偏好地點的選項來自臺北市衛生局的開放資料。

## 使用流程

1. 本人在首頁選「我要請人幫忙」，按「同意並產生協助碼」，畫面出現 QR Code。
2. 代辦者選「我要幫忙」，用城市通 App 的掃碼功能掃描，直接進到表單。
3. 代辦者填偏好地點、日期、時段、是否陪同和聯絡方式，上傳附件，送交本人確認。
4. 本人的手機自動顯示代辦者準備的內容，按「確認內容」或「退回修改」。
5. 本人確認後，代辦者才能模擬送出。兩邊看到同一個模擬編號，本人也看得到完整的協助紀錄。

協助碼要在 10 分鐘內被領取，協助權限從產碼起 60 分鐘有效。掃碼失敗時，本人可以分享協助連結，代辦者貼上即可。

## 架構

```text
城市通 App（Flutter）──點「託你辦」──▶ 內建網頁視窗
                                          │  掃碼時呼叫 App 的 qr_code_scan
                                          ▼
                    託你辦網頁（Vue 3 + TypeScript）
                                          │  HTTPS
                                          ▼
       Caddy ──▶ 託你辦 API（Node.js + Express 5）──▶ SQLite 和附件（VM 磁碟）
```

- 前端：Vue 3 + Vite + TypeScript。在城市通裡用 App 的掃碼功能，在一般瀏覽器裡改用相機加 jsQR。
- 後端：Node.js 22.13 以上 + Express 5 + TypeScript，資料存在 Node 內建的 SQLite（`node:sqlite`），前後端共用 zod 驗證規則。
- 部署：一台 GCP Compute Engine VM，Caddy 自動申請 HTTPS 憑證。

## 城市通 App 的修改

App 的修改在隊伍的 fork [`hzionn/TownPass`](https://github.com/hzionn/TownPass)，已合併進 `main`（[PR #1](https://github.com/hzionn/TownPass/pull/1)，[改動內容](https://github.com/hzionn/TownPass/commit/7f70119d3fc46514635743ed25e566a501dc6473)）：

- 只改 `lib/page/city_service/model/my_service_model.dart` 一個檔案，在「服務 › 更多 › 市政服務」加一個「託你辦」入口，點下去用 App 內建的網頁視窗開啟線上版本。
- 圖示借用 App 現有的 `iconProtect`，沒有新增圖片。
- 只用到 App 內建的 `qr_code_scan` 訊息，沒有新增 Flutter 的訊息處理程式。

建置 App：

```bash
git clone https://github.com/hzionn/TownPass.git
cd TownPass
fvm install                  # 沒有用 FVM 的話，略過這行並拿掉後面每行開頭的 fvm
fvm flutter pub get
fvm dart run build_runner build --delete-conflicting-outputs
fvm flutter run
```

需要 Flutter 3.47.6（`.fvmrc` 指定的版本）；Android 需要 Java 17，iOS 需要 Mac 和 Xcode。App 打開後到「服務 › 更多」找到「託你辦」，加入我的服務。

想把服務指到自己部署的網址，改 `my_service_model.dart` 裡 `MyServiceItemId.tuoNiBan` 的 `destinationUrl`（保留結尾的 `/`），重新 `flutter run` 即可。

## 在自己電腦上跑

需要 Node.js **22.13 以上**。

```bash
git clone https://github.com/hzionn/townpass2026-starter.git
cd townpass2026-starter/tuoniban
npm ci
npm run dev
```

打開 <http://localhost:5173>。不需要 `.env`，資料存在 `tuoniban/.data/`。一台電腦想同時扮演兩個人時，一般視窗當本人，無痕視窗當代辦。

```bash
npm test             # 單元測試和 API 測試
npm run typecheck    # 型別檢查
```

端對端測試、用兩支手機測試、部署到 GCP VM 的步驟，見 [`tuoniban/README.md`](tuoniban/README.md)。

## 資料夾

| 路徑 | 內容 |
|---|---|
| `tuoniban/web/` | 前端 |
| `tuoniban/server/` | 後端 API，部署時也由它提供網頁檔案 |
| `tuoniban/shared/` | 前後端共用的型別和表單驗證 |
| `tuoniban/e2e/` | 端對端測試（Playwright，模擬 Android 和 iPhone） |
| `tuoniban/scripts/` | 授權清單、開放資料匯入、合成附件產生 |
| `tuoniban/deploy/` | 部署到 GCP VM 的 script 和設定 |
| `tuoniban/docs/` | 實作取捨 |
| `CLAUDE.md`、`.claude/` | 開發時給 AI 程式助理讀的專案說明和比賽規則整理 |
| `LICENSE` | AGPL-3.0 |

## 資料來源

### 開放資料

| 資料集 | 提供機關 | 授權 | 用途 |
|---|---|---|---|
| [臺北市老人健康檢查特約醫事機構](https://data.taipei/dataset/detail?id=9a1aefde-2e4a-467c-9ec4-256e33ad6df0) | 臺北市政府衛生局 | 政府資料開放授權條款第 1 版 | 表單的偏好地點選單（85 家，依行政區分組） |

- 來源是臺北資料大平台，資料集最後異動 2026-07-13，於 2026-11-07 取得。
- 只保留機構名稱、地址和行政區。資料由 `tuoniban/scripts/import-healthcheck-sites.mjs` 從原始 CSV 產生，存在 `tuoniban/server/src/data/healthcheckSites.ts`。
- 這份資料只有機構名單，沒有名額或時段，所以畫面不會宣稱有名額。

### 模擬資料

以下都是虛構的，畫面全程顯示「模擬服務」標籤：

- 申請者 A 和他的身分資料
- 偏好日期、時段、預約結果和模擬編號
- 合成練習附件（`tuoniban/web/public/samples/`，內容標明不是真實證件）

健檢預約系統、MyData、政府受理系統和正式身分驗證都沒有介接。

## 第三方套件

作品執行時用到的套件和環境。開發與測試用的套件也列在 [`tuoniban/README.md`](tuoniban/README.md#第三方套件)，可以在 `tuoniban/` 跑 `npm run licenses` 重新產生清單。

| 名稱 | 版本 | 授權 | 用途 |
|---|---|---|---|
| cookie | 2.0.2 | MIT | 讀寫 session cookie |
| express | 5.3.0 | MIT | 後端 API 和網頁伺服器 |
| jsqr | 1.4.0 | Apache-2.0 | 一般瀏覽器用相機掃 QR Code |
| multer | 2.5.0 | MIT | 接收附件上傳 |
| pg | 8.23.1 | MIT | 選用的 Postgres 連線 |
| qrcode | 1.5.4 | MIT | 產生 QR Code 圖片 |
| vue | 3.5.45 | MIT | 前端框架 |
| vue-router | 5.4.0 | MIT | 前端頁面路由 |
| zod | 4.6.7 | MIT | 前後端共用的資料驗證 |
| Node.js 22 | — | MIT | 後端執行環境 |
| SQLite | — | Public Domain | 資料庫（隨 Node.js 內建） |
| Caddy | — | Apache-2.0 | VM 上的 HTTPS 反向代理 |

城市通 App 本身沿用上游 TownPass 的套件，我們的修改沒有新增套件。

## AI 使用揭露

- **作品執行時沒有使用任何 AI 或大型語言模型**，裝置端和遠端都沒有。QR Code 掃描用的 jsQR 是一般的影像解碼程式，不是 AI 模型。
- 開發時使用 AI 程式助理（Claude Code）協助撰寫程式和文件，比賽規則允許開發時使用雲端 AI。

## 授權

本 repo 以 [GNU Affero General Public License v3.0（AGPL-3.0）](LICENSE) 授權。

城市通 App 的 fork [`hzionn/TownPass`](https://github.com/hzionn/TownPass) 沿用上游 TownPass 的授權（GPL-3.0）。
