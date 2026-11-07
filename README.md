# townpass2026-starter

2026 臺北秋季程式設計節「城市通微服務大黑客松」的隊伍起始 repo。

我們的作品是 **[託你辦｜授權協作申辦與預約平台](tuoniban/README.md)**：不方便自己上網申辦的人產生 QR Code，信任的家人或照顧者用自己的手機掃碼接手填表、上傳附件並模擬送出；本人看得到進度，也能隨時停止。

怎麼跑、怎麼測、怎麼部署、資料來源和套件清單，都在 [`tuoniban/README.md`](tuoniban/README.md)。

## 裡面有什麼

| 路徑 | 內容 |
|---|---|
| `tuoniban/` | 作品程式碼：前端 Vue 3 + TypeScript、後端 Node.js + Express + TypeScript、部署檔、城市通 patch |
| `LICENSE` | AGPL-3.0 |
| `CLAUDE.md` | 給 AI agent 的指示：比賽硬規則、協作方式、共用資料索引 |
| `.claude/rules/hackathon.md` | 主題方向、時程、規則、評分、繳交項目、攜帶清單 |
| `.claude/rules/townpass-integration.md` | 作品怎麼掛進城市通 App、網頁怎麼呼叫 App 功能、怎麼部署 |
| `.claude/rules/decisions.md` | 隊伍的決定：題目、作品、技術、分工（比賽中持續更新） |
| `.claude/rules/links.md` | 官方文件、開放資料平台等網址 |

`.claude/rules/` 是 Claude Code 的官方位置，每次對話開始都會自動載入。這些檔案也是一般的 Markdown，隊友可以直接打開來看。

## 我們要做的東西

一句話：**做一個手機版網頁，放上網路取得網址，再從城市通 App 裡打開它。**

城市通 App 是用 Flutter 寫的，裡面有一個內嵌瀏覽器（WebView）會載入我們的網址。網頁可以用任何語言或框架寫，需要定位、掃碼、通知時，再透過 App 提供的介面呼叫。所以全隊不需要先學會 Flutter，App 通常只要改幾個檔。

## 在模擬器中執行

請參考 [`RUN_ON_EMULATOR.md`](RUN_ON_EMULATOR.md)：託你辦 iOS／Android 模擬器執行指南。

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

比賽要求或手冊建議的項目（細節見 `.claude/rules/hackathon.md`）：

- [x] `LICENSE`：AGPL-3.0 全文
- [ ] `LICENSE` 加上主辦單位指定的聲明（文字在工作坊手冊，向組長拿）
- [x] 讓別人能照著建置的說明：[`tuoniban/README.md`](tuoniban/README.md)
- [x] 資料來源清單、第三方套件清單、AI 使用揭露：都在 `tuoniban/README.md`
- [ ] 把 repo 設為公開，並保持公開至少一年
- [ ] 城市通 App 的修改（`tuoniban/townpass/tuoniban-service.patch`）套用到 `hzionn/TownPass` 並換成部署網址
