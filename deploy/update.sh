#!/usr/bin/env bash
# 更新到最新版：備份、拉程式碼、裝套件、重新打包前端、重啟服務。
# 用法：cd /opt/coidle && sudo bash deploy/update.sh
# 以 root（sudo）執行；程式碼、套件、備份用 coidle 使用者做，只有重啟服務用 root。
set -euo pipefail

if [ "$(id -u)" != "0" ]; then
  echo "請用 sudo 執行：sudo bash deploy/update.sh"
  exit 1
fi
cd "$(dirname "$0")/.."
export PATH=/usr/local/bin:$PATH
run() { runuser -u coidle -- env PATH="$PATH" HOME=/home/coidle "$@"; }

echo "== 備份資料庫"
run node deploy/backup.mjs || true

echo "== 拉最新程式碼"
run git pull --ff-only

echo "== 安裝套件並檢查型別"
run npm ci
run npm run typecheck

echo "== 打包前端"
run npm run build:client

echo "== 重新啟動"
systemctl restart coidle
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:2330/api/health; then
    echo
    echo "完成。"
    exit 0
  fi
  sleep 1
done
echo "服務沒有在 10 秒內回應，請看：journalctl -u coidle -n 50 --no-pager"
exit 1
