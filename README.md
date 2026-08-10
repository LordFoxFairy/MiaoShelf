# MiaoKit Catalog

MiaoKit 的商品采集、静态目录与门户站。

项目从链动小铺的公开店铺接口读取商品，在本机缓存商品图并生成静态站点，
再发布到 Cloudflare Pages。线上没有数据库、账号系统或服务端运行时。

## 项目组成

| 路径 | 作用 |
| --- | --- |
| `scripts/sync-catalog.ts` | 采集商品、下载图片、生成 JSON/SEO 页面并发布 |
| `scripts/schedule.sh` | 使用 macOS launchd 管理定时同步 |
| `scripts/audit-site.ts` | 使用 Playwright 检查筛选、计数、图片和移动端布局 |
| `src/lib/connectors/` | 公开店铺连接器、HTTP、限流和数据标准化 |
| `web/` | 商品站，Vite + TypeScript，部署到 `shop.miaokit.cloud` |
| `portal/` | 门户站，Vite + TypeScript，部署到 `miaokit.cloud` |
| `data/` | 本地同步状态和日志，不提交 Git |

完整数据流与发布细节见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 环境要求

- Node.js `^20.19.0` 或 `>=22.12.0`
- pnpm 8
- macOS：定时任务、系统通知和 `sips` 图片缩放依赖 macOS
- `cwebp`：可选，安装后商品图片会转换成 WebP
- Wrangler 登录：只有发布 Cloudflare Pages 时需要

## 安装

仓库当前包含三个独立 pnpm 工程：

```bash
pnpm install
pnpm --dir web install
pnpm --dir portal install
cp .env.example .env
```

默认配置已经指向当前公开店铺和 Cloudflare 项目。本地只预览现有数据时，
不创建 `.env` 也可以。

## 本地开发

商品站：

```bash
pnpm --dir web dev
```

门户站：

```bash
pnpm --dir portal dev
```

商品站需要 `web/public/products.json`。该文件由 `pnpm sync` 生成且不提交 Git。

## 同步与发布

```bash
pnpm sync                       # 采集并更新本地数据，不发布
pnpm sync --deploy              # 采集并发布商品站、门户站
pnpm sync --deploy --rebuild    # 前端代码变化后强制重建再发布
pnpm sync --allow-large-drop    # 确认大量商品正常下架后允许覆盖
```

同步流程会：

1. 拉取全部商品类型和分页数据。
2. 拒绝用空结果或异常大幅减少的结果覆盖上一次成功数据。
3. 下载新增图片，缩放并尽量转换成 WebP。
4. 清理已经不属于当前目录的本地图片。
5. 写入 `web/public/products.json`。
6. 生成首页、商品页、分类页、sitemap 和 robots.txt。
7. 使用 Wrangler 发布到 Cloudflare Pages。

首次发布前执行：

```bash
npx wrangler login
```

## 定时同步

```bash
pnpm schedule                 # 查看状态
pnpm schedule on 5            # 开启，实际间隔为 5-10 分钟
pnpm schedule every 15        # 修改基础间隔
pnpm schedule run             # 立即同步并发布一次
pnpm schedule logs            # 跟踪日志
pnpm schedule off             # 关闭
```

定时同步使用 macOS launchd。电脑睡眠期间不会执行，唤醒后按配置继续。
连续失败两次会发送系统通知，状态保存在 `data/sync-state.json`。

## 质量检查

```bash
pnpm typecheck                # 根连接器、同步脚本和测试类型检查
pnpm test                     # 核心纯逻辑测试
pnpm build                    # 构建商品站和门户站
pnpm check-site               # 检查线上商品站
```

检查本地预览站：

```bash
AUDIT_URL=http://localhost:4173 pnpm check-site
```

## 常用修改入口

| 要修改的内容 | 文件 |
| --- | --- |
| 门户文案、Hero | `portal/src/main.ts` |
| 门户服务和工具 | `portal/src/lib/services.ts` |
| 商品筛选与布局 | `web/src/main.ts` |
| 商品卡片 | `web/src/components/product-card.ts` |
| 商品站样式 | `web/src/styles/app.css` |
| 采集与发布 | `scripts/sync-catalog.ts` |
| SEO 静态页 | `scripts/lib/static-pages.ts` |
| 定时策略 | `scripts/schedule.sh` |

## 运行原则

- 采集依赖本机可直连货源平台的网络出口。
- 商品图必须本地化，源站图片直接用于浏览器时可能返回 403。
- 线上站点只展示商品并跳转，不处理订单、付款、发货、退款或售后。
- `web/public/products.json`、商品图片、`dist/`、日志和同步状态均不提交 Git。
