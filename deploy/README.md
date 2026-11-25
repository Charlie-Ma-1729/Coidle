# 部署到 Ubuntu：coidle.imatw.org（Node ＋ nginx ＋ HTTPS ＋ systemd）

- 網域：`coidle.imatw.org`
- Node：`/usr/local/bin/node`（需要 22.13 以上，內建 `node:sqlite`）
- 服務：`coidle.service`，監聽 `127.0.0.1:2330`（只給 nginx 連，**不要對外開 2330**）
- 安裝目錄：`/opt/coidle`，用專用的 `coidle` 系統帳號執行
- 每一個框裡的指令都可以整框複製貼上、依序執行；有 `←` 的是要你改的地方。

## 0. 事前確認
```bash
getent hosts coidle.imatw.org
```
↑ 要看到伺服器的對外 IP；沒有的話 DNS 還沒生效，先等。

```bash
/usr/local/bin/node -v
/usr/local/bin/npm -v
```
↑ node 要是 v22.13 以上（建議 v24）。

防火牆（如果有用 ufw；雲端主機的安全群組也要開 80、443）：
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

## 1. 安裝 nginx、certbot、git
```bash
sudo apt-get update
sudo apt-get install -y nginx certbot git curl
```

## 2. 建立專用帳號與目錄
```bash
sudo useradd --system --create-home --home-dir /home/coidle --shell /usr/sbin/nologin coidle
sudo mkdir -p /opt/coidle
sudo chown coidle:coidle /opt/coidle
```

## 3. 取得程式碼
repo 是 `git@github.com:Charlie-Ma-1729/Coidle.git`。伺服器需要一把「唯讀的部署金鑰」才能拉（如果 repo 是公開的，可跳過金鑰，直接用 https 網址 clone）。

先在你的電腦把最新的 commit 推上去（`git push origin main`），伺服器才拉得到。

產生金鑰：
```bash
sudo -u coidle mkdir -p -m 700 /home/coidle/.ssh
sudo -u coidle ssh-keygen -t ed25519 -N "" -C coidle-server -f /home/coidle/.ssh/id_ed25519
sudo -u coidle sh -c 'ssh-keyscan -t ed25519 github.com >> /home/coidle/.ssh/known_hosts'
sudo cat /home/coidle/.ssh/id_ed25519.pub
```
把最後印出的那一行貼到 GitHub：repo → Settings → Deploy keys → Add deploy key（**不要**勾 Allow write access）。

然後 clone：
```bash
sudo -u coidle git clone git@github.com:Charlie-Ma-1729/Coidle.git /opt/coidle
```
（公開 repo 用：`sudo -u coidle git clone https://github.com/Charlie-Ma-1729/Coidle.git /opt/coidle`）

## 4. 安裝套件、打包前端
`npm ci` 要連 devDependencies 一起裝（打包前端與 tsx 都需要），所以這一步**不要**設 `NODE_ENV=production`。
```bash
cd /opt/coidle
sudo -u coidle env PATH=/usr/local/bin:/usr/bin:/bin HOME=/home/coidle npm ci
sudo -u coidle env PATH=/usr/local/bin:/usr/bin:/bin HOME=/home/coidle npm run build:client
sudo -u coidle mkdir -p /opt/coidle/data /opt/coidle/backups
ls /opt/coidle/client/dist
```
最後一行要看到 `index.html`。

## 5. 產生 `.env`（金鑰、密語都只放這裡）
一個指令自動填好：`NODE_ENV=production`、註冊密語、推播金鑰、權限 600。
把 `註冊密語` 換成你自己想的（只告訴你的朋友，至少 6 字元），信箱換成你的：
```bash
cd /opt/coidle
sudo -u coidle /usr/local/bin/node deploy/setup-env.mjs 註冊密語 你的信箱@example.com
```
↑ 兩處要改。已經有 `.env` 時它不會覆蓋。

之後要加 AI 內容的金鑰（OpenRouter）時再編輯，沒金鑰就完全不啟用 AI：
```bash
sudo -u coidle nano /opt/coidle/.env
```

## 6. 啟動服務（coidle.service）
```bash
sudo cp /opt/coidle/deploy/coidle.service /etc/systemd/system/coidle.service
sudo systemctl daemon-reload
sudo systemctl enable --now coidle
sleep 3
systemctl status coidle --no-pager
curl -s http://127.0.0.1:2330/api/health
```
最後要印出 `{"ok":true,...}`。沒有的話看日誌：
```bash
journalctl -u coidle -n 50 --no-pager
```
（常用：`sudo systemctl restart coidle`、`sudo systemctl stop coidle`、`journalctl -u coidle -f`）

## 7. nginx 第一階段（只有 80，先讓 certbot 能驗證網域）
（這台如果已經有別的網站，**不要**刪 `sites-enabled/default` 或其他站台的設定；這份只新增一個 `coidle` 站台。）
```bash
sudo cp /opt/coidle/deploy/nginx-http.conf /etc/nginx/sites-available/coidle
sudo ln -sf /etc/nginx/sites-available/coidle /etc/nginx/sites-enabled/coidle
sudo nginx -t
sudo systemctl reload nginx
curl -s http://coidle.imatw.org/api/health
```
最後要印出 `{"ok":true,...}`（走 http 只能測這個；登入要等 HTTPS）。

## 8. 取得 HTTPS 憑證
把信箱換成你的（Let's Encrypt 只在憑證快到期而沒續成功時寄信給你）：
```bash
sudo certbot certonly --webroot -w /var/www/html -d coidle.imatw.org --agree-tos --no-eff-email -m 你的信箱@example.com
```
↑ 一處要改。成功會看到 `Successfully received certificate`。

