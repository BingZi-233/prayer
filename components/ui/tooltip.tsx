"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import { cn } from "@/lib/utils"

function TooltipProvider({
  delayDuration = 0,
  ...props
}: Omit<React.ComponentProps<typeof TooltipPrimitive.Provider>, "delay"> & {
  delayDuration?: number
}) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: Omit<React.ComponentProps<typeof TooltipPrimitive.Root>, "children"> & {
  children?: React.ReactNode
}) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 0,
  align,
  alignOffset,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Popup> &
  Pick<
    React.ComponentProps<typeof TooltipPrimitive.Positioner>,
    "side" | "sideOffset" | "align" | "alignOffset"
  >) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 inline-flex w-fit max-w-xs items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background has-data-[slot=kbd]:pr-1.5 data-ending-style:animate-out data-ending-style:fade-out-0 data-ending-style:zoom-out-95 data-starting-style:animate-in data-starting-style:fade-in-0 data-starting-style:zoom-in-95 data-[side=bottom]:data-starting-style:slide-in-from-top-2 data-[side=left]:data-starting-style:slide-in-from-right-2 data-[side=right]:data-starting-style:slide-in-from-left-2 data-[side=top]:data-starting-style:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm",
            className
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="z-50 size-2.5 rotate-45 rounded-[2px] bg-foreground data-[side=bottom]:-translate-y-1/2 data-[side=left]:translate-x-1/2 data-[side=right]:-translate-x-1/2 data-[side=top]:translate-y-1/2" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
