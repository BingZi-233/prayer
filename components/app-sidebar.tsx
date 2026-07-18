"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Settings,
  BookOpen,
  MessagesSquare,
  ScrollText,
  Bot,
  Brain,
  Users,
  Zap,
  Boxes,
  Puzzle,
  LifeBuoy,
  TrendingUp,
} from "lucide-react";
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

const navGroups = [
  {
    label: "监控",
    items: [
      { href: "/admin", label: "运行状态", icon: Activity },
      { href: "/admin/logs", label: "运行日志", icon: ScrollText },
    ],
  },
  {
    label: "客服运营",
    items: [
      { href: "/admin/sessions", label: "会话", icon: MessagesSquare },
      { href: "/admin/handoff", label: "人工队列", icon: LifeBuoy, badge: "human" as const },
      { href: "/admin/proactive", label: "主动回复", icon: Zap },
    ],
  },
  {
    label: "知识",
    items: [
      { href: "/admin/kb", label: "知识库", icon: BookOpen },
      { href: "/admin/reflection", label: "反思", icon: Brain },
      { href: "/admin/ranking", label: "问题排行", icon: TrendingUp },
    ],
  },
  {
    label: "系统",
    items: [
      { href: "/admin/config", label: "配置", icon: Settings },
      { href: "/admin/groups", label: "生效会话", icon: Users },
      { href: "/admin/capabilities", label: "能力", icon: Boxes },
      { href: "/admin/plugins", label: "插件", icon: Puzzle },
    ],
  },
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
        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((n) => {
                  const active = n.href === "/admin" ? pathname === n.href : pathname.startsWith(n.href);
                  const badge = "badge" in n ? n.badge : undefined;
                  return (
                    <SidebarMenuItem key={n.href}>
                      <SidebarMenuButton asChild isActive={active} tooltip={n.label}>
                        <Link href={n.href}>
                          <n.icon />
                          <span>{n.label}</span>
                        </Link>
                      </SidebarMenuButton>
                      {badge === "human" && (overview?.humanSessions ?? 0) > 0 && (
                        <SidebarMenuBadge className="text-destructive">{overview!.humanSessions}</SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
