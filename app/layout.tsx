import { Geist_Mono, Inter } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { Metadata } from "next"
import { DEFAULT_BRAND } from "@/lib/core/brand"

export const metadata: Metadata = {
  title: {
    default: `${DEFAULT_BRAND.name} · 客服中台`,
    template: `%s · ${DEFAULT_BRAND.name}`,
  },
  description: DEFAULT_BRAND.description,
}

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
})

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable}`}
      style={{ backgroundColor: "var(--background)" }}
    >
      <body className="min-h-svh bg-background text-foreground antialiased">
        <ThemeProvider>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
