"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  Plug,
  RefreshCw,
  Settings,
  Tags,
  Rocket,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

/** 侧边栏导航（spec §17）。 */
const NAV_GROUPS = [
  {
    label: "概览",
    items: [{ href: "/admin", label: "仪表盘", icon: LayoutDashboard }],
  },
  {
    label: "商品",
    items: [
      { href: "/admin/products", label: "商品管理", icon: Package },
      { href: "/admin/categories", label: "分类", icon: Tags },
    ],
  },
  {
    label: "货源",
    items: [
      { href: "/admin/sources", label: "货源账号", icon: Plug },
      { href: "/admin/sync", label: "同步任务", icon: RefreshCw },
    ],
  },
  {
    label: "系统",
    items: [{ href: "/admin/settings", label: "设置", icon: Settings }],
  },
] as const;

export function AppSidebar() {
  const pathname = usePathname();

  /**
   * /admin 只在完全匹配时高亮，否则进任何子页面它都会亮着。
   * 其余项按前缀匹配，这样 /admin/products/123 也能高亮"商品管理"。
   */
  const isActive = (href: string) =>
    href === "/admin" ? pathname === href : pathname.startsWith(href);

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="px-3 py-4">
        <Link href="/admin" className="flex items-center gap-2.5 px-1">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Rocket className="size-4.5" />
          </span>
          <span className="grid group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-semibold leading-tight">
              MiaoKit Catalog
            </span>
            <span className="truncate text-xs text-muted-foreground">
              商品聚合管理
            </span>
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2">
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="text-[0.7rem] font-medium tracking-wide text-muted-foreground/70">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={isActive(item.href)}
                      tooltip={item.label}
                      className="gap-2.5 rounded-lg data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground"
                      render={<Link href={item.href} />}
                    >
                      <item.icon className="size-4" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="px-3 py-3">
        <p className="truncate text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          本站仅展示与跳转，不处理订单与付款
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
