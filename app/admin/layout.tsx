import { AppSidebar } from "@/components/app-sidebar"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { LiveProvider } from "@/components/live-provider"
import { HeaderStatus } from "@/components/header-status"
import { BrandTitle } from "@/components/admin/brand-title"

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <LiveProvider>
      <SidebarProvider className="h-svh overflow-hidden bg-muted/40">
        <AppSidebar />
        <SidebarInset className="min-h-0 overflow-hidden bg-muted/20 bg-background md:m-2 md:ml-0 md:rounded-xl md:shadow-sm md:ring-1 md:ring-border/70">
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-5 md:px-7">
            <SidebarTrigger className="-ml-1 shrink-0" />
            <Separator
              orientation="vertical"
              className="mr-2 h-4 data-vertical:self-center"
            />
            <BrandTitle />
            <HeaderStatus />
          </header>
          <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3 py-4 sm:px-4 sm:py-5 md:p-6 md:px-6 md:py-6">
            <div className="mx-auto flex min-h-0 min-w-0 w-full max-w-[1440px] flex-1 flex-col">
              {children}
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </LiveProvider>
  )
}
