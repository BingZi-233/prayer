import { AppSidebar } from "@/components/app-sidebar"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { LiveProvider } from "@/components/live-provider"
import { HeaderStatus } from "@/components/header-status"

// 壳层:inset 侧栏 + 白底无缝内容区。
// 不要给 SidebarProvider 加 bg-muted、不要给 SidebarInset 加 ring/shadow、
// 不要给内容加 max-w —— 三者都会让内容变成"浮起的卡片",与参考的平铺感不同。
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <LiveProvider>
      <SidebarProvider className="h-svh overflow-hidden">
        <AppSidebar />
        <SidebarInset className="min-h-0 overflow-hidden">
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <SidebarTrigger className="-ml-1 shrink-0" />
            <Separator
              orientation="vertical"
              className="mr-2 h-4 data-vertical:self-center"
            />
            <HeaderStatus />
          </header>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 md:p-6">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </LiveProvider>
  )
}
