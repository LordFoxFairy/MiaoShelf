import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseShopUrl } from "@/lib/connectors/ldxp-shop/connector";
import {
  availabilityFromStock,
  parsePrice,
  parseStock,
  safeErrorDetail,
} from "@/lib/connectors/normalize";
import { Availability } from "@/lib/enums";
import {
  isSuspiciousCatalogDrop,
  readCatalogItemCount,
} from "../scripts/lib/catalog-safety";
import {
  imageFileStem,
  pruneOrphanImages,
} from "../scripts/lib/image-cache";
import {
  jsonForHtml,
  productPage,
  type PageProduct,
} from "../scripts/lib/static-pages";

test("店铺地址解析出 API 根地址和 token", () => {
  assert.deepEqual(parseShopUrl("https://pay.ldxp.cn/shop/miaoli/"), {
    apiBase: "https://pay.ldxp.cn",
    token: "miaoli",
  });
  assert.equal(parseShopUrl("not-a-url"), null);
  assert.equal(parseShopUrl("https://pay.ldxp.cn/"), null);
});

test("价格、库存和库存状态保持明确语义", () => {
  assert.equal(parsePrice("¥ 12.30")?.toString(), "12.3");
  assert.equal(parsePrice("invalid"), null);
  assert.equal(parseStock(undefined), undefined);
  assert.equal(parseStock(null), null);
  assert.equal(parseStock("3.9"), 3);
  assert.equal(parseStock(-4), 0);
  assert.equal(availabilityFromStock(undefined, 5), null);
  assert.equal(availabilityFromStock(null, 5), Availability.NOT_APPLICABLE);
  assert.equal(availabilityFromStock(0, 5), Availability.OUT_OF_STOCK);
  assert.equal(availabilityFromStock(3, 5), Availability.LOW_STOCK);
  assert.equal(availabilityFromStock(10, 5), Availability.IN_STOCK);
});

test("错误详情在记录前会脱敏并截断", () => {
  const detail = safeErrorDetail(
    "authorization=secret password=hunter2 cookie=session-value",
    48,
  );
  assert.ok(!detail.includes("secret"));
  assert.ok(!detail.includes("hunter2"));
  assert.ok(!detail.includes("session-value"));
  assert.ok(detail.length <= 48);
});

test("JSON-LD 不允许外部文本提前闭合 script 标签", () => {
  const attack = "</script><script>alert(1)</script>";
  const encoded = jsonForHtml({ name: attack });
  assert.ok(!encoded.includes("<"));
  assert.ok(encoded.includes("\\u003c/script\\u003e"));

  const product: PageProduct = {
    externalId: "product-1",
    title: attack,
    imageUrl: null,
    price: "12.30",
    stockCount: 3,
    availabilityHint: "LOW_STOCK",
    url: "https://pay.ldxp.cn/item/product-1",
    category: "测试分类",
    goodsType: "card",
  };
  const html = productPage(product, [], "/c/test/");
  assert.ok(!html.includes(attack));
  assert.ok(html.includes("\\u003c/script\\u003e"));
});

test("图片缓存只删除不属于当前商品的文件", () => {
  const dir = mkdtempSync(join(tmpdir(), "miaokit-images-"));
  try {
    writeFileSync(join(dir, "keep.webp"), "keep");
    writeFileSync(join(dir, "old.png"), "old");
    writeFileSync(join(dir, ".DS_Store"), "metadata");
    mkdirSync(join(dir, "nested"));

    assert.equal(imageFileStem(" ../unsafe id "), "_unsafe_id");
    assert.equal(pruneOrphanImages(dir, ["keep"]), 1);
    assert.ok(existsSync(join(dir, "keep.webp")));
    assert.ok(!existsSync(join(dir, "old.png")));
    assert.ok(existsSync(join(dir, ".DS_Store")));
    assert.ok(existsSync(join(dir, "nested")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("商品数量大幅下降时阻止覆盖历史目录", () => {
  assert.equal(isSuspiciousCatalogDrop(210, 215), false);
  assert.equal(isSuspiciousCatalogDrop(107, 215), true);
  assert.equal(isSuspiciousCatalogDrop(1, null), false);

  const dir = mkdtempSync(join(tmpdir(), "miaokit-catalog-"));
  try {
    const valid = join(dir, "valid.json");
    const invalid = join(dir, "invalid.json");
    writeFileSync(valid, JSON.stringify({ items: [{}, {}, {}] }));
    writeFileSync(invalid, "not-json");
    assert.equal(readCatalogItemCount(valid), 3);
    assert.equal(readCatalogItemCount(invalid), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