## 9. nginx 第二階段（完整 HTTPS ＋ WebSocket）與自動續期
```bash
sudo cp /opt/coidle/deploy/nginx.conf /etc/nginx/sites-available/coidle
sudo nginx -t
sudo systemctl reload nginx
sudo cp /opt/coidle/deploy/certbot-reload-nginx.sh /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo certbot renew --dry-run
curl -s https://coidle.imatw.org/api/health
```
- `certbot renew --dry-run` 最後要是 `Congratulations, all simulated renewals succeeded`。Ubuntu 的 certbot 套件已經自帶每天兩次的續期排程（`systemctl list-timers | grep certbot` 看得到），上面的 hook 會在續期成功後讓 nginx 載入新憑證。
- 最後一行要印出 `{"ok":true,...}`。

用瀏覽器打開 <https://coidle.imatw.org> 應該看到登入畫面。

## 10. 每日備份（04:30，保留 14 份）
```bash
sudo cp /opt/coidle/deploy/coidle-backup.service /opt/coidle/deploy/coidle-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now coidle-backup.timer
sudo systemctl start coidle-backup
ls -l /opt/coidle/backups
systemctl list-timers --no-pager | grep coidle
```
備份用 SQLite 的 `VACUUM INTO`，服務執行中也安全，並會驗證完整性。**建議再把 `/opt/coidle/backups` 定期同步到別台機器**（`rsync`、`rclone` 都行）。

### 還原
```bash
sudo systemctl stop coidle
sudo -u coidle cp /opt/coidle/backups/要還原的檔名.db /opt/coidle/data/coidle.db
sudo rm -f /opt/coidle/data/coidle.db-wal /opt/coidle/data/coidle.db-shm
sudo systemctl start coidle
```
↑ 檔名要改。還原後商場會依「真實時間」補算離線期間（最多 14 個標準日），不會漏賺。

## 11. 建立 Overseer（世界管理者）與測試商場
Overseer 用金鑰登入（沒有密碼），進管理室；可以旁觀所有商場、管帳號與商場、寫事件、調天氣、操控 NPC、看營運數據與稽核。細節見 `docs/overseer.md`。
```bash
cd /opt/coidle
sudo -u coidle npm run admin -- create-overseer
```
↑ 印出的金鑰**只會顯示一次**，請存到密碼管理器。到網站登入頁底下的「管理者金鑰登入」貼上。換金鑰：`sudo -u coidle npm run admin -- rotate-overseer-key`。

測試商場（最高等級、全區域、全科技，**獨立於世界之外**：不進排行、不能聯名貿易搶客、NPC 不會動它），創辦人是 Overseer：
```bash
sudo -u coidle npm run admin -- sandbox-mall overseer
```
（要把已經存在的商場轉成測試商場：最後加商場編號，例如 `sandbox-mall overseer 12`；其他成員會被移除。）

所有管理操作都會寫進稽核紀錄，同時印在伺服器的 terminal：
```bash
journalctl -u coidle -f
```

## 12. 第一次使用
1. 打開 <https://coidle.imatw.org>，用註冊密語註冊第一個帳號 → 建立商場 → 把邀請碼給朋友。
2. 手機：Chrome 選單「安裝應用程式」；iPhone 用 Safari「分享 → 加入主畫面」（iPhone 要先安裝到主畫面才能收推播）。
3. 進遊戲，☰ 選單 → 設定 → 商場與帳號，找到「這台裝置」按「開啟通知」。商場因重要事件暫停時就會收到通知。

## 更新到新版
在你的電腦 `git push` 之後，伺服器上：
```bash
cd /opt/coidle && sudo bash deploy/update.sh
```
會依序：備份 → `git pull` → `npm ci` → 型別檢查 → 打包前端 → 重啟服務 → 檢查健康狀態。使用者的 App 下次開啟時自動換新版。

## AI 內容（有金鑰之後）
```bash
cd /opt/coidle
sudo -u coidle /usr/local/bin/node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json server/src/ai/cli.ts list
```
列出待審核的 AI 內容（同 `npm run ai -- list`）。

## 疑難排解
| 症狀 | 檢查 |
|---|---|
| `systemctl status coidle` 是 `status=226/NAMESPACE` | `/opt/coidle/data`、`/opt/coidle/backups` 沒建立：`sudo -u coidle mkdir -p /opt/coidle/data /opt/coidle/backups` 再重啟 |
| `status=203/EXEC` | node 路徑不對：`ls -l /usr/local/bin/node`、`ls /opt/coidle/node_modules/tsx/dist/cli.mjs` |
| 啟動立刻結束，日誌說找不到 `node:sqlite` | node 版本太舊，需要 22.13 以上 |
| `nginx -t` 說找不到憑證檔 | 還沒做第 8 步就換了完整版設定；先 `cp nginx-http.conf` 回去，取得憑證後再換 |
| certbot 驗證失敗 | DNS 沒指到這台、80 port 沒開（防火牆／雲端安全群組）、或第 7 步沒成功 |
| 登入後馬上被登出／連不上即時更新 | 要用 https 開；nginx 要有轉送 `Host` 與 `Upgrade`（用 repo 裡的 nginx.conf）；`NODE_ENV=production` |
| 沒有「安裝」選項 | 必須是 HTTPS；DevTools → Application → Manifest 看錯誤 |
| 收不到推播 | `.env` 的 VAPID 金鑰有設？改 `.env` 後要 `sudo systemctl restart coidle`；iPhone 要安裝到主畫面 |
| 更新後畫面還是舊的 | 關掉 App 再開一次；Service Worker 會在背景換版 |
| `git pull` 說 Permission denied (publickey) | 第 3 步的部署金鑰沒加到 GitHub，或加到別的 repo |
| 想看資料庫 | `sqlite3 /opt/coidle/data/coidle.db`（請先備份，並避免在服務執行中寫入） |
