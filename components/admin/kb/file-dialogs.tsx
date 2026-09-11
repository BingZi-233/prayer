import { AlertTriangle, Plus, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import type { PendingNav } from "./types"

interface FileDialogsProps {
  createOpen: boolean
  setCreateOpen: (v: boolean) => void
  createPath: string
  setCreatePath: (v: string) => void
  renameOpen: boolean
  setRenameOpen: (v: boolean) => void
  renamePath: string
  setRenamePath: (v: string) => void
  deleteOpen: boolean
  setDeleteOpen: (v: boolean) => void
  busyFs: boolean
  pendingNav: PendingNav | null
  setPendingNav: (v: PendingNav | null) => void
  active: string | null
  onCreate: () => void
  onRename: () => void
  onDelete: () => void
  onConfirmDiscard: () => void
}

export function FileDialogs({
  createOpen,
  setCreateOpen,
  createPath,
  setCreatePath,
  renameOpen,
  setRenameOpen,
  renamePath,
  setRenamePath,
  deleteOpen,
  setDeleteOpen,
  busyFs,
  pendingNav,
  setPendingNav,
  active,
  onCreate,
  onRename,
  onDelete,
  onConfirmDiscard,
}: FileDialogsProps) {
  return (
    <>
      {/* 新建 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建文档</DialogTitle>
            <DialogDescription>
              相对知识库根目录的路径，仅支持 .md / .txt。可含子目录，如
              faq/new.md。
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="faq/example.md"
            value={createPath}
            onChange={(e) => setCreatePath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onCreate()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={onCreate} disabled={busyFs}>
              {busyFs ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Plus data-icon="inline-start" />
              )}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重命名 */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>重命名 / 移动</DialogTitle>
            <DialogDescription>
              若目标路径已存在将失败。会同步更新检索索引中的文档标识。
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renamePath}
            onChange={(e) => setRenamePath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onRename()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              取消
            </Button>
            <Button onClick={onRename} disabled={busyFs}>
              {busyFs ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Pencil data-icon="inline-start" />
              )}
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-destructive" />
              删除文档？
            </AlertDialogTitle>
            <AlertDialogDescription>
              将删除文件 <span className="font-mono">{active}</span>
              ，并清除对应检索分块。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive/10 text-destructive hover:bg-destructive/20"
              onClick={onDelete}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 未保存切换确认 */}
      <AlertDialog
        open={pendingNav != null}
        onOpenChange={(o) => !o && setPendingNav(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>丢弃未保存改动？</AlertDialogTitle>
            <AlertDialogDescription>
              当前文档有未保存内容。继续将丢失这些改动。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>留下</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive/10 text-destructive hover:bg-destructive/20"
              onClick={onConfirmDiscard}
            >
              丢弃并继续
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
