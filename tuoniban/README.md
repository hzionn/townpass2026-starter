# 託你辦｜授權協作申辦與預約平台

**不方便自己上網申辦的人按一下產生 QR Code，信任的家人或照顧者用自己的手機掃碼，就能接手填表、上傳附件並送出；本人看得到進度，也能隨時停止。**

這是 2026 臺北秋季程式設計節「城市通微服務大黑客松」的參賽作品，組別是「用不了」。目前是**模擬服務**：只用虛構資料，送出的內容不會交給政府或醫院。

核心主張：**你來幫忙，我來決定。**

- 申請者（本人）：長輩、視障者等不熟悉或不便操作數位服務的人。只要產碼、看狀態，不用填複雜表單。
- 代辦者：子女、照顧者等本人信任的人。用自己的手機接手，不用借本人的帳號或手機，也看不到本人的身分原值。
- 範例服務：「長者健檢預約需求（模擬）」，地點選項來自臺北市的開放資料。

規格（`託你辦_MVP_SPEC_v1.3.md`）沒有放進 repo，向組長拿；實作時的取捨記在 [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md)，決選問答被問到「為什麼這樣設計」可以從那裡找。

## 畫面

| 畫面 | 網址 | 誰用 | 做什麼 |
|---|---|---|---|
| S01 共用首頁 | `/` | 所有人 | 選「我要請人幫忙」或「我要幫忙」；有進行中的協助時多一個「繼續上次協助」 |
| S02 本人產碼與狀態 | `/my-assistance` | 申請者 | 按「同意並產生協助碼」，顯示 QR Code、剩餘時間、分享或複製連結；畫面自動更新成待領取、有人正在協助、代辦者已模擬送出；隨時可以「停止協助」 |
| S03 掃碼／貼連結 | `/scan`，連結是 `/assist#token=…` | 代辦者 | 「掃描協助碼」（在城市通裡用 App 掃碼，一般瀏覽器用相機），或貼上協助連結 |
| S04 範例表單與附件 | `/cases/:id/edit` | 代辦者 | 只看到「身分資料已備妥」，看不到原值；填偏好地點、日期、時段、是否陪同、代辦稱呼和電話；上傳一份合成練習附件；「儲存草稿」、「下一步：確認內容」 |
| S05 確認摘要 | `/cases/:id/review` | 代辦者 | 檢查內容，按「確認並模擬送出」 |
| S06 結果 | `/cases/:id/result` | 代辦者 | 模擬編號和送出時間，並說明尚未送交政府或醫院 |
| S07 錯誤和停止狀態 | 顯示在原本的頁面 | 兩者 | 無效的碼、已被別人領取、已到期、本人已停止、連不上等，各有重新掃碼、回首頁或重試的按鈕 |

時間限制：協助碼要在 10 分鐘內被領取；協助權限從產碼起 60 分鐘有效；展示用的 session 8 小時。

## 資料夾

| 路徑 | 內容 |
|---|---|
| `web/` | 前端：Vue 3 + Vite + TypeScript |
| `server/` | 後端 API：Node.js + Express 5 + TypeScript，部署時也由它提供網頁檔案 |
| `shared/` | 前後端共用的型別、表單驗證和協助連結檢查 |
| `e2e/` | 端對端測試（Playwright） |
| `scripts/` | 授權清單、開放資料匯入、合成附件產生 |
| `deploy/` | 部署到 GCP VM 用的檔案 |
| `townpass/` | 把服務掛進城市通 App 的 patch 和說明 |
| `docs/IMPLEMENTATION.md` | 實作決定 |

資料預設存在 SQLite 資料庫檔案和一個私有附件資料夾。設了 `DATABASE_URL` 會改用 Postgres，這是選用功能，我們的部署方式用不到。

## 在自己電腦上跑

需要 Node.js **22.13 以上**（用到內建的 `node:sqlite`），先用 `node -v` 確認。

```bash
cd tuoniban
npm ci
npm run dev
```

