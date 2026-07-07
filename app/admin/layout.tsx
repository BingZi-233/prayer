import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { LiveProvider } from "@/components/live-provider";
import { HeaderStatus } from "@/components/header-status";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <LiveProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4 data-vertical:self-center" />
            <span className="text-sm font-medium">OneBot 客服 Agent</span>
            <HeaderStatus />
          </header>
          <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </LiveProvider>
  );
}
