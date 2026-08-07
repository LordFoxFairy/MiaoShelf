# Cloudflare 配置 —— 让服务器少扛活

你的服务器只有 3.3G 内存、2 核，还跑着 1Panel、sub2api 等服务。
所以目标很明确：**能让 Cloudflare 干的活，绝不占服务器资源。**

全部用免费版就够，不需要付费计划。

---

## 一、先理解哪些能缓存、哪些绝不能

这是最要紧的一件事。搞错了会出**用户看到别人的登录状态**这种严重问题。

| 路径 | 能否缓存 | 为什么 |
|---|---|---|
| `/_next/static/*` | ✅ 永久 | 文件名带 hash，内容变了文件名就变 |
| `/` `/products/*` `/category/*` `/search` | ✅ 60 秒 | 商品信息，短暂陈旧可接受 |
| `/api/public/products/*/status` | ❌ **绝不** | 实时库存，缓存了就没意义 |
| `/go/*` | ❌ **绝不** | 点击确认，每次都要真实判断 |
| `/admin/*` `/api/admin/*` | ❌ **绝不** | 含登录态，缓存会泄露给别人 |
| `/login` | ❌ **绝不** | 同上 |

应用已经在响应头里声明好了（`src/proxy.ts`），Cloudflare 默认会遵守。
下面的配置是**再加一道保险**，防止误配置导致灾难。

---

## 二、DNS

Cloudflare 后台 → 你的域名 → **DNS**：

| 类型 | 名称 | 内容 | 代理状态 |
|---|---|---|---|
| A | `catalog`（或 `@`） | `170.106.159.166` | **已代理（橙色云朵）** |

⚠️ **必须是橙色云朵**。灰色的话流量直连服务器，Cloudflare 什么忙都帮不上。

---

## 三、SSL/TLS

**SSL/TLS → 概述 → 选「完全（严格）」**

前提是服务器上有有效证书。你的 1Panel 应该能一键申请。

如果暂时没有，先用「灵活」能跑通，但 Cloudflare 到服务器那段是明文，
**尽快换成完全（严格）**。

同时打开：
- SSL/TLS → 边缘证书 → **始终使用 HTTPS**：开
- **自动 HTTPS 重写**：开

---

## 四、缓存规则（省服务器资源的核心）

**Rules → Cache Rules**，按顺序建三条。顺序很重要，先匹配的先生效。

### 规则 1：静态资源永久缓存（优先级最高）

- **规则名**：静态资源
- **匹配**：`URI 路径` **以...开头** `/_next/static/`
- **设置**：
  - 缓存资格 → **符合缓存条件**
  - 边缘 TTL → **忽略 cache-control 标头并使用此 TTL** → `1 个月`
  - 浏览器 TTL → **1 年**

**效果**：JS/CSS 全部由 Cloudflare 提供，服务器一次都不用发。

### 规则 2：动态内容绝不缓存

- **规则名**：不可缓存路径
- **匹配**（用表达式编辑器，直接粘贴）：

```
(starts_with(http.request.uri.path, "/admin")) or
(starts_with(http.request.uri.path, "/api/admin")) or
(starts_with(http.request.uri.path, "/go/")) or
(starts_with(http.request.uri.path, "/login")) or
(http.request.uri.path contains "/status") or
(http.request.uri.path contains "/resolve")
```

- **设置**：缓存资格 → **绕过缓存**

**这条最重要。** 宁可这条误伤几个路径，也不能让后台页面被缓存。

### 规则 3：前台页面短缓存

- **规则名**：前台页面
- **匹配**：`URI 路径` **等于** `/` **或** 以 `/products/`、`/category/`、`/search` 开头
- **设置**：
  - 缓存资格 → **符合缓存条件**
  - 边缘 TTL → **使用 cache-control 标头**（应用已经声明了 `s-maxage=60`）

**效果**：同一个商品页 60 秒内被访问 100 次，服务器只处理 1 次。

> 商品的实时库存不受影响 —— 它由页面里的 `LiveStatus` 组件单独请求
> `/api/public/products/*/status`，那个路径被规则 2 排除在缓存外。

---

## 五、其余开关

**速度 → 优化**
- Brotli 压缩：**开**（省带宽）
- Early Hints：**开**

**缓存 → 配置**
- 浏览器缓存 TTL：**遵循现有标头**
- Always Online：**开**（服务器挂了还能返回缓存页）

**安全性 → WAF → 速率限制规则**（免费版可建 1 条）

保护点击接口不被刷：
- 匹配：`URI 路径` 以 `/go/` 开头
- 速率：同一 IP **10 秒内 20 次**
- 动作：**阻止**

应用自己也有限流（5 秒 1 次），但那要消耗服务器资源才能判断。
Cloudflare 这层在边缘就挡掉了。

---

## 六、验证配置生效

部署完在本机执行：

```bash
# 静态资源应该 HIT（第二次请求开始）
curl -sI https://你的域名/_next/static/ | grep -i cf-cache-status

# 首页应该 HIT
curl -sI https://你的域名/ | grep -i cf-cache-status

# 后台必须是 BYPASS 或 DYNAMIC —— 如果显示 HIT 立刻改规则！
curl -sI https://你的域名/admin | grep -i cf-cache-status

# 状态接口必须不缓存
curl -sI https://你的域名/api/public/products/任意slug/status | grep -i cf-cache-status
```

`cf-cache-status` 的含义：
- `HIT` = Cloudflare 直接返回，**没有打到你服务器** ✅
- `MISS` = 第一次请求，正在填充缓存（正常）
- `BYPASS` / `DYNAMIC` = 不缓存（后台和 API 应该是这个）

---

## 七、真实节省效果

按你店铺 229 个商品估算：

| 场景 | 没有 Cloudflare | 配好之后 |
|---|---|---|
| 100 人浏览首页 | 服务器渲染 100 次 | 渲染 1 次 |
| 加载 JS/CSS | 每次都从服务器拉 | 全部走 CDN，服务器零负担 |
| 有人恶意刷页面 | 服务器被打满 | 边缘挡掉 |

对你这台内存吃紧的机器，这个差别很实在。

---

## 八、注意事项

**别开的功能：**

- ❌ **Rocket Loader** —— 会打乱 JS 执行顺序，React 应用容易白屏
- ❌ **Auto Minify** —— Next.js 已经压缩过，重复处理可能出错
- ❌ **Email Obfuscation** —— 会往 HTML 里注入脚本，干扰 React 水合

**服务器上必须设置：**

```
TRUSTED_PROXY_MODE=cloudflare
```

不设的话，应用看到的客户端 IP 全是 Cloudflare 边缘节点的地址，
**限流会把所有用户当成同一个人**，一个人就能把全站限死。

`.env` 里已经默认设好了。
