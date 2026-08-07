#!/usr/bin/env bash
#
# 配置 Nginx 反向代理 + HTTPS
#
#   sudo bash deploy/nginx.sh catalog.example.com
#
# 前面挂 Cloudflare 时，SSL 模式选「完全（严格）」，
# 这样浏览器→CF→你的服务器全程加密。
#
set -euo pipefail

DOMAIN="${1:-}"
APP_PORT="${APP_PORT:-3000}"

log()  { printf "\033[1;34m==>\033[0m %s\n" "$*"; }
die()  { printf "\033[1;31m错误:\033[0m %s\n" "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 运行"
[ -n "$DOMAIN" ] || die "用法：sudo bash $0 你的域名.com"

log "安装 Nginx 与 certbot"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx certbot python3-certbot-nginx >/dev/null

log "写入站点配置"
cat > "/etc/nginx/sites-available/$DOMAIN" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    # 上传封面图等，放宽一点
    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;

        proxy_set_header Host \$host;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';

        # 真实客户端 IP。
        # 应用侧 TRUSTED_PROXY_MODE=cloudflare 时会优先读 CF-Connecting-IP，
        # 这几个头是兜底，别删。
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header CF-Connecting-IP \$http_cf_connecting_ip;
        proxy_set_header CF-IPCountry \$http_cf_ipcountry;

        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 60s;
    }

    # Next.js 静态资源，长缓存
    location /_next/static/ {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_cache_valid 200 365d;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
}
EOF

ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
rm -f /etc/nginx/sites-enabled/default

nginx -t >/dev/null 2>&1 || die "Nginx 配置有误，执行 nginx -t 查看"
systemctl reload nginx
log "✓ Nginx 已配置"

# 更新应用里的站点地址
if [ -f /opt/miaokit-catalog/.env ]; then
  sed -i "s|^PUBLIC_SITE_URL=.*|PUBLIC_SITE_URL=https://$DOMAIN|" /opt/miaokit-catalog/.env
  systemctl restart catalog-web 2>/dev/null || true
  log "✓ 已更新站点地址为 https://$DOMAIN"
fi

cat <<EOF

──────────────────────────────────────────────
Nginx 配置完成。

如果域名已解析到本机，申请证书：
   sudo certbot --nginx -d $DOMAIN

如果用 Cloudflare 代理（橙色云朵）：
   1. Cloudflare 后台 → SSL/TLS → 选「完全（严格）」
   2. 仍然建议申请上面的证书，保证 CF 到服务器这段也加密
   3. 如果暂时不申请，先把 SSL 模式设为「灵活」，但那段是明文，不推荐

验证：curl -I http://$DOMAIN
──────────────────────────────────────────────
EOF
