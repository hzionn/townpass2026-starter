#!/usr/bin/env bash
# 在 GCP VM（Debian 12）上安裝或更新託你辦：Node.js 22、Caddy（自動 HTTPS）、建置、systemd 服務。
#
# 用法（在 VM 上）：
#   sudo bash /opt/tuoniban/tuoniban/deploy/setup-vm.sh [主機名稱]
#
# - 第一次執行沒給主機名稱時，會向 GCP 查這台 VM 的外部 IP，自動用 <IP 點換橫線>.sslip.io，
#   例如 34-80-1-2.sslip.io。之後再執行會沿用 /etc/tuoniban.env 裡的 PUBLIC_ORIGIN。
# - 可以重複執行：會 git pull、重新建置、重新啟動，所以「更新程式」也是跑這支。
# - 沒有 commit 的程式碼：在自己電腦跑 deploy/upload-to-vm.sh，它會上傳後再執行這支。
# - /opt/tuoniban 還沒有 repo 也沒有上傳過時會自動 clone，可用 REPO_URL、BRANCH 指定，例如：
#     sudo BRANCH=feature/tuo-ni-ban bash setup-vm.sh
#   已經 clone 過的話，換分支要自己跑：sudo git -C /opt/tuoniban switch <分支>
#
# 建立 VM、開防火牆等完整步驟見 tuoniban/README.md 的「部署到 GCP VM」。
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/hzionn/townpass2026-starter.git}"
BRANCH="${BRANCH:-main}"
REPO_DIR=/opt/tuoniban
APP_DIR="$REPO_DIR/tuoniban"
APP_USER=tuoniban
APP_HOME=/var/lib/tuoniban
DATA_DIR="$APP_HOME/data"
ENV_FILE=/etc/tuoniban.env
DEFAULT_PORT=8787

step() { printf '\n==> %s\n' "$*"; }
fail() { printf '\n錯誤：%s\n' "$*" >&2; exit 1; }
# 從 env 檔讀一個值（只讀，不把檔案當 shell 執行）。
env_value() { [ -f "$ENV_FILE" ] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 || true; }

[ "$(id -u)" -eq 0 ] || fail "請用 sudo 執行：sudo bash $0"
command -v apt-get >/dev/null || fail "這支 script 只支援 Debian／Ubuntu。"
export DEBIAN_FRONTEND=noninteractive

step "安裝基本工具"
apt-get update
apt-get install -y ca-certificates curl git gnupg debian-keyring debian-archive-keyring apt-transport-https

step "決定網址"
HOST="${1:-}"
if [ -z "$HOST" ]; then
  HOST="$(env_value PUBLIC_ORIGIN)"
fi
if [ -z "$HOST" ]; then
  IP="$(curl -fsS -H 'Metadata-Flavor: Google' \
    http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip || true)"
  [ -n "$IP" ] || fail "查不到這台 VM 的外部 IP，請直接給主機名稱，例如：sudo bash $0 34-80-1-2.sslip.io"
  HOST="${IP//./-}.sslip.io"
fi
HOST="${HOST#https://}"
HOST="${HOST#http://}"
HOST="${HOST%/}"
[[ "$HOST" =~ ^[A-Za-z0-9.-]+$ ]] || fail "主機名稱只能有英數字、點和橫線：$HOST"
ORIGIN="https://$HOST"
echo "網址：$ORIGIN"

