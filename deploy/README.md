# 部署到 Ubuntu（Node ＋ nginx ＋ HTTPS ＋ systemd）

目標：`https://你的網域` 能開、手機可安裝成 App、遇事暫停會跳推播、每天自動備份。
以下以 Ubuntu 22.04／24.04、網域 `game.example.com`、安裝目錄 `/opt/coidle` 為例。

## 0. 事前準備
- 網域的 DNS（A 記錄）指向伺服器的固定 IP。
- 防火牆開 80、443（`sudo ufw allow 'Nginx Full'`）；**不要**對外開 2330。
- HTTPS 是 PWA 安裝與推播的必要條件。

## 1. 安裝 Node 24、nginx、certbot
```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs nginx certbot python3-certbot-nginx git
node -v   # 需要 >= 22.13（內建 node:sqlite）
```

## 2. 取得程式碼與建置
```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin coidle
sudo mkdir -p /opt/coidle && sudo chown coidle:coidle /opt/coidle
sudo -u coidle git clone <你的 repo 網址> /opt/coidle
cd /opt/coidle
sudo -u coidle npm ci
sudo -u coidle npm run build:client        # 產生 client/dist
sudo -u coidle mkdir -p data backups
```

## 3. 設定 `.env`（重要，金鑰只放這裡）
```bash
sudo -u coidle cp .env.example .env
sudo -u coidle npx web-push generate-vapid-keys   # 把兩把金鑰貼進 .env
sudo -u coidle nano .env
```
至少要設定：
| 變數 | 說明 |
|---|---|
| `NODE_ENV=production` | 啟用 secure cookie、WebSocket 來源檢查、只聽本機 |
| `SIGNUP_SECRET` | 註冊密語（只告訴你的朋友，避免陌生人註冊） |
| `ADMIN_TOKEN` | 管理旗標用，長隨機字串（`openssl rand -hex 32`） |
| `VAPID_PUBLIC_KEY`／`VAPID_PRIVATE_KEY` | 推播金鑰（上一步產生） |
| `VAPID_SUBJECT` | `mailto:你的信箱` |

`chmod 600 /opt/coidle/.env`。`.env` 已被 `.gitignore` 排除，不要提交。

## 4. systemd 服務
```bash
sudo cp deploy/coidle.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now coidle
systemctl status coidle                 # 應該是 active (running)
curl http://127.0.0.1:2330/api/health   # {"ok":true,...}
journalctl -u coidle -f                 # 看日誌
```

## 5. nginx 與 HTTPS
```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/coidle
sudo sed -i 's/game.example.com/你的網域/g' /etc/nginx/sites-available/coidle
sudo ln -s /etc/nginx/sites-available/coidle /etc/nginx/sites-enabled/
# 第一次還沒有憑證：先只保留 80 port 那段（或註解掉 443 的 server 區塊），測試後再取得憑證
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d 你的網域        # 取得憑證並自動續期
sudo nginx -t && sudo systemctl reload nginx
```
打開 `https://你的網域` 應該看到登入畫面。

## 6. 每日備份
```bash
sudo cp deploy/coidle-backup.service deploy/coidle-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now coidle-backup.timer
systemctl list-timers | grep coidle     # 下次執行時間
sudo systemctl start coidle-backup      # 手動跑一次試試
ls /opt/coidle/backups
```
預設每天 04:30 備份、保留 14 份（`BACKUP_KEEP` 可調）。備份用 SQLite 的 `VACUUM INTO`，服務執行中也安全，並會驗證完整性。
**建議再把 `backups/` 定期同步到別台機器**（`rsync`、`rclone` 都行）。

### 還原
```bash
sudo systemctl stop coidle
sudo -u coidle cp /opt/coidle/backups/coidle-2026-xx-xx-xx-xx.db /opt/coidle/data/coidle.db
sudo rm -f /opt/coidle/data/coidle.db-wal /opt/coidle/data/coidle.db-shm
sudo systemctl start coidle
```
還原後商場會依「真實時間」補算離線期間（最多 14 個標準日），不會漏賺。

## 7. 第一次使用
1. 打開網址，用註冊密語註冊第一個帳號 → 建立商場 → 把邀請碼給朋友。
2. 手機：Chrome 選單「安裝應用程式」；iPhone 用 Safari「分享 → 加入主畫面」（iPhone 要先安裝到主畫面才能收推播）。
3. 到「更多 → 營運」最上面的「這台裝置」卡片，按「開啟通知」。商場因重要事件暫停時，就會收到通知。

## 更新
```bash
cd /opt/coidle && sudo -u coidle bash deploy/update.sh
```
（會先備份、拉程式碼、`npm ci`、型別檢查、重新打包前端、重啟並檢查健康狀態。）
更新後使用者的 App 會在下次開啟時自動換上新版（Service Worker 採「網路優先」載入頁面）。

## 疑難排解
| 症狀 | 檢查 |
|---|---|
| 登入後馬上被登出／連不上即時更新 | nginx 沒有轉送 `Host` 或 `Upgrade` 標頭；確認 `/ws` 區塊與 `NODE_ENV=production` |
| 沒有「安裝」選項 | 必須是 HTTPS；開 DevTools → Application → Manifest 看錯誤 |
| 收不到推播 | `.env` 的 VAPID 金鑰有設？更新 `.env` 後要 `systemctl restart coidle`；iPhone 要安裝到主畫面 |
| 更新後畫面還是舊的 | 關掉 App 再開一次；Service Worker 會在背景換版 |
| 想看資料庫 | `sqlite3 /opt/coidle/data/coidle.db`（請先備份，並避免在服務執行中寫入） |
