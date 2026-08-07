/**
 * 创建初始管理员。
 *
 *   pnpm create-admin                        交互式输入
 *   pnpm create-admin admin@x.com 密码        直接传参
 *
 * 已存在同邮箱时更新密码，方便忘记密码时重置。
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function prompt(question: string, mask = false): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });

  if (!mask) {
    const answer = await rl.question(question);
    rl.close();
    return answer.trim();
  }

  // 密码输入时不回显，避免留在终端历史和肩窥。
  const originalWrite = stdout.write;
  const answerPromise = rl.question(question);

  stdout.write = ((chunk: unknown, ...args: unknown[]) => {
    // 只放行换行，其余字符吞掉，达到不回显的效果。
    if (typeof chunk === "string" && chunk.includes("\n")) {
      return Reflect.apply(originalWrite, stdout, [chunk, ...args]);
    }
    return true;
  }) as typeof stdout.write;

  const answer = await answerPromise;
  stdout.write = originalWrite;
  stdout.write("\n");
  rl.close();
  return answer.trim();
}

async function main() {
  const [argEmail, argPassword] = process.argv.slice(2);

  const email = (argEmail ?? (await prompt("管理员邮箱: "))).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("邮箱格式不正确");
  }

  const password = argPassword ?? (await prompt("密码（至少 8 位）: ", true));
  if (password.length < 8) {
    throw new Error("密码至少 8 位");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    await prisma.adminUser.update({
      where: { email },
      data: { passwordHash, isActive: true },
    });
    console.log(`✓ 已更新管理员密码：${email}`);
    return;
  }

  await prisma.adminUser.create({
    data: { email, passwordHash, name: email.split("@")[0] },
  });
  console.log(`✓ 已创建管理员：${email}`);
}

main()
  .catch((error) => {
    console.error(`✗ ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
