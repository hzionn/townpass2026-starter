# 照護通 CarePass

家庭照顧者的喘息資源導航 POC。以簡短問卷整理聯絡路徑、官方居家喘息名錄、聯絡摘要及本機行動清單。執行時不使用 LLM，也不需後端或登入。

## 開發與檢查

需要 Node.js 24.x 及 npm。在 repository 根目錄執行：

```bash
cd carepass
npm ci
npm run dev
```

開啟終端機顯示的本機網址，預設為 `http://127.0.0.1:5173/`。網站支援手機與桌面，以 hash 導覽，重新整理不需伺服器路由設定。

```bash
npm run check
npm test
npm run build
```

`build` 只產生 `dist/index.html`，JS、CSS 及官方資料快照嵌入同一份 HTML；不會讀取或寫入 Flutter 專案。`dist/` 與 `node_modules/` 不納入版本追蹤。

## 部署與城市通整合

Vercel 設定檔為 `vercel.json`；匯入本 repository 時，**Root Directory 設為 `carepass`**。完整步驟與驗收方式見 [部署說明](DEPLOYMENT.md)。目前尚未建立公開部署網址，由使用者自行部署。

Flutter App 位於獨立的 TownPass repository，兩邊分支皆為 `feature/caregiver`。部署後在 **TownPass repository 根目錄**執行，將範例替換為實際網址：

```bash
flutter pub get
dart run build_runner build
flutter run --dart-define=CAREPASS_URL=https://your-project.vercel.app/
```

依 App 的 `.fvmrc` 選擇 Flutter；使用 FVM 時在 Flutter／Dart 指令前加上 `fvm`。App 入口為「服務 ＞ 熱門 ＞ 照護通」，或「服務 ＞ 更多 ＞ 防疫醫療」。`local://carepass` 對應 App 內的 `/carepass` 路由，WebView 實際載入設定的 HTTPS 網址。

只接受有效且不含帳密的 HTTPS 網址；未設定時顯示服務尚未設定，載入失敗可重新載入，不退回內建版本。`CAREPASS_URL` 是 Flutter 編譯時設定，不是 Vercel 的環境變數。網頁更新並部署到相同網域後，不需重裝 App。

撥號使用既有 `phone_call` bridge；官方連結以 `open_link` 另開網頁，保留照護通畫面與清單。localStorage 依 origin 分開保存，不會從舊內建網頁自動搬到新網域。

## 官方資料與更新

- [臺北市長照喘息服務特約單位](https://data.taipei/dataset/detail?id=959c34b2-9698-4d99-8987-d389efe18c04)：第一版使用居家式資源。
- [原始居家式 CSV](https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=cf41693d-b35e-4744-8c37-d6505c54c13a)。
- [衛福部長照申請流程](https://1966.gov.tw/LTC/cp-6533-70777-207.html)：申請、評估、照顧計畫與服務銜接的參考來源。

`data/home.csv` 保留官方 Big5 快照；`data/source.json` 記錄來源、編碼、取得時間與來源更新時間。更新程序：

1. 從來源下載新版 CSV，檢查內容後取代 `data/home.csv`。
2. 依實際來源更新 `data/source.json` 的日期，不能把下載日當作內容更新日。
3. 執行 `npm run data:import`。
4. 檢查 `data/import-report.json` 的筆數及異常，人工抽查服務區別。
5. 執行測試及 build，將新快照、報告與原始碼一起提交，重新部署網站。

匯入採 Big5 解碼、必要欄位檢查與穩定識別碼；空檔、欄位異動或疑似重複會停止更新並保留既有 JSON。依「服務區別」篩選，不使用機構所在地替代。來源的「全區」及無法完整解析的範圍另列待確認，不作為已確認涵蓋指定行政區的結果。

目前官方快照共 165 筆居家式單位，其中 90 筆可完整解析服務區別、75 筆範圍待確認。名錄沒有即時空位或可服務時段；所有範圍與安排仍須洽正式窗口確認。資料原始地址及其他內容可能有缺漏，本服務不自行補造。

名稱含停業或暫停派案註記的單位另列服務狀態待確認，包含已過期的註記；不自行推斷已恢復服務。原始行動電話有 22 筆疑似缺少前導零，保留原文並列入異常報告，格式未確認前不提供直接撥號。

## UI 設計來源

網頁的 `src/tokens.css` 對照獨立 TownPass repository 的 `lib/util/tp_colors.dart`、`tp_text_styles.dart`、`tp_button.dart` 與 `tp_card.dart`：使用 primary500 `#5AB4C5`、灰白背景、白色卡片、10px 按鈕圓角與 3px 卡片圓角。表單、選取狀態、提示、單位清單及底部導覽共用這些 tokens。

主要按鈕使用 primary950 深色標籤，維持正常字級的文字對比；文字連結與選取文字使用 primary700。手機版收斂裝飾插圖，保留清楚的主要行動與至少 48px 操作高度。App 內偵測既有 bridge 後隱藏網頁標頭，由原生 TownPass AppBar 提供標題；一般瀏覽器保留網頁標頭。修改樣式後需重新 build 並部署網站；保持相同 HTTPS 網址即可，不需重新建置 App。

## 本機保存與驗證限制

清單包含選項答案、聯絡摘要、選用的公開單位資訊及手動待辦，使用 `carepass.plan.v1` 儲存於 localStorage。沒有姓名、完整住址、病歷或帳號同步；可在「我的清單」清除。寫入失敗或舊資料無法讀取時有明確提示，可先手動複製摘要。

撥號回覆只代表可以交由裝置開啟，不代表接通、已聯絡或已安排服務。清單進度由使用者更新，電話操作不會自動完成待辦。沒有排程通知、資格判定、付款或即時預約。

測試包含分流優先序、未知答案、跨區服務、Big5 匯入、範圍未確認、時段摘要、儲存恢復與損壞、bridge 訊息。Flutter repository 另有服務入口、網址設定與 HTTPS 整合測試。真實裝置電話行為、平台儲存持續性及讀屏仍應在目標裝置驗證；照顧者測試與長照流程專業複核尚待安排。

拆分前的內建網頁曾在 iPhone 17 Pro／iOS 26.5 模擬器通過完整流程；此紀錄不能代表拆分後的 HTTPS 流程已通過。部署後請在獨立 TownPass repository 根目錄重新執行：

```bash
flutter test integration_test/carepass_test.dart -d <模擬器或測試裝置ID> --dart-define=CAREPASS_URL=https://your-project.vercel.app/
```

完整驗證紀錄見 [驗證結果](../docs/CAREPASS_VERIFICATION.md)。

## 授權

新增 CarePass 程式碼採根目錄 AGPL-3.0，既有城市通授權保留於獨立 TownPass repository 的 `LICENSE`。第三方清單及執行時 MIT 授權文字見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。政府開放資料授權依來源平台條款，主辦指定聲明待取得原文後補齊。
