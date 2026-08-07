import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * 凭据加密（spec §22）。
 *
 * AES-256-GCM：既加密又鉴权，能检测密文被篡改。
 * 主密钥只从 CREDENTIAL_MASTER_KEY 环境变量读取，绝不入库——
 * 否则拖库的人连密钥一起拿走，加密就白做了。
 *
 * 存储格式：v1:<base64 iv>:<base64 authTag>:<base64 ciphertext>
 * 带版本前缀，将来换算法时能平滑迁移。
 */

const VERSION = "v1";
const IV_LENGTH = 12; // GCM 推荐 96 bit
const KEY_LENGTH = 32; // AES-256

/**
 * 把任意长度的主密钥规整成 32 字节。
 * 用 SHA-256 而不是直接截断，保证熵均匀分布。
 */
function deriveKey(masterKey: string): Buffer {
  if (!masterKey || masterKey.length < 32) {
    throw new Error(
      "CREDENTIAL_MASTER_KEY 缺失或过短（至少 32 位）。请用 openssl rand -base64 32 生成。",
    );
  }
  return createHash("sha256").update(masterKey, "utf8").digest().subarray(0, KEY_LENGTH);
}

export function encryptSecret(plaintext: string, masterKey: string): string {
  const key = deriveKey(masterKey);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptSecret(encoded: string, masterKey: string): string {
  const parts = encoded.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("密文格式无法识别，可能来自不同版本或已损坏。");
  }

  const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  const key = deriveKey(masterKey);

  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** 安全解密：失败返回 null 而不是抛异常，用于"这个账号会话可能坏了"的场景。 */
export function tryDecryptSecret(
  encoded: string | null | undefined,
  masterKey: string,
): string | null {
  if (!encoded) return null;
  try {
    return decryptSecret(encoded, masterKey);
  } catch {
    return null;
  }
}

/**
 * 一次性配对码（spec §10.3）。
 * 只存哈希，比对时用 timingSafeEqual 防时序侧信道。
 */
export function generatePairingCode(): string {
  // 去掉容易混淆的字符，管理员要手抄。
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  return Array.from(bytes)
    .map((b) => alphabet[b % alphabet.length])
    .join("");
}

export function hashPairingCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

export function verifyPairingCode(code: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashPairingCode(code), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** 从主密钥派生统计用的哈希盐，避免额外再配一个环境变量。 */
export function deriveHashSalt(masterKey: string): string {
  return createHash("sha256")
    .update(`miaokit-catalog:analytics:${masterKey}`)
    .digest("hex");
}
