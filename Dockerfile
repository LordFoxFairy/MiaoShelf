# MiaoKit Catalog
#
# 一个镜像同时能跑网站和同步进程，靠启动命令区分：
#   网站：      默认（node server.js）
#   同步进程：  pnpm worker
#
# 用 debian-slim 而不是 alpine：Prisma 的查询引擎依赖 OpenSSL，
# alpine 上要额外折腾 musl 版本，slim 开箱即用，省事且更可靠。

# ---------------------------------------------------------------- 依赖
FROM node:22-slim AS deps
WORKDIR /app

# Prisma 生成引擎时需要 openssl
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@8.14.0 --activate

COPY package.json pnpm-lock.yaml* ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile && pnpm exec prisma generate

# ---------------------------------------------------------------- 构建
FROM node:22-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@8.14.0 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm exec prisma generate

ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# 同步进程预先编译成普通 JS，运行时就不需要 TypeScript 工具链了。
# 直接在镜像里跑 tsx 会拖进 esbuild 等一堆构建期依赖，既大又容易出解析问题。
RUN pnpm exec esbuild src/worker/index.ts \
        --bundle \
        --platform=node \
        --target=node22 \
        --format=cjs \
        --outfile=/worker-dist/worker.cjs \
        --external:@prisma/client \
        --external:.prisma \
        --alias:@=./src \
    && pnpm exec esbuild scripts/create-admin.ts \
        --bundle --platform=node --target=node22 --format=cjs \
        --outfile=/worker-dist/create-admin.cjs \
        --external:@prisma/client --external:.prisma --alias:@=./src \
    && pnpm exec esbuild scripts/check-source.ts \
        --bundle --platform=node --target=node22 --format=cjs \
        --outfile=/worker-dist/check-source.cjs \
        --external:@prisma/client --external:.prisma --alias:@=./src \
    && echo "worker、建管理员、诊断脚本已编译"

# 运行时的最小依赖：只有 Prisma Client 和它的查询引擎。
# 用 npm 装（扁平结构，好拷贝），再在这个目录里 generate 一次。
RUN mkdir -p /worker-deps && cd /worker-deps \
    && npm init -y >/dev/null 2>&1 \
    && npm install --omit=dev --no-audit --no-fund \
         @prisma/client@5.22.0 prisma@5.22.0 >/dev/null 2>&1 \
    && cp -r /app/prisma ./prisma \
    && ./node_modules/.bin/prisma generate --schema ./prisma/schema.prisma

# ---------------------------------------------------------------- 运行
FROM node:22-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        openssl ca-certificates tini curl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable && corepack prepare pnpm@8.14.0 --activate \
    && groupadd -g 1001 nodejs \
    && useradd -u 1001 -g nodejs -m nextjs

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NODE_PATH=/worker-modules \
    PATH=/worker-modules/.bin:$PATH

# 网站：standalone 产物，自带精简过的 node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# 同步进程需要源码 + 最小依赖集
COPY --from=builder --chown=nextjs:nodejs /app/src ./src
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs \
     /app/package.json /app/tsconfig.json /app/tsconfig.worker.json ./

# 编译好的同步进程 + 它需要的 Prisma 运行时
COPY --from=builder --chown=nextjs:nodejs /worker-dist/worker.cjs ./worker.cjs
COPY --from=builder --chown=nextjs:nodejs /worker-dist/create-admin.cjs ./create-admin.cjs
COPY --from=builder --chown=nextjs:nodejs /worker-dist/check-source.cjs ./check-source.cjs
COPY --from=builder --chown=nextjs:nodejs /worker-deps/node_modules /worker-modules

# 数据目录（SQLite 文件、浏览器 Profile），部署时挂 volume
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data
VOLUME ["/app/data"]

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
    CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

COPY --chown=nextjs:nodejs docker-entrypoint.sh /usr/local/bin/
USER root
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
USER nextjs

# tini 回收僵尸进程并正确转发信号，容器才能优雅退出
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
