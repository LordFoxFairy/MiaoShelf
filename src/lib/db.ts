import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

/**
 * 单例 PrismaClient。
 *
 * Next.js dev 模式下模块会热重载，每次都 new 一个 client 会很快耗尽
 * Postgres 连接数，所以挂到 globalThis 上复用。
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
