"use client"

import { useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { cn } from "@/lib/utils"

export interface SearchSelectOption {
  value: string
  label: string
  /** 行尾补充说明(如群号) */
  hint?: string
  disabled?: boolean
}

/**
 * 可搜索单选下拉:选项多时必须用它,而不是 Select ——
 * Select 只能整段滚动,翻找几十个群很痛苦,且长列表会顶到屏幕边缘。
 */
export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = "选择…",
  searchPlaceholder = "搜索…",
  emptyText = "无匹配项",
  id,
  className,
}: {
  value: string
  onChange: (value: string) => void
  options: SearchSelectOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  id?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn("w-full justify-between font-normal", className)}
          />
        }
      >
        <span className={cn("truncate", !current && "text-muted-foreground")}>
          {current?.label ?? placeholder}
        </span>
        <ChevronsUpDown className="shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="min-w-[var(--anchor-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.value}`}
                  disabled={o.disabled}
                  onSelect={() => {
                    onChange(o.value)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      "size-3.5 shrink-0",
                      o.value === value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="truncate">{o.label}</span>
                  {o.hint && (
                    <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
                      {o.hint}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
