# 项目结构

## 为什么是这个形态

货源平台 `ldxp.cn` 按**出口 IP** 判定：境外 IP、机房 IP、公开代理一律弹滑动验证码，
只有本机的国内住宅 IP 能直连（2026-08-08 实测，含九国住宅代理、三千个公开代理）。
cookie 也救不了——`acw_tc` 和 IP 绑定，推给服务器就失效。

结论：**采集只能在本机跑**。所以形态是「本机采集 → 推静态站到 Cloudflare」，
线上没有任何服务端逻辑，也就没有凭据泄漏面。

```
你本机（国内住宅 IP）                    Cloudflare Pages
┌────────────────────────┐            ┌──────────────────────┐
│ 定时采集 ldxp          │  ──推──→   │ shop.miaokit.cloud   │ 商品站
│ 下载压缩商品图         │            │ miaokit.cloud        │ 门户
│ 构建两个前端           │            └──────────────────────┘
└────────────────────────┘                     ↑
                                        门户运行时 fetch
                                        商品站的 products.json
```

## 目录

| 路径 | 作用 |
|---|---|
| `scripts/sync-catalog.ts` | **采集主流程**：拉商品 → 下载压缩图 → 生成 JSON → 发布两个站 |
| `scripts/schedule.sh` | 定时任务管理（开关、间隔、状态、日志） |
| `scripts/audit-site.ts` | 站点自查，29 项断言 |
| `web/` | **商品站**前端（Vite + TS），→ shop.miaokit.cloud |
| `portal/` | **门户**前端（Vite + TS），→ miaokit.cloud |
| `src/lib/` | 货源连接器与加密工具，共 12 个文件，全部被采集脚本引用 |
| `prisma/` | 数据模型（凭据加密存储用） |
| `data/` | 运行时产物：日志、同步状态（不入库） |

原先的 Next.js 应用（后台管理、商品页、登录）已整体移除——当前形态下
线上没有服务端，那套代码没有运行环境。需要后台时另起。

## 数据流

```
ldxp.cn
   ↓ scripts/sync-catalog.ts
web/public/products.json  ← 唯一数据源（约 48KB）
web/public/img/*.webp     ← 商品图（本地化，因源站防盗链 403）
   ↓ 构建 + 发布
shop.miaokit.cloud/products.json
   ↓ 运行时 fetch
miaokit.cloud（门户的数字与商品条）
```

**门户没有自己的数据**——它运行时去商品站拉。所以商品上下架后，
两个站的数字会一起变，不用手工同步。

## 日常命令

```bash
pnpm sync                 # 采集，只写本地不发布
pnpm sync --deploy        # 采集 + 发布两个站
pnpm sync --deploy --rebuild   # 改了前端代码时用（强制重建）

pnpm schedule             # 看状态：开关、间隔、上次结果、登录态
pnpm schedule on 5        # 开启（实际间隔 5-10 分钟，带随机抖动）
pnpm schedule off         # 关闭
pnpm schedule every 15    # 只改间隔
pnpm schedule run         # 立刻跑一次
pnpm schedule logs        # 跟踪日志

pnpm check-site           # 站点自查（计数一致性、筛选、排序、移动端）
```

## 改东西改哪里

| 要改什么 | 改这里 |
|---|---|
| 门户上的服务/工具/教程 | `portal/src/lib/services.ts` |
| 门户文案、Hero | `portal/src/main.ts` |
| 商品站布局与筛选 | `web/src/main.ts` |
| 商品卡片样式 | `web/src/components/product-card.ts` |
| 采集逻辑、图片处理 | `scripts/sync-catalog.ts` |
| 定时策略 | `scripts/schedule.sh` |

## 注意

- **合盖睡眠时定时任务不跑**，唤醒后按间隔继续（launchd `StartInterval` 的行为）
- 采集产物（`web/public/img`、`products.json`、两个 `dist/`）都在 `.gitignore` 里
- 同步连续失败 2 次会弹 macOS 通知，并提示该做什么（如「登录过期 → wrangler login」）
