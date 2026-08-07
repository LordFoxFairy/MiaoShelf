import { z } from "zod";

/**
 * 环境变量校验（spec §23）。
 *
 * 启动时一次性校验完，缺关键变量就直接崩——比运行到一半才发现
 * CREDENTIAL_MASTER_KEY 是空字符串、结果把 Cookie 明文写进库要好。
 */

const csv = z
  .string()
  .default("")
  .transform((raw) =>
    raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

/** 密钥必须够长；太短的 key 起不到加密作用，属于配置事故。 */
const secret = (min: number) =>
  z.string().min(min, `密钥长度至少 ${min} 位，请用 openssl rand -base64 32 生成`);

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TZ: z.string().default("America/Los_Angeles"),

  PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_SITE_NAME: z.string().default("MiaoKit Catalog"),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  AUTH_SECRET: secret(32),
  CREDENTIAL_MASTER_KEY: secret(32),

  LDXP_BASE_URL: z.string().url().default("https://www.ldxp.cn"),
  LDXP_ALLOWED_REDIRECT_HOSTS: csv,
  /** 写操作总开关，默认关闭（spec §0.7、§9.4）。 */
  ENABLE_LDXP_WRITE: z.coerce.boolean().default(false),
  /** 单次写操作最多影响多少商品，超过要二次确认。 */
  LDXP_WRITE_BATCH_LIMIT: z.coerce.number().int().positive().default(10),

  SYNC_SCHEDULER_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  SYNC_HOT_SECONDS: z.coerce.number().int().positive().default(60),
  SYNC_NORMAL_SECONDS: z.coerce.number().int().positive().default(300),
  SYNC_COLD_SECONDS: z.coerce.number().int().positive().default(1800),
  SYNC_FULL_CATALOG_SECONDS: z.coerce.number().int().positive().default(3600),

  STATUS_FRESH_SECONDS: z.coerce.number().int().positive().default(120),
  STATUS_STALE_SECONDS: z.coerce.number().int().positive().default(900),
  CLICK_FRESH_SECONDS: z.coerce.number().int().positive().default(30),
  CLICK_RESOLVE_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
  REFRESH_LOCK_SECONDS: z.coerce.number().int().positive().default(30),

  SOURCE_ACCOUNT_CONCURRENCY: z.coerce.number().int().positive().default(1),
  GLOBAL_SOURCE_CONCURRENCY: z.coerce.number().int().positive().default(3),
  LOW_STOCK_THRESHOLD: z.coerce.number().int().nonnegative().default(5),

  PLAYWRIGHT_HEADLESS: z.coerce.boolean().default(true),
  PLAYWRIGHT_PROFILE_ROOT: z.string().default("/data/browser-profiles"),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  /** cloudflare = 信任 CF-Connecting-IP（spec §15.4）。 */
  TRUSTED_PROXY_MODE: z.enum(["cloudflare", "xff", "none"]).default("none"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`环境变量校验失败：\n${issues}`);
  }

  cached = parsed.data;
  return cached;
}

/** 仅供测试重置。 */
export function resetEnvCache(): void {
  cached = null;
}

/**
 * 派生出的默认允许跳转域名。
 * 环境变量没配时回落到 LDXP_BASE_URL 的域名，避免一配错就全站不能跳。
 */
export function resolveAllowedRedirectHosts(env: Env): string[] {
  if (env.LDXP_ALLOWED_REDIRECT_HOSTS.length > 0) {
    return env.LDXP_ALLOWED_REDIRECT_HOSTS;
  }
  try {
    return [new URL(env.LDXP_BASE_URL).hostname];
  } catch {
    return [];
  }
}
