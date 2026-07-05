"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Settings, BookOpen, MessagesSquare, ScrollText, Bot, Brain, Ticket, Users } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useLive } from "@/components/live-provider";

const nav = [
  { href: "/admin", label: "运行状态", icon: Activity },
  { href: "/admin/config", label: "配置", icon: Settings },
  { href: "/admin/kb", label: "知识库", icon: BookOpen },
  { href: "/admin/sessions", label: "会话", icon: MessagesSquare, badge: "human" as const },
  { href: "/admin/reflection", label: "反思", icon: Brain },
  { href: "/admin/tickets", label: "工单", icon: Ticket, badge: "tickets" as const },
  { href: "/admin/groups", label: "生效群", icon: Users },
  { href: "/admin/logs", label: "运行日志", icon: ScrollText },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { overview } = useLive();
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
                    {n.badge === "tickets" && (overview?.openTickets ?? 0) > 0 && (
                      <SidebarMenuBadge>{overview!.openTickets}</SidebarMenuBadge>
                    )}
                    {n.badge === "human" && (overview?.humanSessions ?? 0) > 0 && (
                      <SidebarMenuBadge className="text-destructive">{overview!.humanSessions}</SidebarMenuBadge>
                    )}
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
