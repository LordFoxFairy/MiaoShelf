#!/bin/sh
#
# 容器启动入口。
#
# 网站容器启动前自动跑一次数据库迁移，省得部署时手动执行。
# 同步进程容器跳过（两个容器共用一个 SQLite 文件，跑一次就够）。
set -e

if [ "$1" = "node" ] && [ "$2" = "server.js" ]; then
  echo "==> 应用数据库迁移"
  prisma migrate deploy --schema /app/prisma/schema.prisma || {
    echo "迁移失败，容器退出" >&2
    exit 1
  }
fi

exec "$@"
