import "server-only";

import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

/**
 * 管理员认证。
 *
 * 用签名 JWT 存在 HttpOnly Cookie 里，而不是在数据库建 session 表：
 * 单管理员场景下没必要多一次查询，登出靠改 AUTH_SECRET 或等过期即可。
 *
 * Cookie 设置遵循 spec §20：HttpOnly + SameSite=Lax + 生产环境 Secure。
 * SameSite=Lax 本身就能挡住绝大多数 CSRF，无需额外 token。
 */

const SESSION_COOKIE = "catalog_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12; // 12 小时

export interface SessionPayload {
  userId: string;
  email: string;
}

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET 缺失或过短（至少 32 位）。请用 openssl rand -base64 32 生成。",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function hashPassword(plain: string): Promise<string> {
  // cost 12：登录不是高频操作，宁可慢一点也要抗住离线爆破。
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

export async function readSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.userId !== "string" || typeof payload.email !== "string") {
      return null;
    }
    return { userId: payload.userId, email: payload.email };
  } catch {
    // 签名不对或已过期，一律当作未登录。
    return null;
  }
}

/** 校验账号密码并写入会话 Cookie。 */
export async function login(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const user = await prisma.adminUser.findUnique({
    where: { email: email.toLowerCase().trim() },
  });

  // 账号不存在时也跑一次 hash 比对，避免通过响应时间探测账号是否存在。
  const hash = user?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin";
  const passwordOk = await verifyPassword(password, hash);

  if (!user || !user.isActive || !passwordOk) {
    return { ok: false, message: "邮箱或密码不正确" };
  }

  const token = await signSession({ userId: user.id, email: user.email });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  await prisma.adminUser.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return { ok: true };
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** 是否已经创建过管理员——没有的话引导去初始化。 */
export async function hasAnyAdmin(): Promise<boolean> {
  return (await prisma.adminUser.count()) > 0;
}
