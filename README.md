# townpass2026-starter

2026 臺北秋季程式設計節「城市通微服務大黑客松」的隊伍起始 repo。

題目已於 2026-11-07 公布，隊伍組別為「用不了」。目前包含團隊共用規範，以及 `feature/caregiver` 開發的照護通 CarePass；Flutter App 已拆回獨立的 TownPass repository；實作與驗證狀態見下方連結。

## 裡面有什麼

| 路徑 | 內容 |
|---|---|
| `CLAUDE.md` | 給 AI agent 的指示：比賽硬規則、協作方式、共用資料索引 |
| `.claude/rules/hackathon.md` | 主題方向、時程、規則、評分、繳交項目、攜帶清單 |
| `.claude/rules/townpass-integration.md` | 作品怎麼掛進城市通 App、網頁怎麼呼叫 App 功能、怎麼部署 |
| `.claude/rules/decisions.md` | 隊伍的決定：題目、作品、技術、分工（比賽中持續更新） |
| `.claude/rules/links.md` | 官方文件、開放資料平台等網址 |

`.claude/rules/` 是 Claude Code 的官方位置，每次對話開始都會自動載入。這些檔案也是一般的 Markdown，隊友可以直接打開來看。

## 我們要做的東西

目前 `feature/caregiver` 已加入 **照護通 CarePass**：透過城市通 WebView，協助家庭照顧者整理喘息需求、官方資源與聯絡行動清單。

| 目錄 | 用途 |
|---|---|
| `carepass/` | React／TypeScript 網頁原始碼、官方資料快照及測試 |
| `docs/` | 修正版 POC 規格與開發流程 |

前端開發請見 [CarePass README](carepass/README.md)，Vercel 設定與部署步驟請見 [部署說明](carepass/DEPLOYMENT.md)。Flutter App 位於獨立的 [TownPass repository](https://github.com/hzionn/TownPass)，兩邊分支皆為 `feature/caregiver`；App 透過 `CAREPASS_URL` 載入部署後的 HTTPS 網址。本 repository 不包含 Flutter 原始碼或 App 封裝資產。

一句話：**做一個手機版網頁，放上網路取得網址，再從城市通 App 裡打開它。**

城市通 App 是用 Flutter 寫的，裡面有一個內嵌瀏覽器（WebView）會載入我們的網址。網頁可以用任何語言或框架寫，需要定位、掃碼、通知時，再透過 App 提供的介面呼叫。所以全隊不需要先學會 Flutter，App 通常只要改幾個檔。

## 開始使用

1. Clone 這個 repo：

   ```bash
   git clone https://github.com/hzionn/townpass2026-starter.git
   ```

2. 在 repo 根目錄開啟 Claude Code，它會自動載入 `CLAUDE.md` 和 `.claude/rules/`。用其他 AI 工具的話，先請它讀這些檔案。
3. 可以先這樣問它：

   - 「用白話解釋我們要做什麼，我應該先學什麼？」
   - 「今天的時程和最重要的規則是什麼？」
   - 「這個想法有沒有違反比賽規則？」

## 協作方式

所有改動都走 PR，不能直接 push 到 `main`，也不能 force push 或刪除 `main`。目前不需要別人 approve 就能 merge。

```bash
git switch -c feat/my-change
git add <要提交的檔案>
git commit -m "說明這次改動"
git push -u origin feat/my-change
gh pr create --fill
```

沒有裝 `gh` 的話，push 後到 GitHub 網頁開 PR 也可以。

比賽成果最後必須公開，所以請把這個 repo 當成公開的來用：**不要 commit API key、金鑰、密碼或個資。**

## 繳交前要補上

以下是比賽要求或手冊建議的項目，這裡都還沒有，完賽前要補齊（細節見 `.claude/rules/hackathon.md`）：

- `LICENSE`：AGPL-3.0，加上主辦單位指定的聲明
- 讓別人能照著建置的執行說明（可以直接寫在這份 README）
- 資料來源清單和第三方套件清單（可以從 `.claude/rules/decisions.md` 整理）
- 作品有用裝置端 AI 時的模型揭露
- 把 repo 設為公開，並保持公開至少一年
