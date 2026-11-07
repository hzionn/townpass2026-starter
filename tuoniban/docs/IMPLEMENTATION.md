# 託你辦：實作決定紀錄

這份文件記錄**規格 v1.3 沒講清楚、實作時必須選一邊**的地方，以及和規格不同的決定。規格本身沒變的部分不重複，請看 `託你辦_MVP_SPEC_v1.3.md`（沒有放進 repo，向組長拿）。決選問答被問到「為什麼這樣設計」時，可以從這裡找答案。

## 和規格 P10 建議不同的地方

P10 寫明框架可換、契約不變，所以以下都不算違反規格。

| 規格建議 | 實際採用 | 原因 |
|---|---|---|
| React 前端 | Vue 3 + TypeScript | 隊伍決定 |
| 只有 SQLite + 私有目錄 | SQLite + 私有目錄（預設，部署到 GCP VM）；設了 `DATABASE_URL` 會改用 Postgres | Postgres 是給沒有持久磁碟的平台（Vercel、Cloud Run）準備的備案，目前的部署用不到 |

## 和規格內容不同的地方：地點改用開放資料

規格 §6.2 的 `locationPreference` 是兩個虛構據點（`site-a`、`site-b`）。**我們改成衛生局開放資料的 85 家真實特約機構**，選項 id 從機構名稱和地址算出來。