step "確認記憶體（建置需要）"
# e2-small 只有 2 GB，型別檢查加打包可能不夠，所以第一次加 2 GB swap。
if [ -z "$(swapon --noheadings)" ] && [ ! -e /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "已加上 2 GB swap"
else
  echo "已有 swap，略過"
fi

step "安裝 Node.js 22（需要 22.13 以上，才有內建的 node:sqlite）"
node_ok() {
  [ -x /usr/bin/node ] && /usr/bin/node -e \
    'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)'
}
if node_ok; then
  echo "已安裝 $(/usr/bin/node -v)，略過"
else
  # NodeSource 官方的安裝方式：https://github.com/nodesource/distributions
  curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
  bash /tmp/nodesource_setup.sh
  rm -f /tmp/nodesource_setup.sh
  apt-get install -y nodejs
  node_ok || fail "Node.js 版本要 22.13 以上，目前是 $(/usr/bin/node -v 2>/dev/null || echo 沒有安裝)"
fi

step "安裝 Caddy（自動申請 HTTPS 憑證）"
if command -v caddy >/dev/null; then
  echo "已安裝 $(caddy version | head -n 1)，略過"
else
  # Caddy 官方 apt 套件庫：https://caddyserver.com/docs/install
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

step "建立服務帳號和資料夾"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$APP_HOME" --shell /usr/sbin/nologin "$APP_USER"
fi
# 資料庫和附件放在 /var/lib/tuoniban/data，只有服務帳號讀得到，重開機也不會不見。
install -d -m 700 -o "$APP_USER" -g "$APP_USER" "$APP_HOME" "$DATA_DIR" "$DATA_DIR/uploads"

step "取得程式碼"
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" pull --ff-only
elif [ -f "$APP_DIR/package.json" ]; then
  # 用 deploy/upload-to-vm.sh 從電腦直接上傳的程式碼，沒有 git，不用先 commit 或 push。
  echo "使用已上傳到 $APP_DIR 的程式碼，略過 git"
else
  git clone --branch "$BRANCH" "$REPO_URL" "$REPO_DIR" \
    || fail "clone 失敗。repo 是私人的話，先照 README 手動 clone 到 $REPO_DIR 再執行這支。"
fi
[ -f "$APP_DIR/package.json" ] || fail "找不到 $APP_DIR/package.json，請確認這個分支裡有 tuoniban/ 資料夾。"

step "安裝套件並建置（約需幾分鐘）"
cd "$APP_DIR"
# 建置要用到 devDependencies（vite、esbuild、typescript），所以不能帶 NODE_ENV=production。
env -u NODE_ENV npm ci --include=dev
env -u NODE_ENV npm run build

step "寫入設定 $ENV_FILE"
if [ -f "$ENV_FILE" ]; then
  if grep -q '^PUBLIC_ORIGIN=' "$ENV_FILE"; then
    sed -i "s|^PUBLIC_ORIGIN=.*|PUBLIC_ORIGIN=$ORIGIN|" "$ENV_FILE"
  else
    echo "PUBLIC_ORIGIN=$ORIGIN" >> "$ENV_FILE"
  fi
  echo "已存在，只更新 PUBLIC_ORIGIN，其他設定（含 SESSION_SECRET）保留"
else
  SECRET="$(/usr/bin/node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')"
  install -m 600 -o root -g root /dev/null "$ENV_FILE"
  cat > "$ENV_FILE" <<EOF
# 託你辦在這台 VM 的設定，由 deploy/setup-vm.sh 產生。不要 commit 這個檔案。
# 每個設定的說明見 $APP_DIR/.env.example。改完要重新啟動：sudo systemctl restart tuoniban
DEMO_MODE=true
PUBLIC_ORIGIN=$ORIGIN
SESSION_SECRET=$SECRET
PORT=$DEFAULT_PORT
DATABASE_PATH=$DATA_DIR/tuoniban.db
PRIVATE_UPLOAD_DIR=$DATA_DIR/uploads
EOF
  echo "已建立，SESSION_SECRET 已隨機產生"
fi
chown root:root "$ENV_FILE"
chmod 600 "$ENV_FILE"
APP_PORT="$(env_value PORT)"
APP_PORT="${APP_PORT:-$DEFAULT_PORT}"

step "安裝並啟動 tuoniban 服務"
install -m 644 "$APP_DIR/deploy/tuoniban.service" /etc/systemd/system/tuoniban.service
systemctl daemon-reload
systemctl enable tuoniban
systemctl restart tuoniban
app_up=no
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null 2>&1; then app_up=yes; break; fi
  sleep 1
done
if [ "$app_up" != yes ]; then
  journalctl -u tuoniban -n 30 --no-pager || true
  fail "服務沒有起來。上面是最近的日誌，通常第一行 Configuration error 會說哪個設定有問題。"
fi
echo "服務已啟動"

step "設定 Caddy（HTTPS）"
sed -e "s|__HOST__|$HOST|g" -e "s|127.0.0.1:$DEFAULT_PORT|127.0.0.1:$APP_PORT|" \
  "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
chmod 644 /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable caddy
systemctl reload-or-restart caddy

step "確認 HTTPS（第一次要等 Caddy 申請憑證）"
https_up=no
for _ in $(seq 1 30); do
  if curl -fsS "$ORIGIN/api/health" >/dev/null 2>&1; then https_up=yes; break; fi
  sleep 2
done

echo
if [ "$https_up" = yes ]; then
  echo "完成：$ORIGIN"
else
  echo "程式已啟動，但 $ORIGIN 還打不開。請檢查："
  echo "  1. GCP 防火牆有開 80、443，VM 有 http-server、https-server 標記（見 README）"
  echo "  2. 主機名稱裡的 IP 是這台 VM 的外部 IP"
  echo "  3. Caddy 日誌：sudo journalctl -u caddy -n 50 --no-pager"
fi
echo
echo "接下來："
echo "  - 城市通 patch 的 destinationUrl 填：$ORIGIN/"
echo "  - 每次展示前重設資料：sudo bash $APP_DIR/deploy/demo-reset.sh"
echo "  - 看日誌：sudo journalctl -u tuoniban -f"
