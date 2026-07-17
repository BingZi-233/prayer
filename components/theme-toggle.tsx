"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"

/**
 * 图标用 CSS `.dark` 切换，避免 resolvedTheme 在 SSR / 首屏 hydrate 不一致
 * （server 无 localStorage → Moon，client 已是 dark → Sun）触发 hydration mismatch。
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      title="切换主题(快捷键 d)"
    >
      <Sun className="hidden dark:block" />
      <Moon className="block dark:hidden" />
      <span className="sr-only">切换主题</span>
    </Button>
  )
}
