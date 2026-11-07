#!/usr/bin/env bash
# 每次展示前把 VM 上的資料重設成乾淨狀態，等於在 VM 上跑 `npm run demo:reset`。
#
# 在 VM 上：
#   sudo bash /opt/tuoniban/tuoniban/deploy/demo-reset.sh
# 在筆電上一行完成：
#   gcloud compute ssh tuoniban --zone=asia-east1-b --command='sudo bash /opt/tuoniban/tuoniban/deploy/demo-reset.sh'
#
# 會清空所有協助碼、案件、附件和 session，再放回預載的虛構申請者 A。
# 手機上已經開著的頁面，要回首頁重新選「我要請人幫忙／我要幫忙」。
set -euo pipefail

APP_DIR=/opt/tuoniban/tuoniban
APP_USER=tuoniban
APP_HOME=/var/lib/tuoniban
ENV_FILE=/etc/tuoniban.env

[ "$(id -u)" -eq 0 ] || { echo "請用 sudo 執行：sudo bash $0" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "找不到 $ENV_FILE，請先跑 deploy/setup-vm.sh。" >&2; exit 1; }

# 重設只需要資料庫位置。只讀這三個值，不把設定檔當 shell 執行。
env_value() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }

cd "$APP_DIR"
# 用服務帳號執行，資料庫和附件檔案的擁有者才不會變成 root，否則服務會寫不進去。
sudo -u "$APP_USER" env HOME="$APP_HOME" \
  DATABASE_URL="$(env_value DATABASE_URL)" \
  DATABASE_PATH="$(env_value DATABASE_PATH)" \
  PRIVATE_UPLOAD_DIR="$(env_value PRIVATE_UPLOAD_DIR)" \
  npm run demo:reset
