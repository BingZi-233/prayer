import { RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { channelLabel } from "@/lib/core/chat/channel-labels"
import { formatDuration } from "@/lib/core/format-duration"
import { rowLabel } from "./policy-payload"
import type { Row, Globals, Tri } from "./types"
import type { useGroupPolicyForm } from "./use-group-policy-form"

interface PolicySheetProps {
  form: ReturnType<typeof useGroupPolicyForm>
  globals?: Globals
  name: (id: number) => string
  savingPolicy: boolean
  onSave: () => void
  onClear: (row: Row) => void
}

export function PolicySheet({
  form,
  globals,
  name,
  savingPolicy,
  onSave,
  onClear,
}: PolicySheetProps) {
  const {
    editing,
    proactiveTri,
    setProactiveTri,
    silenceMode,
    setSilenceMode,
    silenceMin,
    setSilenceMin,
    handoffTri,
    setHandoffTri,
    closeEditor,
  } = form
  return (
    <Sheet open={editing !== null} onOpenChange={(o) => !o && closeEditor()}>
      <SheetContent className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            会话策略 ·{" "}
            {editing
              ? `${channelLabel(editing.channel)} · ${rowLabel(editing, name)}`
              : ""}
          </SheetTitle>
          <SheetDescription>
            未覆盖的项跟随全局配置。
            {editing && (
              <>
                {" "}
                <span className="font-mono text-xs">{editing.policyKey}</span>
              </>
            )}
            {globals && (
              <>
                {" "}
                当前全局:主动 {globals.proactiveEnabled ? "开" : "关"} · 静默{" "}
                {formatDuration(globals.proactiveSilenceMs)} · 转人工通知开。
              </>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-2">
          <FieldGroup>
            <Field>
              <FieldLabel>主动补位</FieldLabel>
              <Select
                items={{
                  inherit: "跟随全局",
                  on: "强制开启",
                  off: "强制关闭",
                }}
                value={proactiveTri}
                onValueChange={(v) => {
                  if (v !== null) setProactiveTri(v as Tri)
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">跟随全局</SelectItem>
                  <SelectItem value="on">强制开启</SelectItem>
                  <SelectItem value="off">强制关闭</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>
                核心群可强制开,闲聊群可强制关。
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel>静默阈值</FieldLabel>
              <Select
                items={{
                  inherit: "跟随全局",
                  custom: "自定义(分钟)",
                }}
                value={silenceMode}
                onValueChange={(v) => {
                  if (v !== null) setSilenceMode(v as "inherit" | "custom")
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">
                    跟随全局
                    {globals
                      ? ` (${formatDuration(globals.proactiveSilenceMs)})`
                      : ""}
                  </SelectItem>
                  <SelectItem value="custom">自定义(分钟)</SelectItem>
                </SelectContent>
              </Select>
              {silenceMode === "custom" && (
                <Input
                  className="mt-2"
                  inputMode="numeric"
                  value={silenceMin}
                  onChange={(e) => setSilenceMin(e.target.value)}
                  placeholder="分钟"
                />
              )}
              <FieldDescription>
                无人应答超过此时长才主动补位。
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel>转人工时通知管理面</FieldLabel>
              <Select
                items={{
                  inherit: "跟随默认(通知)",
                  on: "通知",
                  off: "不通知",
                }}
                value={handoffTri}
                onValueChange={(v) => {
                  if (v !== null) setHandoffTri(v as Tri)
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">跟随默认(通知)</SelectItem>
                  <SelectItem value="on">通知</SelectItem>
                  <SelectItem value="off">不通知</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>
                仅控制转人工时是否向管理面发消息;会话仍会进入人工接待。
              </FieldDescription>
            </Field>
          </FieldGroup>
        </div>

        <SheetFooter className="flex-row gap-2 border-t">
          {editing?.hasOverride && (
            <Button
              variant="outline"
              disabled={savingPolicy}
              onClick={() => editing && onClear(editing)}
            >
              <RotateCcw data-icon="inline-start" />
              全部跟随全局
            </Button>
          )}
          <Button onClick={onSave} disabled={savingPolicy}>
            {savingPolicy ? <Spinner data-icon="inline-start" /> : null}
            {savingPolicy ? "保存中…" : "保存策略"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
