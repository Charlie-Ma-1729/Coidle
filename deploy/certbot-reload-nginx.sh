#!/bin/sh
# certbot 自動續期成功後會執行這個：讓 nginx 載入新憑證。
# 安裝到 /etc/letsencrypt/renewal-hooks/deploy/（README 第 9 步）。
systemctl reload nginx