- **原因：** 比賽硬規則要求核心資料是公開合法的開放資料，違反可能被扣分或取消資格。§13.1 也寫明這件事在繳交前要有結論。§6.2 的值只是規格的實作預設，不是使用者決策（§1.2），所以比賽規則優先。
- **資料集：** [臺北市老人健康檢查特約醫事機構](https://data.taipei/dataset/detail?id=9a1aefde-2e4a-467c-9ec4-256e33ad6df0)，臺北市政府衛生局，依政府資料開放授權條款第 1 版，每年更新，2026-07-13 最後異動。
- **影響範圍：** S04 的地點下拉選單（依行政區分組）、S05 和 S06 顯示的地點名稱、`shared/form.ts` 的驗證。API 路徑和欄位名稱不變，只是值不再是固定列舉。
- **仍是模擬的部分：** 日期、時段、名額和預約本身都是模擬，畫面繼續標示「模擬服務」，並說明不會送出真實預約。這份資料沒有名額或時段資訊，不能宣稱有。
- **隱私：** 匯入時只留機構名稱、地址和行政區。原始檔的電話欄位不進 repo。
- **更新方式：** `scripts/import-healthcheck-sites.mjs`，原始檔是 Big5 編碼。
- **怎麼改回去：** 把 `server/src/service-config.ts` 的地點選項換回兩個示範據點即可，其他程式都從服務設定讀。

## 儲存層

兩種模式共用同一份 SQL 和同一份商業邏輯，差別只在 `server/src/storage/` 的轉接層。

| | SQLite 模式（預設） | Postgres 模式 |
|---|---|---|
| 觸發條件 | 沒設 `DATABASE_URL` | 有設 `DATABASE_URL` |
| 適合 | 本機、筆電 + HTTPS tunnel、GCP VM（目前的部署） | 沒有持久磁碟的平台（備案，未部署過） |
| 附件存放 | `PRIVATE_UPLOAD_DIR` 目錄 | 資料庫 `attachment_blobs` 表 |
| 寫入序列化 | `BEGIN IMMEDIATE` + 程序內佇列 | 交易內 `pg_advisory_xact_lock` |

**為什麼所有寫入都排成一列：** 規格 §10.7 要求「提交」和「停止」不能交錯。把每個寫入交易都排隊，停止先完成提交就被拒絕，提交先完成回執就保留，不必逐一分析競爭情況。展示用的流量很小，排隊沒有效能問題。

**附件上限：** 預設 5 MiB，可以用 `MAX_UPLOAD_BYTES` 指定；畫面文字來自服務設定，會跟著變。`config.ts` 裡偵測 Vercel 時改成 4 MiB 的分支是早期考慮 Vercel 時留下的，目前不部署到 Vercel。

## 授權狀態怎麼算

資料庫存 `issued`、`active`、`completed`、`revoked`、`expired`，但**時間到期不靠排程**，每次請求都用伺服器時間重新判定（§7.1）：

- `issued` 且現在 ≥ `claimExpiresAt`：視為 `expired`
- `active` 且現在 ≥ `accessExpiresAt`：視為 `expired`
- `completed` 過了 `accessExpiresAt`：本人仍看到 `completed`，代辦被拒絕（§7.1）

邊界：到期時間那一刻就算到期（`now < expiresAt` 才有效）。

因為資料庫裡可能殘留「其實已到期」的 `issued`/`active`，建立新 grant 前要在同一個交易裡先把它結算成 `expired`，否則會撞上「一人一服務最多一筆未終止 grant」的唯一索引。

`revoke` 對任何狀態都成立且可重送。對 `completed` 也成立：回執保留，只關閉代辦的讀取權（§10.7）。

重新產碼時，舊 grant 標成 `revoked`。

## 領取（redeem）的回應

先判斷這張碼有沒有被別人領走，**被別人領走的碼不再透露任何狀態**（§4.2）。

| 情況 | HTTP | code |
|---|---|---|
| 不是代辦 persona | 403 | `ACTION_FORBIDDEN` |
| 格式不符、查無此碼 | 400 | `INVALID_LINK` |
| 未被領取，已停止或已被重新產碼取代 | 400 | `INVALID_LINK` |
| 未被領取，已過 10 分鐘 | 410 | `INVITATION_EXPIRED` |
| 已被**別人**領取（不論狀態） | 409 | `ALREADY_CLAIMED` |
| 自己領取過，本人已停止 | 403 | `ASSISTANCE_REVOKED` |
| 自己領取過，已過 60 分鐘 | 410 | `ACCESS_EXPIRED` |
| 自己領取過，`active` 或 `completed` | 200 | 回原案，不建第二筆 |
| 未被領取且有效 | 200 | 綁定並建立草稿，revision = 1 |

## 檢查順序

每個案件 API 都先擋身分和權限，再看內容，避免洩漏資訊。

**讀取和修改共通：** session（401）→ persona（403）→ 案件存在且屬於自己（404，查無和不屬於自己回一樣的結果）→ grant 已停止（403）→ grant 已到期（410）。

**PATCH 草稿：** 共通檢查 → 已送出（409 `ALREADY_SUBMITTED`）→ JSON 結構，必須剛好七欄、沒有多餘欄位（400 `INVALID_JSON`）→ revision（409）→ 欄位內容（422）。

欄位**型別或內容**錯誤算 422（會標在欄位上），**結構**錯誤（多欄、少欄）才算 400。所以偷塞 `state` 或 `helperId` 會得到 400。

**附件上傳：** 共通檢查 → 已送出 → requirementId → 已有附件（409 `ATTACHMENT_EXISTS`）→ revision → 檔案本身。已有附件排在 revision 前面，是因為回應遺失後重傳時，「已經傳過了」比「版本不符」更有用。

**送出：** 共通檢查 → JSON 結構 → 已有提交紀錄（同 key 同 fingerprint 回原結果；同 key 不同 fingerprint 回 `IDEMPOTENCY_CONFLICT`；不同 key 回 `ALREADY_SUBMITTED`）→ revision → 完整驗證（422）→ 同一交易寫入快照、回執、狀態。

request fingerprint 是 `caseId` 加 `expectedRevision` 的雜湊。冪等鍵必須是 UUID，否則回 400。

附件的錯誤標在 `fieldErrors['practice-document']`。0 byte 算 422，型別不符算 415，太大算 413。

## Session

- Cookie 值是 `隨機 id.HMAC 簽章`，資料列存在後端，`SESSION_SECRET` 用來簽章。
- `POST /api/demo/session` 帶著有效 cookie 時沿用同一列，只改 persona 並延長 8 小時，所以同一個瀏覽器切換身分不會失去 `helperId`（§10.2）。
- `GET /api/session` 的 `recentCaseId` 看的是這個瀏覽器的 helper 身分，不看目前 persona；前端點「繼續上次協助」時先切回代辦。
- 整個系統只有一位預載申請者 `applicant-a`，所以**同一時間只能跑一組展示**。展示前請跑 `npm run demo:reset`。

## CSRF 與來源

會改資料的請求（POST、PATCH、DELETE）要求 `Origin` 等於 `PUBLIC_ORIGIN`；沒有 `Origin` 時接受 `Sec-Fetch-Site: same-origin`，兩者都沒有就拒絕（403 `ACTION_FORBIDDEN`）。`PUBLIC_ORIGIN` 設錯時所有寫入都會失敗，這是最常見的部署錯誤。

## 城市通整合（已讀 `hzionn/TownPass` 原始碼）

- `TPWebView` 沒有設定 `onPermissionRequest`，App 內的網頁**很可能拿不到相機**，所以 App 內一律走 `qr_code_scan` bridge，不走 `getUserMedia`。
- 使用者取消掃碼時，bridge 回 `{ name: 'qr_code_scan', data: null }`，要當成「沒事發生」。
- `flutterObject` 在網頁載入前就注入，同步判斷即可。
- App 的標題列顯示網頁的 `document.title`，所以每頁都要設定有意義的標題。
- App 內開檔案選擇器的行為尚未實機驗證，因此 S04 另外提供「使用內建合成範例」按鈕，內容仍走同一支上傳 API。這是規格之外唯一新增的畫面元素，目的是讓 Demo 不依賴手機裡有沒有檔案。

## 和線框圖不同之處

線框圖裡這些是**給開發者看的註解，不是產品畫面**，不實作：狀態列（9:41）、頁尾「低保真線框示意」、S02 的「同一畫面的狀態變化」方塊、S07 的「共用例外狀態」方塊、QR 示意圖。

## 協助連結的 token 什麼時候清掉

規格 S03 寫「領取後清除 URL fragment」。我們在伺服器**有回答這個碼**時才清（成功、無效、到期、已被領取、已停止）。斷線、5xx、429 不是對這個碼的回答，所以保留 fragment，讓 S07 的「重試」能用同一個碼再領一次。

## 在城市通裡的頁首

App 的標題列已經顯示網頁的 `document.title`，所以偵測到 `window.flutterObject` 時，頁首不再顯示「託你辦」，改成「回首頁」連結（首頁本身不顯示），「模擬服務」標籤保留。

## 本人的協助紀錄（規格 v1.3 之外，對應提案 info.md 的 E05）

S02 下方的「協助紀錄」讓本人看到這次協助裡誰在什麼時候做了什麼，回答決選問答的「透明」面向。

- **資料來源：** 直接讀既有的 `audit_events`，沒有新增資料表。隨 `GET /api/my-assistance` 的 `activity` 欄位一起回來，所以跟狀態同一次輪詢更新。
- **只回種類和時間：** 轉換在 `server/src/activity.ts`，回應裡沒有 actor id、案件 id、錯誤細節，也沒有填寫內容。
- **產生協助碼**用 grant 本身的 `created_at`，不看 audit。原因是重新產碼的 audit 記在舊 grant 上，新 grant 沒有自己的建立事件。
- **只算一次：** 領取（同一位代辦重掃）、送出（冪等重送）、停止（重按）只顯示第一次。
- **合併連續重複：** 例如連續儲存草稿三次顯示「（3 次）」，時間取最後一次。最多回 30 筆，新的在前。
- **系統已擋下：** 代辦者的操作（領取、存草稿、上傳、刪附件、送出）因為 `ASSISTANCE_REVOKED` 或 `ACCESS_EXPIRED` 被拒絕時顯示。為了讓這些拒絕記到這個 grant 上，`requireHelperCase` 多收一個 `audit` 參數，在確認案件屬於這位代辦之後、檢查停止和到期之前先填 grant id。別人掃到已被領取的碼（`ALREADY_CLAIMED`）、陌生人打案件 API（404）、版本衝突都不顯示，跟「被別人領走的碼不再透露任何狀態」一致。
- **漏記的情況：** 附件上傳在讀檔案之前有一道預先檢查，停止後的上傳在那裡就被擋下，不會進 audit，所以不會出現在紀錄裡。存草稿和送出都會。
- **時間相同的事件：** 同一毫秒的兩筆 audit 排序不固定。實際操作不會發生，測試裡每步之間都把時鐘往前撥。

## 已知限制（Demo 前要知道）

- **城市通裡的返回鍵：** App 只有標題列的返回會走網頁的上一頁，Android 系統返回鍵和右上角關閉會直接關掉網頁視窗，S04 未儲存的內容不會提示。要改得動 Flutter 的 `tp_web_view.dart`，這次沒有做。Demo 時先按「儲存草稿」。
- **Session 中途失效：** 例如同一個瀏覽器另開分頁切成申請者，代辦那頁下一次存檔會直接回首頁，未儲存的輸入不保留。兩支手機各自操作就不會遇到。
- **S01「繼續上次協助」：** 一律先進 S04，已送出的案件再自動轉到 S06，會閃一下「載入中」。

## 尚未解決

- **開放資料是否足夠：** 地點清單是真的開放資料，但產品的主要價值（授權協作）本身不依賴開放資料。這樣算不算滿足「核心資料」要看評審認定，建議到現場 Coding 診療室確認。
