#!/usr/bin/env bash
#
# MiaoKit Catalog —— Docker 部署 / 更新
#
#   sudo bash deploy.sh
#
# 前提：服务器已装 Docker。不装 Nginx、不占 80/443，
# 反向代理请在你现有的面板（1Panel / 宝塔）里配置。
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/miaokit-catalog}"
IMAGE="${IMAGE:-ghcr.io/lordfoxfairy/miaoshelf:latest}"

log()  { printf "\033[1;34m==>\033[0m %s\n" "$*"; }
die()  { printf "\033[1;31m错误:\033[0m %s\n" "$*" >&2; exit 1; }

command -v docker >/dev/null || die "未装 Docker"
docker compose version >/dev/null 2>&1 || die "未装 docker compose 插件"

mkdir -p "$APP_DIR"
cd "$APP_DIR"

# ---------------------------------------------------------------- 配置

if [ ! -f .env ]; then
  log "生成 .env（密钥自动创建，不用你操心）"
  cat > .env <<EOF
NODE_ENV=production
TZ=Asia/Shanghai
WEB_PORT=3210

# 配好域名后改成 https://你的域名
PUBLIC_SITE_URL=http://127.0.0.1:3210
NEXT_PUBLIC_SITE_NAME=MiaoKit Catalog

# 自动生成。CREDENTIAL_MASTER_KEY 千万别改——
# 改了之后已存的货源凭据就再也解不开了。
AUTH_SECRET=$(openssl rand -base64 32)
CREDENTIAL_MASTER_KEY=$(openssl rand -base64 32)

LDXP_BASE_URL=https://www.ldxp.cn
LDXP_ALLOWED_REDIRECT_HOSTS=ldxp.cn,www.ldxp.cn,pay.ldxp.cn
ENABLE_LDXP_WRITE=false

SYNC_SCHEDULER_INTERVAL_SECONDS=60
SYNC_HOT_SECONDS=60
SYNC_NORMAL_SECONDS=300
SYNC_COLD_SECONDS=1800
STATUS_FRESH_SECONDS=120
STATUS_STALE_SECONDS=900
CLICK_RESOLVE_TIMEOUT_MS=2000
GLOBAL_SOURCE_CONCURRENCY=2
LOW_STOCK_THRESHOLD=5

LOG_LEVEL=info
# 前面挂 Cloudflare 时必须是 cloudflare，
# 否则限流会把所有用户当成同一个 IP，一个人就能限死全站。
TRUSTED_PROXY_MODE=cloudflare
EOF
  chmod 600 .env
else
  log ".env 已存在，保留原有密钥"
fi

# compose 文件跟着镜像走，每次更新都覆盖
log "下载 compose 配置"
curl -fsSL -o docker-compose.yml \
  https://raw.githubusercontent.com/LordFoxFairy/MiaoShelf/main/docker-compose.yml

# ---------------------------------------------------------------- 启动

log "拉取镜像"
docker compose pull

log "启动服务"
docker compose up -d

log "等待健康检查"
for i in $(seq 1 30); do
  if docker compose ps web 2>/dev/null | grep -q healthy; then
    log "✓ 网站已就绪"
    break
  fi
  [ "$i" = "30" ] && die "启动超时，看日志：docker compose logs web"
  sleep 3
done

PORT=$(grep -E '^WEB_PORT=' .env | cut -d= -f2 || echo 3210)

cat <<EOF

──────────────────────────────────────────────
部署完成。

1. 创建管理员
   cd $APP_DIR
   docker compose exec web node create-admin.cjs 你的邮箱 你的密码

2. 本机验证
   curl -I http://127.0.0.1:$PORT/api/health

3. 在 1Panel 里配反向代理，指向 127.0.0.1:$PORT

常用命令
   docker compose logs -f web       网站日志
   docker compose logs -f worker    同步日志
   docker compose restart           重启
   docker compose pull && docker compose up -d    更新
──────────────────────────────────────────────
EOF
