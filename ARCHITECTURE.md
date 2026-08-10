# 项目架构

## 形态

链动小铺会根据出口 IP 触发访问保护，而当前本机网络可以稳定访问公开店铺接口。
因此采集任务在本机运行，线上只部署静态文件。

```text
链动小铺公开接口
        |
        v
本机 scripts/sync-catalog.ts
  |-- web/public/products.json
  |-- web/public/img/*
  |-- web/dist/p/* 与 web/dist/c/*
  |
  +---- Cloudflare Pages ---- shop.miaokit.cloud
  |
  +---- Cloudflare Pages ---- miaokit.cloud
                                  |
                                  +-- 运行时读取商品站 products.json
```

线上没有数据库、认证、后台管理或服务端 API。门户没有自己的商品数据源。

## 目录边界

| 路径 | 职责 |
| --- | --- |
| `src/lib/connectors/ldxp-shop/` | 链动小铺公开店铺适配 |
| `src/lib/connectors/http.ts` | 超时、响应校验和错误分类 |
| `src/lib/connectors/rate-limiter.ts` | 自适应请求间隔和 429 冷却 |
| `src/lib/connectors/normalize.ts` | 价格、库存、状态和错误文本标准化 |
| `scripts/sync-catalog.ts` | 同步编排、图片处理、构建和发布 |
| `scripts/lib/static-pages.ts` | 商品页、分类页和 sitemap 生成 |
| `scripts/lib/image-cache.ts` | 安全图片文件名与过期图片清理 |
| `web/` | 交互式商品目录 |
| `portal/` | 品牌入口和服务导航 |
| `tests/` | 不依赖网络的核心逻辑测试 |

## 商品数据契约

唯一公开数据源是 `web/public/products.json`：

```json
{
  "shopName": "miaokit",
  "updatedAt": "2026-08-10T03:40:26.872Z",
  "items": [
    {
      "externalId": "PRODUCT_ID",
      "title": "商品标题",
      "imageUrl": "/img/PRODUCT_ID.webp",
      "price": "10.00",
      "stockCount": 10,
      "availabilityHint": "IN_STOCK",
      "url": "https://pay.ldxp.cn/item/PRODUCT_ID",
      "category": "分类",
      "goodsType": "card"
    }
  ]
}
```

同步脚本会把连接器中的可空标题、状态、链接和商品类型转换成稳定的前端字段，
避免外部接口缺字段时产出不符合前端契约的 JSON。

## 同步过程

1. `LdxpShopConnector` 遍历 `card`、`article`、`resource`、`equity`。
2. 每类最多翻 20 页，请求经过自适应限流器。
3. 空目录或商品数量下降超过 50% 会被视为异常，不覆盖上一次成功结果。
4. 图片按商品 ID 缓存；已有文件复用，新文件缩放并尽量转为 WebP。
5. 本轮目录中不存在的图片会被清理。
6. JSON 写入后，按需要复用或重建 Vite 产物。
7. 商品站生成独立商品页、分类页、结构化数据、sitemap 和 robots.txt。
8. 商品站发布成功后再构建并发布门户站。

门户发布失败不会把已经成功的商品同步标记为失败；商品站是主链路。

## 缓存与构建

- 日常数据同步可复用 `web/dist`，只更新 JSON 和图片。
- 修改 `web/` 后使用 `--rebuild`，避免复用旧 JS/CSS。
- 门户每次发布都会重新构建，体积较小。
- 采集产物和运行状态都在 `.gitignore` 中。

## 故障处理

| 现象 | 处理 |
| --- | --- |
| 一个商品都没有 | 中止写入，保留上次成功数据 |
| 商品数量下降超过 50% | 中止写入；确认正常后使用 `--allow-large-drop` |
| 429 | 增加请求延迟并全局冷却 |
| 超时或网络错误 | 记录失败，连续两次后通知 |
| Cloudflare 授权过期 | 执行 `npx wrangler login` |
| 图片下载失败 | 保留远程图片地址，不阻断商品同步 |
| 门户发布失败 | 警告但保留商品站成功结果 |

## 运行状态

`scripts/schedule.sh` 使用 launchd 管理任务，状态写入：

- `data/sync-state.json`：最近一次结果和连续失败次数
- `data/sync.log`：后台同步日志

这些文件只用于本机运维，不进入发布产物。
