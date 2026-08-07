# MiaoKit Catalog

商品聚合、同步与展示管理平台。

拉取链动小铺货源，缓存并同步价格、库存与销售状态；管理员整理后上架到公开展示页面；
用户点击后跳转到外部原商品页面。

**本站只展示与跳转，不处理订单、付款、发货、退款或售后。**

---

## 快速开始

```bash
pnpm install
npx prisma migrate dev            # 建库（SQLite，无需 Docker）
npx tsx prisma/seed.ts            # 可选：写入演示数据
pnpm create-admin                 # 创建管理员账号
pnpm dev                          # http://localhost:3000
```

另开一个终端跑同步进程：

```bash
pnpm worker
```

- 前台：`/`
- 后台：`/admin`

---

## 完整使用流程

```
1. /admin/sources 添加货源账号（填小铺账号密码）
2. 点「登录」→ 系统用真实浏览器登录，自动抓 Cookie + Merchant-Token
   └─ 遇到验证码 → 状态变成「需要人工验证」→ 用「导入 Cookie」手动贴
3. 点「浏览货源」→ 搜索货源广场，或看「我的商品」
4. 勾选商品 → 导入为本站草稿
5. /admin/products 编辑标题、封面、价格规则、分类 → 发布
6. 前台可见，同步进程自动刷新价格库存
7. 用户点击 → /go/[slug] 确认状态 → 有货才跳转
```

---

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Next.js 16 App Router |
| UI | Tailwind 4 + shadcn/ui |
| 数据库 | SQLite + Prisma（可切 Cloudflare D1） |
| 缓存/队列 | 进程内实现（单机够用） |
| 登录 | Playwright 真实浏览器 |
| 认证 | JWT + HttpOnly Cookie + bcrypt |
| 测试 | Vitest（94 个） |

---

## 目录结构

```
src/
├── app/
│   ├── (site)/           前台：首页、分类、商品详情、搜索
│   ├── admin/            后台：仪表盘、商品、货源
│   ├── go/[slug]/        点击确认与跳转
│   ├── api/              公开 API
│   └── actions/          Server Actions
├── components/
│   ├── ui/               shadcn 组件
│   ├── admin/            后台组件
│   └── site/             前台组件
└── lib/
    ├── freshness.ts      ★ 状态判断与新鲜度
    ├── pricing.ts        价格计算（Decimal）
    ├── redirect.ts       SSRF / 开放重定向防护
    ├── scheduling.ts     同步频率与退避
    ├── cache.ts          缓存、刷新锁、限流
    ├── auth.ts           管理员认证
    ├── crypto.ts         凭据加密（AES-256-GCM）
    ├── sync/             ★ 队列、刷新、点击确认
    ├── connectors/       ★ 货源平台适配
    │   ├── types.ts        通用接口
    │   ├── ldxp/           链动小铺
    │   └── mock/           演示用
    └── queries/          数据查询
```

★ = 项目核心，没有框架能替代的部分。

---

## 三条最重要的设计约束

### 1. 失败不等于缺货

外部接口 401 / 403 / 429 / 超时 / 验证码页 / JSON 变化时，**绝不把商品判成缺货**。
这些错误说明"我们没问到"，不是"问到了没有"。

失败时保留上一次成功的价格与库存，只更新错误计数，前台显示
「暂时无法确认 · 上次有货，15 分钟前确认」。

缺货只能来自一次成功响应里明确的 `stockCount === 0`，且需要**连续两次确认**。
点击确认是例外：用户正在等，明确返回 0 就立刻拦截。

### 2. 展示数据与货源数据分离

- `SourceProduct` — 外部原始数据，同步只写这张表
- `Product` — 管理员编辑的展示内容，同步**永不覆盖**

你改过的标题、封面、分类、SEO 不会被下一次同步冲掉。

### 3. 同商品并发只打一次外部请求

100 个用户同时点同一个商品，只有第一个真正请求货源，其余复用结果。
靠刷新锁 + 任务队列去重实现。

---

## 货源平台可扩展

小铺是第一个接入的平台，不是唯一。

所有适配器实现 `src/lib/connectors/types.ts` 的 `SourceConnector` 接口，
同步引擎只认接口，不认识任何具体平台。

