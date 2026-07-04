"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Settings, BookOpen, MessagesSquare, Bot } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const nav = [
  { href: "/admin", label: "运行状态", icon: Activity },
  { href: "/admin/config", label: "配置", icon: Settings },
  { href: "/admin/kb", label: "知识库", icon: BookOpen },
  { href: "/admin/sessions", label: "会话 / 日志", icon: MessagesSquare },
];

export function AppSidebar() {
  const pathname = usePathname();
  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-md">
            <Bot className="size-5" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">客服 Agent</span>
            <span className="text-muted-foreground text-xs">管理后台</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>导航</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((n) => {
                const active = n.href === "/admin" ? pathname === n.href : pathname.startsWith(n.href);
                return (
                  <SidebarMenuItem key={n.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={n.label}>
                      <Link href={n.href}>
                        <n.icon />
                        <span>{n.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
