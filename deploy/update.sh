#!/usr/bin/env bash
# 更新到最新版：拉程式碼、裝套件、重新打包前端、重啟服務。先備份再動手。
# 用法（在 /opt/coidle，以 coidle 使用者）：bash deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 備份資料庫"
node deploy/backup.mjs || true

echo "== 拉最新程式碼"
git pull --ff-only

echo "== 安裝套件並檢查型別"
npm ci
npm run typecheck

echo "== 打包前端"
npm run build:client

echo "== 重新啟動（需要 sudo）"
sudo systemctl restart coidle
sleep 2
curl -fsS http://127.0.0.1:2330/api/health && echo
echo "完成。"
