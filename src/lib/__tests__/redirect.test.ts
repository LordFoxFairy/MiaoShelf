import { describe, expect, it } from "vitest";
import {
  isHostAllowed,
  isPrivateHostname,
  pickTargetUrl,
  validateRedirectUrl,
} from "@/lib/redirect";

const ALLOWED = ["ldxp.cn", "pay.ldxp.cn"];

describe("validateRedirectUrl —— 开放重定向与 SSRF 防护", () => {
  it("允许列表内的 https 地址通过", () => {
    const result = validateRedirectUrl("https://pay.ldxp.cn/order/123", ALLOWED);
    expect(result.ok).toBe(true);
  });

  it("允许子域", () => {
    const result = validateRedirectUrl("https://www.ldxp.cn/goods/1", ALLOWED);
    expect(result.ok).toBe(true);
  });

  it("拒绝不在允许列表的域名", () => {
    const result = validateRedirectUrl("https://evil.example.com/x", ALLOWED);
    expect(result).toMatchObject({ ok: false, reason: "HOST_NOT_ALLOWED" });
  });

  it("拒绝 javascript: 协议", () => {
    // 这个如果漏了就是储存型 XSS。
    const result = validateRedirectUrl("javascript:alert(1)", ALLOWED);
    expect(result).toMatchObject({ ok: false, reason: "BAD_PROTOCOL" });
  });

  it("拒绝 file: 协议", () => {
    expect(validateRedirectUrl("file:///etc/passwd", ALLOWED)).toMatchObject({
      ok: false,
      reason: "BAD_PROTOCOL",
    });
  });

  it("拒绝 localhost", () => {
    expect(validateRedirectUrl("http://localhost:6379/", [])).toMatchObject({
      ok: false,
      reason: "PRIVATE_HOST",
    });
  });

  it("拒绝内网地址，即使允许列表为空", () => {
    // 允许列表没配不代表可以随便打内网 —— Redis/Postgres 就在内网。
    for (const url of [
      "http://127.0.0.1:5432/",
      "http://10.0.0.5/",
      "http://192.168.1.1/",
      "http://172.16.0.1/",
      "http://169.254.169.254/latest/meta-data/",
    ]) {
      expect(validateRedirectUrl(url, [])).toMatchObject({
        ok: false,
        reason: "PRIVATE_HOST",
      });
    }
  });

  it("拒绝云元数据地址", () => {
    expect(
      validateRedirectUrl("http://metadata.google.internal/", []),
    ).toMatchObject({ ok: false, reason: "PRIVATE_HOST" });
  });

  it("拒绝畸形 URL", () => {
    expect(validateRedirectUrl("not a url", ALLOWED)).toMatchObject({
      ok: false,
      reason: "INVALID_URL",
    });
  });

  it("不把 evil-ldxp.cn 误判为 ldxp.cn 的子域", () => {
    // 后缀匹配必须带点，否则 attacker-ldxp.cn 会被放行。
    expect(isHostAllowed("evil-ldxp.cn", ALLOWED)).toBe(false);
    expect(isHostAllowed("a.ldxp.cn", ALLOWED)).toBe(true);
  });
});

describe("isPrivateHostname", () => {
  it("公网地址不算内网", () => {
    expect(isPrivateHostname("ldxp.cn")).toBe(false);
    expect(isPrivateHostname("8.8.8.8")).toBe(false);
  });

  it("IPv6 回环和唯一本地地址算内网", () => {
    expect(isPrivateHostname("::1")).toBe(true);
    expect(isPrivateHostname("[::1]")).toBe(true);
    expect(isPrivateHostname("fd00::1")).toBe(true);
  });
});

describe("pickTargetUrl —— 链接优先级", () => {
  it("管理员 override 优先级最高", () => {
    expect(
      pickTargetUrl({
        targetUrlOverride: "https://custom.example/x",
        sourceUrl: "https://ldxp.cn/a",
        resolvedLink: "https://ldxp.cn/b",
      }),
    ).toBe("https://custom.example/x");
  });

  it("没有 override 时用来源自带链接", () => {
    expect(
      pickTargetUrl({
        sourceUrl: "https://ldxp.cn/a",
        resolvedLink: "https://ldxp.cn/b",
      }),
    ).toBe("https://ldxp.cn/a");
  });

  it("最后回落到 short_link", () => {
    expect(
      pickTargetUrl({ resolvedShortLink: "https://s.ldxp.cn/z" }),
    ).toBe("https://s.ldxp.cn/z");
  });

  it("全都没有时返回 null", () => {
    expect(pickTargetUrl({})).toBeNull();
  });
});