打開 <http://localhost:5173>。

- `npm run dev` 同時啟動 API（port 8787）和網頁（port 5173，網頁的 `/api` 請求會轉給 API），改程式會自動重新載入。
- 不需要 `.env`。資料存在 `tuoniban/.data/`，這個資料夾不會被 commit。
- 一台電腦模擬兩支手機：一般視窗當本人，無痕視窗（或另一個瀏覽器）當代辦，兩邊的身分才不會混在一起。
- 想看手機版面，用 Chrome 開發者工具的手機模擬。

### 用兩支手機測試

手機打不開電腦的 `localhost`：對手機來說，`localhost` 是手機自己。下面兩種做法都改用建置好的版本（`npm run build` 後 `npm start`，port 8787），因為開發用的網頁伺服器只接受 localhost 連線。改了程式要重新 `npm run build`，再重新 `npm start`。

| 做法 | 適合 | 限制 |
|---|---|---|
| A. HTTPS tunnel | 手機和電腦不在同一個網路、要測相機掃碼 | tunnel 重開後網址可能會變，要跟著改 `.env` |
| B. 同一個 Wi-Fi | 快速看畫面 | 不是 HTTPS，手機瀏覽器不能開相機；場地 Wi-Fi 可能擋裝置互連 |
| C. 部署到 VM | 正式展示、從城市通 App 打開 | 見下面「部署到 GCP VM」 |

