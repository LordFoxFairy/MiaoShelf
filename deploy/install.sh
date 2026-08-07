#!/usr/bin/env bash
#
# MiaoKit Catalog 一键部署（Ubuntu / Debian）
#
#   curl -fsSL https://raw.githubusercontent.com/LordFoxFairy/MiaoShelf/main/deploy/install.sh | sudo bash
#
# 或者克隆后执行：
#   sudo bash deploy/install.sh
#
set -euo pipefail

APP_USER="${APP_USER:-catalog}"
APP_DIR="${APP_DIR:-/opt/miaokit-catalog}"
REPO="${REPO:-https://github.com/LordFoxFairy/MiaoShelf.git}"
NODE_MAJOR=22

log()  { printf "\033[1;34m==>\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m警告:\033[0m %s\n" "$*"; }
die()  { printf "\033[1;31m错误:\033[0m %s\n" "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 运行：sudo bash $0"

# ---------------------------------------------------------------- 依赖

log "安装系统依赖"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg sqlite3 >/dev/null

if ! command -v node >/dev/null || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt "$NODE_MAJOR" ]; then
  log "安装 Node.js ${NODE_MAJOR}"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
fi
log "Node $(node -v)"

command -v pnpm >/dev/null || { log "安装 pnpm"; npm install -g pnpm@8 >/dev/null 2>&1; }
log "pnpm $(pnpm -v)"

# ---------------------------------------------------------------- 用户与代码

id -u "$APP_USER" >/dev/null 2>&1 || {
  log "创建用户 $APP_USER"
  useradd --system --create-home --shell /bin/bash "$APP_USER"
}

if [ -d "$APP_DIR/.git" ]; then
  log "更新代码"
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch --quiet origin
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard --quiet origin/main
else
  log "克隆代码到 $APP_DIR"
  mkdir -p "$APP_DIR"
  chown "$APP_USER:$APP_USER" "$APP_DIR"
  sudo -u "$APP_USER" git clone --quiet "$REPO" "$APP_DIR"
fi

# ---------------------------------------------------------------- 环境变量

ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  log "生成 .env（密钥自动生成，不用你操心）"
  AUTH_SECRET=$(openssl rand -base64 32)
  MASTER_KEY=$(openssl rand -base64 32)

  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
TZ=Asia/Shanghai
PORT=3000

# 部署后改成你的真实域名
PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_SITE_NAME=MiaoKit Catalog

DATABASE_URL="file:$APP_DIR/data/prod.db"

# 自动生成，不要手动改，改了已存的货源凭据会解不开
AUTH_SECRET=$AUTH_SECRET
CREDENTIAL_MASTER_KEY=$MASTER_KEY

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

PLAYWRIGHT_HEADLESS=true
PLAYWRIGHT_PROFILE_ROOT=$APP_DIR/data/browser-profiles

LOG_LEVEL=info
# 挂 Cloudflare 时必须是 cloudflare，否则限流会把所有用户当成同一个 IP
TRUSTED_PROXY_MODE=cloudflare
EOF
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  log ".env 已存在，保留原有密钥"
fi

sudo -u "$APP_USER" mkdir -p "$APP_DIR/data"

# ---------------------------------------------------------------- 构建

log "安装依赖并构建（约 2-3 分钟）"
cd "$APP_DIR"
sudo -u "$APP_USER" pnpm install --frozen-lockfile >/dev/null 2>&1 || sudo -u "$APP_USER" pnpm install >/dev/null 2>&1
sudo -u "$APP_USER" npx prisma generate >/dev/null 2>&1
sudo -u "$APP_USER" env $(grep -v '^#' "$ENV_FILE" | xargs) npx prisma migrate deploy >/dev/null 2>&1
sudo -u "$APP_USER" pnpm build >/dev/null 2>&1
log "构建完成"

# ---------------------------------------------------------------- systemd

log "配置系统服务"

cat > /etc/systemd/system/catalog-web.service <<EOF
[Unit]
Description=MiaoKit Catalog Web
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=$(command -v pnpm) start
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# 安全加固
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$APP_DIR/data $APP_DIR/.next

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/catalog-worker.service <<EOF
[Unit]
Description=MiaoKit Catalog 同步进程
After=network.target catalog-web.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=$(command -v pnpm) worker
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$APP_DIR/data

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now catalog-web catalog-worker >/dev/null 2>&1
sleep 4

# ---------------------------------------------------------------- 结果

echo
if systemctl is-active --quiet catalog-web; then
  log "✓ 网站已启动"
else
  warn "网站启动失败，查看日志：journalctl -u catalog-web -n 40"
fi

if systemctl is-active --quiet catalog-worker; then
  log "✓ 同步进程已启动"
else
  warn "同步进程启动失败：journalctl -u catalog-worker -n 40"
fi

cat <<EOF

──────────────────────────────────────────────
部署完成。接下来：

1. 创建管理员账号
   cd $APP_DIR && sudo -u $APP_USER pnpm create-admin

2. 访问 http://$(hostname -I | awk '{print $1}'):3000/admin

3. 配置域名与 HTTPS（可选）
   sudo bash $APP_DIR/deploy/nginx.sh 你的域名.com

常用命令
   systemctl status catalog-web       查看网站状态
   systemctl status catalog-worker    查看同步状态
   journalctl -u catalog-worker -f    实时看同步日志
   sudo bash $APP_DIR/deploy/update.sh  更新到最新代码
──────────────────────────────────────────────
EOF
