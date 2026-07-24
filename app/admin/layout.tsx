import { AppSidebar } from "@/components/app-sidebar"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { LiveProvider } from "@/components/live-provider"
import { HeaderStatus } from "@/components/header-status"

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
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-4">
            <SidebarTrigger className="-ml-1 shrink-0" />
            <Separator
              orientation="vertical"
              className="mr-2 h-4 data-vertical:self-center"
            />
            <span className="min-w-0 truncate text-sm font-medium">
              客服 Agent
            </span>
            <HeaderStatus />
          </header>
          <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3 sm:p-4 md:p-6">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {children}
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </LiveProvider>
  )
}
