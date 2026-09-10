"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
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
} from "lucide-react"
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
} from "@/components/ui/sidebar"
import { NavLinkIcon } from "@/components/nav-link-icon"
import { useLive } from "@/components/live-provider"
import { DEFAULT_BRAND } from "@/lib/core/brand"

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
      {
        href: "/admin/handoff",
        label: "人工队列",
        icon: LifeBuoy,
        badge: "human" as const,
      },
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
]

export function AppSidebar() {
  const pathname = usePathname()
  const { overview } = useLive()
  const brandName = overview?.brandName?.trim() || DEFAULT_BRAND.name
  return (
    <Sidebar variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/admin" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <Bot className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{brandName}</span>
                <span className="truncate text-xs">客服中台</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((n) => {
                  const active =
                    n.href === "/admin"
                      ? pathname === n.href
                      : pathname.startsWith(n.href)
                  const badge = "badge" in n ? n.badge : undefined
                  return (
                    <SidebarMenuItem key={n.href}>
                      <SidebarMenuButton
                        render={<Link href={n.href} />}
                        isActive={active}
                        tooltip={n.label}
                      >
                        <NavLinkIcon icon={n.icon} />
                        <span>{n.label}</span>
                      </SidebarMenuButton>
                      {badge === "human" &&
                        (overview?.humanSessions ?? 0) > 0 && (
                          <SidebarMenuBadge className="text-destructive">
                            {overview!.humanSessions}
                          </SidebarMenuBadge>
                        )}
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  )
}
