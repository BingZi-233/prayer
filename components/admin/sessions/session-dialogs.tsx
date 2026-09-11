import type { Dispatch, SetStateAction } from "react"
import { TriangleAlert } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface SessionDialogsProps {
  resetKey: string | null
  setResetKey: (k: string | null) => void
  confirmStep: number
  setConfirmStep: Dispatch<SetStateAction<number>>
  keyLabel: (key: string) => string
  sessionsCount: number
  onResetOne: (key: string) => void
  onResetAll: () => void
}

export function SessionDialogs({
  resetKey,
  setResetKey,
  confirmStep,
  setConfirmStep,
  keyLabel,
  sessionsCount,
  onResetOne,
  onResetAll,
}: SessionDialogsProps) {
  const confirmSteps = [
    {
      title: `重开全部 ${sessionsCount} 个会话？`,
      desc: "每个会话的下一条消息将开启全新对话，历史记录仍可查看。",
      cta: "继续",
    },
    {
      title: "最后确认",
      desc: "此操作立即生效且不可撤销，机器人将丢失当前对话记忆。",
      cta: "执行全部重开",
    },
  ]
  return (
    <>
      <AlertDialog
        open={resetKey !== null}
        onOpenChange={(o) => !o && setResetKey(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5 text-destructive" />
              重开该会话？
            </AlertDialogTitle>
            <AlertDialogDescription>
              {resetKey ? keyLabel(resetKey) : ""}{" "}
              的下一条消息将开启全新对话，历史记录仍可查看。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive/10 text-destructive hover:bg-destructive/20"
              onClick={() => resetKey && void onResetOne(resetKey)}
            >
              重开
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmStep > 0}
        onOpenChange={(o) => !o && setConfirmStep(0)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5 text-destructive" />
              {confirmSteps[confirmStep - 1]?.title}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmSteps[confirmStep - 1]?.desc}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmStep(0)}>
              取消
            </AlertDialogCancel>
            {confirmStep < 2 ? (
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault()
                  e.preventBaseUIHandler()
                  setConfirmStep((s) => s + 1)
                }}
              >
                {confirmSteps[confirmStep - 1]?.cta}
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                className="bg-destructive/10 text-destructive hover:bg-destructive/20"
                onClick={() => void onResetAll()}
              >
                {confirmSteps[1].cta}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
