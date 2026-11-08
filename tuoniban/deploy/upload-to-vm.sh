#!/usr/bin/env bash
# 從自己電腦把目前的 tuoniban/ 上傳到 GCP VM 並安裝，不需要先 commit 或 push。
#
# 用法（在自己電腦上，repo 裡任何位置都可以）：
#   bash tuoniban/deploy/upload-to-vm.sh [主機名稱]
#
# - 需要先裝好 gcloud 並登入，VM 也已經照 README「部署到 GCP VM」第 1–3 步建立。
# - 主機名稱不給時，第一次會用 VM 的外部 IP 組成 <IP>.sslip.io，之後沿用 VM 上的設定。
# - VM 名稱和區域預設是 README 用的 tuoniban、asia-east1-b，可以用 VM、ZONE 覆寫：
#     VM=my-vm ZONE=asia-east1-a bash tuoniban/deploy/upload-to-vm.sh
# - 再跑一次就是更新：程式碼整份換掉，資料庫和附件（/var/lib/tuoniban）不受影響。
set -euo pipefail

VM="${VM:-tuoniban}"
ZONE="${ZONE:-asia-east1-b}"
HOST_ARG="${1:-}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_ARCHIVE=/tmp/tuoniban-upload.tgz

command -v gcloud >/dev/null || { echo "錯誤：找不到 gcloud，請先安裝 Google Cloud CLI 並執行 gcloud auth login。" >&2; exit 1; }
[[ -z "$HOST_ARG" || "$HOST_ARG" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "錯誤：主機名稱只能有英數字、點和橫線：$HOST_ARG" >&2; exit 1; }

workdir="$(mktemp -d)"
archive="$workdir/tuoniban.tgz"
trap 'rm -rf "$workdir"' EXIT

echo "==> 打包 $APP_DIR（不含 node_modules、建置結果、本機資料和 .env）"
# COPYFILE_DISABLE 讓 macOS 的 tar 不夾帶 ._ 開頭的隱藏檔。
COPYFILE_DISABLE=1 tar -czf "$archive" -C "$APP_DIR" \
  --exclude ./node_modules --exclude ./dist --exclude ./dist-server --exclude ./.data \
  --exclude ./test-results --exclude ./playwright-report --exclude ./coverage \
  --exclude ./.env --exclude .DS_Store \
  .
echo "大小：$(du -h "$archive" | cut -f1)"

echo "==> 上傳到 VM $VM（$ZONE）"
gcloud compute scp "$archive" "$VM:$REMOTE_ARCHIVE" --zone "$ZONE"

echo "==> 在 VM 上解開並安裝（第一次約需 5–10 分鐘）"
gcloud compute ssh "$VM" --zone "$ZONE" --command "set -e
if [ -d /opt/tuoniban/.git ]; then
  echo '錯誤：這台 VM 的程式碼是用 git clone 的，請改成 push 後在 VM 上執行 setup-vm.sh。' >&2
  exit 1
fi
sudo rm -rf /opt/tuoniban/tuoniban
sudo mkdir -p /opt/tuoniban/tuoniban
sudo tar -xzf $REMOTE_ARCHIVE --no-same-owner -C /opt/tuoniban/tuoniban
rm -f $REMOTE_ARCHIVE
sudo bash /opt/tuoniban/tuoniban/deploy/setup-vm.sh $HOST_ARG"
