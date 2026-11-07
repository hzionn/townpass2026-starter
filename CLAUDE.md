# CLAUDE.md

這是 2026 臺北秋季程式設計節「城市通微服務大黑客松」的參賽 repo。作品「託你辦」的程式都在 `tuoniban/`：前端 Vue 3 + Vite + TypeScript（`web/`），後端 Node.js 22.13 以上 + Express 5 + TypeScript（`server/`），共用型別在 `shared/`，資料存 SQLite，部署到 GCP VM 並用 Caddy 提供 HTTPS（`deploy/`）。怎麼跑、怎麼測、怎麼部署看 `tuoniban/README.md`，實作取捨看 `tuoniban/docs/IMPLEMENTATION.md`。技術或作品有變動時，更新這份文件和 `.claude/rules/decisions.md`。

## 隊伍背景

全隊 5 人都不熟 Flutter、TownPass 和它的服務架構，開發時間只有 23.5 小時。

- 解釋時先用白話，不要預設對方懂 Flutter、Dart 或這個專案，再指到具體檔案。
- 先給最短可行路徑，理論等需要時再補。
- 手冊的原則是「完成比完美更重要」，優先選能穩定 demo 完整情境的做法。
- 決選有問答，提醒隊友讀過 AI 寫的程式碼，要能說明設計考量。

## 比賽硬規則

提方案、選套件或寫功能前都要對照，違反可能被扣分或取消資格：

- **只用開源、免費的軟體和套件。** 不用 Google Maps 這類商用地圖，改用 Leaflet 或 MapLibre 搭配 OpenStreetMap。新增套件前確認授權：MIT、BSD、Apache-2.0 可以，標示僅供個人使用或不得再散布的不要用。
- **核心資料必須是公開合法的開放資料，並註明來源。** 非必要資料可以用模擬資料，但要標示。不要憑記憶寫 API 網址、資料集名稱或欄位，要實際打開來源確認。
- **作品執行時的 LLM 推論必須完全在裝置端，** 不得呼叫任何遠端模型，也不得使用「危害國家資通安全產品」（含大陸廠牌）。開發時可以用雲端 AI。預先生成的內容不能宣稱是即時 AI 功能。
- **Demo 只能展示實際運作的畫面，** 不能用任何形式的簡報。
- **成果以 AGPL-3.0 公開。**

## 工作方式

- `main` 不能直接 push：開 branch、發 PR，也不要 force push。
- 比賽成果最後必須公開，所以不要 commit 金鑰、密碼或個資。
- 這個 repo 是全隊共用的，不要寫入個人電腦的路徑或環境設定；個人設定放 `~/.claude/CLAUDE.md`。
- 隊伍有新決定時更新 `.claude/rules/decisions.md`，讓全隊的 agent 都看得到。

## 共用資料

`.claude/rules/` 的檔案會在每次對話開始時自動載入，全隊共用：

- `hackathon.md`：主題方向、時程、完整規則、評分、繳交項目、攜帶清單
- `townpass-integration.md`：作品和城市通 App 的關係、掛進 App 的步驟、雙向溝通、部署、往屆範例
- `decisions.md`：目前的題目、作品、技術選型、分工
- `links.md`：官方文件、開放資料平台、官方 GitHub 的網址

這些內容整理自官網和工作坊手冊（2026-11-07），主辦單位保留修改權。規則有疑問時回官網或問現場 Coding 診療室，不要用猜的。
