# 隊伍決定

全隊共用的決定紀錄，有變動就更新，舊決定不適用時直接改掉。後面兩張清單完賽時可以直接拿來繳交。

## 題目

- 方向：數位平權 × 友善共融
- 3 大類：用不了、看不懂、拿不到
- 我們的組別被分配到：**用不了**
  - 對象：身心障礙者、高齡者、孕婦、傷病者、照顧者
  - 方向：無障礙介面、語音輔助、字級調整、線上服務優化

## 作品

- 名稱：託你辦｜授權協作申辦與預約平台，程式在 `tuoniban/`，說明見 `tuoniban/README.md`
- 一句話說明：不方便自己上網申辦的人產生 QR Code，信任的人用自己的手機掃碼接手填表、上傳附件並模擬送出；本人看得到進度，也能隨時停止。
- 主要使用者：申請者是長輩、視障者等不熟悉或不便操作的人；代辦者是子女、照顧者等本人信任的人。
- Demo 情境：「長者健檢預約需求（模擬）」。手機 A 當本人產碼，手機 B 當代辦掃碼，填偏好地點（開放資料）、日期時段，上傳內建的合成附件，模擬送出後兩邊都看到同一個模擬編號；有時間再展示本人停止協助。腳本見 `tuoniban/README.md`「2 分鐘展示腳本」。

## 技術

- 前端：Vue 3 + Vite + TypeScript
- 後端（沒有就寫無）：Node.js（22.13 以上）+ Express 5 + TypeScript，SQLite（Node 內建 `node:sqlite`）加私有附件資料夾；設 `DATABASE_URL` 可改用 Postgres（選用，部署用不到）
- 部署：一台 GCP Compute Engine VM（e2-small、asia-east1、Debian 12），SQLite 存在 VM 磁碟，Caddy 自動 HTTPS；沒有網域時用 `<IP 橫線>.sslip.io`。檔案在 `tuoniban/deploy/`。不用 Vercel 或 Cloud Run（沒有持久磁碟）
- Demo 裝置：兩支手機，至少一支裝城市通 App（套用 `tuoniban/townpass/tuoniban-service.patch`）；只有一支時讓它當代辦，才能展示 App 掃碼

## 分工

| 成員 | 負責 |
|---|---|
| | |

## 開放資料

| 資料集 | 連結 | 用途 |
|---|---|---|
| 臺北市老人健康檢查特約醫事機構（臺北市政府衛生局，政府資料開放授權條款第 1 版，2026-07-13 最後異動，2026-11-07 取得） | https://data.taipei/dataset/detail?id=9a1aefde-2e4a-467c-9ec4-256e33ad6df0 | S04 偏好地點選單的 85 家機構，只留名稱、地址、行政區 |

其餘都是模擬資料，畫面標示「模擬服務」：申請者 A 和他的身分資料、日期時段名額和預約結果、模擬編號、合成練習附件。

## 第三方套件

執行時和前端用到的直接依賴，`cd tuoniban && npm run licenses` 會列出實際版本和授權（含開發用套件），清單也在 `tuoniban/README.md`。

| 名稱 | 授權 | 用途 |
|---|---|---|
| cookie 2.0.2 | MIT | 讀寫 session cookie |
| express 5.3.0 | MIT | 後端 API 和網頁伺服器 |
| jsqr 1.4.0 | Apache-2.0 | 一般瀏覽器用相機掃 QR Code |
| multer 2.5.0 | MIT | 接收附件上傳 |
| pg 8.23.1 | MIT | 選用的 Postgres 連線 |
| qrcode 1.5.4 | MIT | 產生 QR Code 圖片 |
| vue 3.5.45 | MIT | 前端框架 |
| vue-router 5.4.0 | MIT | 前端頁面路由 |
| zod 4.6.7 | MIT | 前後端共用的資料驗證 |
| Caddy | Apache-2.0 | VM 上的 HTTPS 反向代理 |
| Node.js 22 | MIT | 後端執行環境，內建 SQLite（Public Domain） |
