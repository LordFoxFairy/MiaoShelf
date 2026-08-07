"use server";

import { redirect } from "next/navigation";
import { login, logout } from "@/lib/auth";
import { adminLoginSchema } from "@/lib/schemas";

export interface LoginState {
  error?: string;
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = adminLoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "请输入有效的邮箱和密码（密码至少 8 位）" };
  }

  const result = await login(parsed.data.email, parsed.data.password);
  if (!result.ok) return { error: result.message };

  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect("/login");
}