新增平台：写一个适配器 → 在 `src/lib/connectors/index.ts` 注册一行。引擎不用改。

### 小铺接口的已知怪癖（都已处理）

| 怪癖 | 处理方式 |
|---|---|
| 成本价是优先级链，`cost_price` 常缺失 | 依次回落 `agent_price_limit` → `agent_price1/2/3` |
| 库存有两个字段且优先级不一致 | `stock_count` 和 `extend.stock_count` 都读 |
| `status` 是整数 1/0 | 1=销售中，0=仓库中，其余一律 UNKNOWN 不猜 |
| `child` 有值表示已对接 | 用于标记「已对接」 |
| 分类字段名有六七种写法 | 逐个尝试 |
| 更新商品无部分更新 | 必须先 `info` 再整包提交 |
| 所有接口都是 POST | 连查询也是 |
| `code === 1` 才算成功 | 其余按业务失败 |

### 登录方式

平台有真正的账号密码登录接口（在 `pay.ldxp.cn` 域下），所以**不需要浏览器**：

```
POST /merchantApi/system/config       预热拿 Cookie
POST /merchantApi/user/checkSafeMode  提前判断是否需要安全验证
POST /merchantApi/user/login          拿 merchant_token
POST /merchantApi/user/userinfo       确认会话可用
```

`checkSafeMode` 返回非 0 表示该账号开启了安全验证（验证码），
此时直接停止并提示手动导入会话，不做任何绕过尝试。

HTTP 登录失败时会回落到 Playwright 浏览器登录（需服务器装 Chromium）。

### 限流

平台**确实会返回 429**，所以内置了自适应限流（AIMD）：

| 情况 | 动作 |
|---|---|
| 成功 | 延迟 ×0.8（不低于基础值） |
| 429 | 延迟 ×1.7（不低于 1500ms）+ **全局冷却 30 秒** |
| 5xx | 延迟 ×1.7 |
| 网络错误 | 延迟 ×1.35 |

并发上限 2 —— 实测再高就不安全，不要随便调大。

### 小铺接口的已知限制

- **没有删除商品接口** — 三个已知开源实现里都没有。只能删本站展示，动不了小铺那边
- **取消对接是有的** — `POST /merchantApi/MyParent/disconnectGoods {goods_id}`，
  属于写操作，需要打开 `ENABLE_LDXP_WRITE` 开关

---

## 常用命令

```bash
pnpm dev            开发服务器
pnpm worker         同步进程
pnpm build          生产构建
pnpm lint           ESLint
pnpm typecheck      TypeScript
pnpm test           Vitest
pnpm create-admin   创建/重置管理员

npx prisma studio   图形化查看数据库
```

---

## 部署到自己的服务器

```bash
# 1. 环境变量
cp .env.example .env
openssl rand -base64 32   # 生成 AUTH_SECRET
openssl rand -base64 32   # 生成 CREDENTIAL_MASTER_KEY

# 2. 安装与构建
pnpm install --prod=false
npx prisma migrate deploy
npx playwright install chromium --with-deps
pnpm build

# 3. 创建管理员
pnpm create-admin

# 4. 启动（建议用 pm2 / systemd 守护）
pnpm start          # Web
pnpm worker         # 同步进程
```

前面挂 Cloudflare 做 DNS + CDN 时，务必设置：

```bash
TRUSTED_PROXY_MODE=cloudflare
```

否则限流会把所有用户当成同一个 IP（Cloudflare 边缘节点），一个人就能限死所有人。

---

## 安全

- 账号、密码、Cookie、Token 一律 AES-256-GCM 加密后入库
- `CREDENTIAL_MASTER_KEY` 只放环境变量，不入库
- 管理员密码 bcrypt cost 12
- 日志自动脱敏 Cookie / Token / Authorization / 密码
- 跳转目标做 SSRF 与开放重定向防护（禁 localhost、内网段、云元数据地址）
- 外部描述按纯文本渲染，不用 `dangerouslySetInnerHTML`
- `/go/*`、`/admin/*`、状态与 resolve 接口一律 `no-store`
- IP 与 UA 只存加盐哈希，不留明文
- `.env`、浏览器 Profile、数据库文件已在 `.gitignore` 中