**A. HTTPS tunnel**（以開源、免費、不用註冊的 [cloudflared](https://github.com/cloudflare/cloudflared) 為例）

1. `npm run build`
2. 另開一個終端機：`cloudflared tunnel --url http://localhost:8787`，畫面會印出一個 `https://xxxx.trycloudflare.com` 網址。
3. `cp .env.example .env`，在 `.env` 填：
   - `PUBLIC_ORIGIN=https://xxxx.trycloudflare.com`（換成上一步的網址，結尾不加 `/`）
   - `SESSION_SECRET=`後面貼上 `openssl rand -hex 32` 的輸出（HTTPS 時一定要設）
4. `npm start`
5. 兩支手機都打開那個 `https://` 網址。

**B. 同一個 Wi-Fi**

1. `npm run build`
2. 查電腦在 Wi-Fi 上的 IP：macOS 用 `ipconfig getifaddr en0`，Windows 用 `ipconfig` 看「IPv4 位址」，Linux 用 `hostname -I`。
3. `cp .env.example .env`，填 `PUBLIC_ORIGIN=http://192.168.1.23:8787`（換成你的 IP）。
4. `npm start`。macOS 問要不要允許 node 接受連線時選允許。
5. 手機打開 `http://192.168.1.23:8787`。因為不是 HTTPS，代辦者不能用網頁的相機掃碼，改用手機內建相機 App 掃 QR Code（會直接打開協助連結），或由本人分享連結、代辦者貼上。

## 測試

```bash
npm test                                  # 單元測試和 API 測試（Vitest）
npm run typecheck                         # 型別檢查
npx playwright install chromium webkit    # 第一次跑端對端測試前，下載測試用的瀏覽器
npm run build && npx playwright test      # 端對端測試，也可以用 npm run test:e2e（一樣要先 build）
```

- `npm test` 的 API 測試會跑兩次：一次 SQLite、一次 Postgres。Postgres 由 `embedded-postgres` 在本機自動起一個暫時的，不用自己安裝。也包含前端元件和共用驗證的測試。
- 端對端測試會用建置好的伺服器（port 4173）和暫時的 SQLite，模擬 Android（Chromium）和 iPhone（WebKit）兩種手機，不會動到 `.data/`。涵蓋 2 分鐘展示流程、直接開連結、停止協助、外部連結被拒絕、城市通掃碼 bridge（模擬）、無障礙檢查和 320px 寬度。

### 驗收對照（規格 §11.2）

| 驗收 | 自動測試在哪裡 |
|---|---|
| AT01 共用入口 | `server/tests/suites/session.ts` |
| AT02 產碼 | `server/tests/suites/grants.ts` |
| AT03 領取 | `server/tests/suites/redeem.ts`、`e2e/demo-flow.spec.ts` |
| AT04 重掃競爭 | `server/tests/suites/redeem.ts`、`e2e/demo-flow.spec.ts` |
| AT05 碼驗證 | `server/tests/suites/redeem.ts`、`grants.ts`、`shared/assistLink.test.ts`、`e2e/demo-flow.spec.ts` |
| AT06 草稿 | `server/tests/suites/draft.ts`、`e2e/demo-flow.spec.ts` |
| AT07 日期驗證 | `server/tests/suites/draft.ts`、`shared/form.test.ts` |
| AT08 附件 | `server/tests/suites/attachments.ts` |
| AT09 正常送出 | `server/tests/suites/submit.ts`、`e2e/demo-flow.spec.ts` |
| AT10 重試 | `server/tests/suites/submit.ts` |
| AT11 隱私與越權 | `server/tests/suites/privacy.ts`、`e2e/demo-flow.spec.ts` |
| AT12 停止與到期 | `server/tests/suites/revoke-expiry.ts`、`e2e/demo-flow.spec.ts` |
| AT13 衝突與錯誤 | `server/tests/suites/draft.ts`、`session.ts`、`revoke-expiry.ts` |
| AT14 可及性 | `e2e/demo-flow.spec.ts`（axe 檢查、320px）；200% 縮放、螢幕閱讀器、相機被拒要手動測 |

自動測試通過不等於實機驗收通過。實機測試的結果記在這裡：

| 日期 | 裝置 | 測了什麼 | 結果 | 問題 |
|---|---|---|---|---|
| | | | | |

## 展示前重設資料

系統裡只有一位預載的虛構申請者，所以**同一時間只能跑一組展示**。每次展示前都先重設：

```bash
npm run demo:reset        # 本機
```

會清空所有協助碼、案件、附件和 session，再放回申請者 A。出現 `.env not found. Continuing without it.` 是正常的。手機上已經開著的頁面要回首頁重新選身分。VM 上的做法見下一節。

## 部署到 GCP VM

做法：一台 GCP Compute Engine VM 跑建置好的程式，SQLite 資料庫和附件存在 VM 的磁碟上，前面用 Caddy 自動申請 HTTPS 憑證。

```text
手機 ──HTTPS──▶ Caddy（port 443，自動憑證）──▶ 託你辦（Node.js，port 8787）──▶ SQLite 和附件（VM 磁碟）
```

為什麼不用 Vercel 或 Cloud Run：兩者都沒有持久磁碟，SQLite 的資料每次重啟都會不見。

沒有網域也可以：用 VM 的外部 IP 把點換成橫線，加上 `.sslip.io`，例如 IP 是 `34.80.1.2` 時，網址是 `https://34-80-1-2.sslip.io`。這個名稱會自動指到那個 IP，也能申請 Let's Encrypt 憑證。

| 檔案 | 用途 |
|---|---|
| [`deploy/setup-vm.sh`](deploy/setup-vm.sh) | 在 VM 上安裝 Node.js 22、Caddy，建置並啟動；可以重複執行，更新程式也用它 |
| [`deploy/tuoniban.service`](deploy/tuoniban.service) | systemd 服務檔：用專用帳號執行，開機自動啟動，當掉自動重啟 |
| [`deploy/Caddyfile`](deploy/Caddyfile) | Caddy 設定範本：HTTPS 轉給 port 8787 |
| [`deploy/demo-reset.sh`](deploy/demo-reset.sh) | 在 VM 上重設展示資料 |
| [`deploy/upload-to-vm.sh`](deploy/upload-to-vm.sh) | 在自己電腦執行：不用 commit，直接把程式上傳到 VM 並安裝 |
| [`.env.example`](.env.example) | 每個設定的說明 |

### 0. 事前準備（在自己電腦上）

- 安裝 [gcloud CLI](https://cloud.google.com/sdk/docs/install)，跑 `gcloud auth login` 登入。
- 有一個已啟用帳單的 GCP 專案（新帳號的免費試用額度可以用）。
- 程式碼有兩種送上 VM 的方式：還沒 commit 時用第 4A 步從電腦直接上傳；已經 push 到 GitHub 時用第 4B 步。

```bash
gcloud config set project 你的專案ID
gcloud services enable compute.googleapis.com
```

### 1. 保留固定 IP

網址是用 IP 組成的，IP 變了網址就跟著變，城市通裡的網址也要重改，所以先保留一個固定 IP：

```bash
gcloud compute addresses create tuoniban-ip --region=asia-east1
gcloud compute addresses describe tuoniban-ip --region=asia-east1 --format='value(address)'
```

第二行會印出 IP，例如 `34.80.1.2`，網址就是 `https://34-80-1-2.sslip.io`。

### 2. 建立 VM

```bash
gcloud compute instances create tuoniban \
  --zone=asia-east1-b \
  --machine-type=e2-small \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --boot-disk-size=20GB \
  --address=tuoniban-ip \
  --tags=http-server,https-server
```

`asia-east1` 是彰化機房，離場地最近。`--tags` 是給下一步的防火牆規則用的。

### 3. 開放 80 和 443 port

Caddy 申請憑證要用 80，網站用 443。專案裡已經有同名規則時會顯示 `already exists`，略過即可。

```bash
gcloud compute firewall-rules create default-allow-http \
  --network=default --allow=tcp:80 --source-ranges=0.0.0.0/0 --target-tags=http-server
gcloud compute firewall-rules create default-allow-https \
  --network=default --allow=tcp:443 --source-ranges=0.0.0.0/0 --target-tags=https-server
```

程式本身的 port 8787 沒有開放，外面只能經過 Caddy 連進來。

### 4A. 還沒 commit：從電腦直接上傳並安裝

在自己電腦的 repo 根目錄執行：

```bash
bash tuoniban/deploy/upload-to-vm.sh
```

它會打包目前的 `tuoniban/`（不含 `node_modules`、建置結果、本機資料和 `.env`），上傳到 VM，再在 VM 上執行第 5 步的安裝 script。第一次用 `gcloud compute ssh` 會問要不要建立 SSH 金鑰，按 Enter 用預設值即可。做完直接跳到第 6 步。改了程式之後再跑一次就是更新。

### 4B. 已經 push：登入 VM，從 GitHub 取得程式碼

```bash
gcloud compute ssh tuoniban --zone=asia-east1-b
```

接下來在 VM 上執行：

```bash
sudo apt-get update && sudo apt-get install -y git
sudo git clone --branch main https://github.com/hzionn/townpass2026-starter.git /opt/tuoniban
```

- 程式還沒合併進 `main` 時，把 `main` 換成你的分支名稱。
- repo 還是私人的話，clone 會要求輸入 GitHub 帳號和密碼，密碼要填有這個 repo 讀取權限的 personal access token（GitHub 不接受登入密碼）。不要把 token 寫進任何檔案。比賽規定成果要公開，手冊也建議第一天就公開，公開後就不用 token。

### 5. 執行安裝 script

```bash
sudo bash /opt/tuoniban/tuoniban/deploy/setup-vm.sh
```

它會依序：安裝基本工具、加 2 GB swap（e2-small 記憶體只有 2 GB，建置時可能不夠）、從 NodeSource 安裝 Node.js 22、從 Caddy 官方 apt 套件庫安裝 Caddy、建立服務帳號 `tuoniban` 和資料夾、`npm ci` 和 `npm run build`、產生 `/etc/tuoniban.env`（`SESSION_SECRET` 自動隨機產生）、啟動服務、設定 Caddy，最後檢查 HTTPS 能不能打開。

沒給參數時，網址會用這台 VM 的外部 IP 自動組成 `<IP>.sslip.io`。有自己的網域時（DNS 已指向這個 IP），改成 `sudo bash /opt/tuoniban/tuoniban/deploy/setup-vm.sh 你的網域`。

### 6. 確認

- 手機打開 `https://34-80-1-2.sslip.io`（換成你的網址），應該看到首頁。
- 或在電腦上跑 `curl https://34-80-1-2.sslip.io/api/health`，應該回 `{"data":{"ok":true}}`。

### 7. 填進城市通

城市通 patch 的 `destinationUrl` 填 `https://34-80-1-2.sslip.io/`（結尾要有 `/`），做法見下面「掛進城市通 App」。

### 之後的維護

| 要做的事 | 指令（在 VM 上） |
|---|---|
| 更新程式（用 4A 上傳的） | 在自己電腦再跑一次 `bash tuoniban/deploy/upload-to-vm.sh` |
| 更新程式（用 4B 從 GitHub，先 push） | `sudo bash /opt/tuoniban/tuoniban/deploy/setup-vm.sh` |
| 展示前重設資料 | `sudo bash /opt/tuoniban/tuoniban/deploy/demo-reset.sh` |
| 改設定 | `sudo nano /etc/tuoniban.env`，改完 `sudo systemctl restart tuoniban` |
| 看程式日誌 | `sudo journalctl -u tuoniban -f` |
| 看 Caddy 日誌 | `sudo journalctl -u caddy -f` |

在自己電腦上一行重設展示資料：

```bash
gcloud compute ssh tuoniban --zone=asia-east1-b --command='sudo bash /opt/tuoniban/tuoniban/deploy/demo-reset.sh'
```

更新程式不會清掉資料。VM 上的檔案位置：

| 位置 | 內容 |
|---|---|
| `/opt/tuoniban` | 程式碼：4A 上傳的只有 `tuoniban/`，4B 是 git clone 下來的整個 repo |
| `/etc/tuoniban.env` | 設定，含 `SESSION_SECRET`，只有 root 讀得到 |
| `/var/lib/tuoniban/data` | SQLite 資料庫和附件，只有服務帳號讀得到 |
| `/etc/caddy/Caddyfile` | Caddy 設定 |

### 出問題時

| 狀況 | 原因和處理 |
|---|---|
| 畫面打得開，但儲存、產碼、送出都失敗 | `PUBLIC_ORIGIN` 和網址列不一致（多了 `/`、`http` 和 `https` 不同、主機名稱不同）。改 `/etc/tuoniban.env` 後重新啟動 |
| 服務起不來 | `sudo journalctl -u tuoniban -n 50 --no-pager`，`Configuration error:` 後面會說哪個設定有問題 |
| HTTPS 打不開 | 確認第 3 步的防火牆規則和 VM 的 `http-server`、`https-server` 標記；看 Caddy 日誌 |
| Caddy 日誌說憑證申請被限流（rate limit） | 換成 `nip.io`：`sudo bash /opt/tuoniban/tuoniban/deploy/setup-vm.sh 34-80-1-2.nip.io`，城市通的網址也要一起改 |
| 日誌出現 `ExperimentalWarning: SQLite` | Node 22 的正常提示，不影響運作 |

### 費用

e2-small 不在 GCP 永久免費方案內，會用到免費試用額度或帳單。不再需要時可以停止或刪除 VM：

```bash
gcloud compute instances stop tuoniban --zone=asia-east1-b
```

固定 IP 沒有接在執行中的 VM 上時也會收費，不用時要另外刪除（`gcloud compute addresses delete tuoniban-ip --region=asia-east1`）。刪除前先確認比賽「一年內不得下架」的要求。

## 掛進城市通 App

詳細步驟在 [`townpass/README.md`](townpass/README.md)。簡單說：

1. 在隊伍的 App fork（`hzionn/TownPass`）套用 [`townpass/tuoniban-service.patch`](townpass/tuoniban-service.patch)，它會在「服務 › 更多 › 市政服務」加一個「託你辦」。
2. 把 patch 裡的 `destinationUrl` 換成部署好的網址，也就是 `PUBLIC_ORIGIN` 加上結尾的 `/`。
3. `flutter run`，在 App 裡把「託你辦」加進我的服務。

在城市通裡，S03 的「掃描協助碼」會呼叫 App 的 `qr_code_scan` 掃碼功能；在一般瀏覽器裡改用相機加 jsQR 掃碼，相機不能用時可以貼連結。App 上方的標題列顯示的是網頁標題，所以每頁都有設定標題。

## 2 分鐘展示腳本

依照規格 §12.2 和比賽手冊建議的時間分配。

**展示前：**

- 重設資料（見「展示前重設資料」）。
- 兩支手機都打開託你辦首頁：手機 A 當本人，手機 B 當代辦。最好兩支都從城市通 App 進入；只有一支裝了城市通時，讓它當代辦，才能展示 App 掃碼。
- 準備好代辦的假電話，例如 `0912345678`。

| 時間 | 內容 |
|---|---|
| 0:00–0:15 | 一句話：讓不便操作的人產碼，可信任的人接續幫忙。 |
| 0:15–0:30 | 情境：長輩想預約老人健檢，但不會操作；在外地的子女用自己的手機幫忙，不用借長輩的帳號或手機。 |
| 0:30–1:40 | 實機操作（見下面步驟） |
| 1:40–2:00 | 資料來源和技術：地點來自臺北市衛生局開放資料，其餘標示為模擬；全部使用開源套件；執行時沒有用到 AI。 |

實機操作：

1. 手機 A 按「我要請人幫忙」，再按「同意並產生協助碼」，畫面出現 QR Code。
2. 手機 B 按「我要幫忙」，再按「掃描協助碼」掃手機 A，直接進到表單。手機 A 跟著變成「有人正在協助」。
3. 指出代辦只看到「身分資料已備妥」，看不到本人的身分原值。
4. 手機 B 選偏好地點（衛生局開放資料的特約機構）、日期、時段、是否陪同，填稱呼和假電話，按「使用內建合成範例」上傳附件，再按「下一步：確認內容」。
5. 按「確認並模擬送出」，出現模擬編號。手機 A 更新成「代辦者已模擬送出」，顯示同一個編號。
6. 有時間的話：手機 A 按「停止協助」，手機 B 重新整理結果頁就會顯示本人已停止這次協助；已送出的內容不會被撤回。

掃碼失敗時的備案：手機 A 按「分享連結」或「複製連結」傳給手機 B，手機 B 在掃碼頁貼上協助連結。

## 資料來源

### 開放資料

| 資料集 | 提供機關 | 授權 | 用在哪裡 |
|---|---|---|---|
| [臺北市老人健康檢查特約醫事機構](https://data.taipei/dataset/detail?id=9a1aefde-2e4a-467c-9ec4-256e33ad6df0) | 臺北市政府衛生局 | 政府資料開放授權條款第 1 版 | S04 的偏好地點選單（85 家，依行政區分組），以及 S05、S06 顯示的地點名稱 |

- 來源：臺北資料大平台。資料集最後異動 2026-07-13，我們在 2026-11-07 取得。
- 只保留機構名稱、地址和行政區，原始檔的電話欄位沒有放進 repo。
- 資料存在 `server/src/data/healthcheckSites.ts`，由 `scripts/import-healthcheck-sites.mjs` 從原始 CSV（Big5 編碼）產生，下載網址和用法寫在 script 開頭。
- 這份資料只有機構名單，沒有名額或時段，所以畫面不會宣稱有名額。

### 模擬資料（全部是虛構的）

- **申請者 A** 和他的身分資料：虛構，只存在後端的種子資料（`server/src/seed.ts`），任何 API 都不會回傳。
- **偏好日期、時段、預約結果和模擬編號**：模擬。不會送出真實預約，也不代表有名額。
- **合成練習附件**：`web/public/samples/` 的 PDF 和 PNG，由 `scripts/make-sample-attachments.mjs` 從零產生，內容寫著 `SYNTHETIC PRACTICE DOCUMENT - NOT A REAL ID`。
- **代辦者填的稱呼和電話**：展示時請填假的，例如 `0912345678`。
- 畫面全程顯示「模擬服務」標籤。

### 尚未介接

健檢預約系統、MyData、政府受理系統、正式身分驗證都沒有介接。城市通的部分只用到掃碼功能，沒有讀取使用者資料。

## 第三方套件

清單可以用 `npm run licenses` 重新產生，它會讀實際安裝的版本和授權；出現允許範圍以外的授權時會失敗。

### 執行時和前端（會出現在作品裡）

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

### 只在開發和測試時使用

| 名稱 | 版本 | 授權 |
|---|---|---|
| @axe-core/playwright | 4.14.0 | MPL-2.0 |
| @playwright/test | 1.65.0 | Apache-2.0 |
| @types/express | 5.0.6 | MIT |
| @types/multer | 2.3.0 | MIT |
| @types/node | 26.6.6 | MIT |
| @types/pg | 8.23.1 | MIT |
| @types/qrcode | 1.5.6 | MIT |
| @types/supertest | 7.2.1 | MIT |
| @vitejs/plugin-vue | 6.0.10 | MIT |
| @vue/test-utils | 2.5.1 | MIT |
| concurrently | 10.0.6 | MIT |
| embedded-postgres | 18.6.0-beta.19 | MIT |
| esbuild | 0.28.2 | MIT |
| jsdom | 31.0.0 | MIT |
| supertest | 7.3.1 | MIT |
| tsx | 4.23.15 | MIT |
| typescript | 6.0.3 | Apache-2.0 |
| vite | 8.3.6 | MIT |
| vitest | 5.1.0 | MIT |
| vue-tsc | 3.3.14 | MIT |

### 執行環境

| 名稱 | 授權 | 用途 |
|---|---|---|
| Node.js 22 | MIT | 執行後端；SQLite 用 Node 內建的 `node:sqlite` |
| SQLite | Public Domain | 資料庫（隨 Node.js 內建） |
| Caddy | Apache-2.0 | VM 上的 HTTPS 反向代理 |
| Debian 12 | 多種自由軟體授權 | VM 作業系統 |

## AI 使用揭露

- **作品執行時沒有使用任何 AI 或大型語言模型**，裝置端和遠端都沒有。QR Code 掃描用的 jsQR 是一般的影像解碼程式，不是 AI 模型。
- 開發時使用 AI 程式助理（Claude Code）協助撰寫程式和文件，比賽規則允許開發時使用雲端 AI。

## 已知限制

- **同一時間只能跑一組展示**：系統只有一位預載的申請者。每次展示前跑 `npm run demo:reset`（VM 上用 `deploy/demo-reset.sh`）。
- **城市通 App 裡的檔案選擇器還沒在實機上測過**，所以 S04 多了一個「使用內建合成範例」按鈕，走同一支上傳 API，展示時不依賴手機裡有沒有檔案。
- **城市通掃碼 bridge 還沒在實機上測過**：端對端測試只模擬了 `window.flutterObject`。城市通的網頁視窗可能拿不到相機，所以 App 裡一律用 App 的掃碼功能；不行時改用分享連結。
- 不是 HTTPS 的網址（例如同一個 Wi-Fi 測試）不能用網頁相機掃碼。
- 日期、時段、名額和預約結果都是模擬的；沒有正式登入或身分驗證，只用展示用的身分選擇。
- 用 `sslip.io` 當網址時依賴這個第三方 DNS 服務；IP 改變時網址也會改變。
- 地點清單是真的開放資料，但產品主要價值（授權協作）本身不依賴開放資料，這樣是否算滿足「核心資料」要看評審認定，建議到現場 Coding 診療室確認。

## 授權

本作品以 [GNU Affero General Public License v3.0（AGPL-3.0）](../LICENSE) 授權，授權全文在 repo 根目錄的 `LICENSE`。
