#!/usr/bin/env bash
#
# 更新到最新代码
#
#   sudo bash deploy/update.sh
#
# 会保留 .env 和数据库，只更新代码并重启服务。
#
set -euo pipefail

APP_USER="${APP_USER:-catalog}"
APP_DIR="${APP_DIR:-/opt/miaokit-catalog}"

log() { printf "\033[1;34m==>\033[0m %s\n" "$*"; }
die() { printf "\033[1;31m错误:\033[0m %s\n" "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 运行"
[ -d "$APP_DIR/.git" ] || die "$APP_DIR 不是一个 git 仓库，请先执行 install.sh"

cd "$APP_DIR"

# 更新前先备份数据库 —— 迁移出问题时还有得救
if [ -f "$APP_DIR/data/prod.db" ]; then
  BACKUP="$APP_DIR/data/backup-$(date +%Y%m%d-%H%M%S).db"
  sudo -u "$APP_USER" cp "$APP_DIR/data/prod.db" "$BACKUP"
  log "已备份数据库到 $(basename "$BACKUP")"

  # 只留最近 7 个备份
  sudo -u "$APP_USER" bash -c "ls -t $APP_DIR/data/backup-*.db 2>/dev/null | tail -n +8 | xargs -r rm --"
fi

log "拉取最新代码"
sudo -u "$APP_USER" git fetch --quiet origin
sudo -u "$APP_USER" git reset --hard --quiet origin/main

log "安装依赖"
sudo -u "$APP_USER" pnpm install --frozen-lockfile >/dev/null 2>&1 || sudo -u "$APP_USER" pnpm install >/dev/null 2>&1

log "应用数据库迁移"
sudo -u "$APP_USER" npx prisma generate >/dev/null 2>&1
sudo -u "$APP_USER" env $(grep -v '^#' "$APP_DIR/.env" | xargs) npx prisma migrate deploy

log "构建"
sudo -u "$APP_USER" pnpm build >/dev/null 2>&1

log "重启服务"
systemctl restart catalog-web catalog-worker
sleep 4

systemctl is-active --quiet catalog-web    && log "✓ 网站运行中"    || die "网站启动失败：journalctl -u catalog-web -n 40"
systemctl is-active --quiet catalog-worker && log "✓ 同步进程运行中" || die "同步启动失败：journalctl -u catalog-worker -n 40"

log "更新完成"
