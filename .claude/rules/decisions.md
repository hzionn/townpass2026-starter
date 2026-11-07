# 隊伍決定

全隊共用的決定紀錄，有變動就更新，舊決定不適用時直接改掉。後面兩張清單完賽時可以直接拿來繳交。

## 題目

- 方向：數位平權 × 友善共融
- 3 大類：用不了、看不懂、拿不到
- 我們的組別被分配到：**用不了**
  - 對象：身心障礙者、高齡者、孕婦、傷病者、照顧者
  - 方向：無障礙介面、語音輔助、字級調整、線上服務優化

## 作品

- 一句話說明：照護通 CarePass，幫家庭照顧者知道先聯絡誰、要問什麼，並保存喘息行動清單。
- 主要使用者：臺北市需要到府喘息協助的家庭照顧者。
- Demo 情境：需要暫時離家，從城市通進入照護通，回答行政區與長照使用狀態，查看官方聯絡路徑與單位，保存摘要及待辦。
- 第一版：居家喘息；已有個管員、首次申請與狀態不明分流。地圖、定位、排程通知及其他服務類型列後續。
- 驗證限制：使用者操作與長照流程專業複核需另行安排；不能宣稱已確認資格、空位或服務安排。

## 技術

- 前端：React 19、TypeScript、Vite；單一 HTML 打包供 WebView 載入。
- 後端（沒有就寫無）：無；規則與官方資料快照在網頁內處理，清單存於本機 localStorage。
- 部署：目前隨 App 封裝 `TownPass/assets/carepass/index.html`；可使用 `CAREPASS_URL` 切換實際 HTTPS 代管網址，尚未公開部署。
- Demo 裝置：iPhone 17 Pro／iOS 26.5 模擬器已通過完整服務流程及關閉重開保存測試；實機電話、App 重啟與 Android 平台另驗收。
- 入口：服務清單「防疫醫療」及服務頁「熱門」，`local://carepass` → `/carepass`。
- UI：對齊 TownPass 的 TPColors／TPTextStyles／TPButton／TPCard，網頁 tokens 位於 `carepass/src/tokens.css`。App 內沿用原生標頭；新版 HTML 需重新 build 並安裝至手機。
- 分支：`feature/caregiver`；透過 Commit、Push、PR 供隊友 Review。

## 分工

| 成員 | 負責 |
|---|---|
| | |

## 開放資料

| 資料集 | 連結 | 用途 |
|---|---|---|
| 臺北市長照喘息服務特約單位 | https://data.taipei/dataset/detail?id=959c34b2-9698-4d99-8987-d389efe18c04 | 居家式單位名錄，保留服務區別、地址、電話與來源日期 |
| 衛福部長照申請流程 | https://1966.gov.tw/LTC/cp-6533-70777-207.html | 聯絡路徑與申請流程說明 |

## 第三方套件

| 名稱 | 授權 | 用途 |
|---|---|---|
| React／React DOM／Scheduler | MIT | 網頁介面與執行時 |
| TypeScript | Apache-2.0 | 型別檢查 |
| Vite／vite-plugin-singlefile | MIT | 開發、建置與單檔封裝 |
| csv-parse | MIT | 官方 CSV 匯入 |
| @types/react／@types/react-dom | MIT | 開發用型別 |

套件確切版本及相依套件見 `carepass/package-lock.json`，授權文字見 `carepass/THIRD_PARTY_NOTICES.md`。官方資料的「全區」範圍尚待確認，另列為待確認結果。
