export type TreeNode =
  | { kind: "dir"; name: string; path: string; children: TreeNode[] }
  | { kind: "file"; name: string; path: string }

export function buildTree(files: string[]): TreeNode[] {
  type MutableDir = {
    kind: "dir"
    name: string
    path: string
    kids: Map<string, MutableDir | { kind: "file"; name: string; path: string }>
  }
  const root: MutableDir = { kind: "dir", name: "", path: "", kids: new Map() }

  for (const f of files) {
    const parts = f.split("/")
    let cur = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      const isFile = i === parts.length - 1
      if (isFile) {
        cur.kids.set(part, { kind: "file", name: part, path: f })
      } else {
        const dirPath = parts.slice(0, i + 1).join("/")
        let next = cur.kids.get(part)
        if (!next || next.kind !== "dir") {
          next = { kind: "dir", name: part, path: dirPath, kids: new Map() }
          cur.kids.set(part, next)
        }
        cur = next as MutableDir
      }
    }
  }

  function freeze(d: MutableDir): TreeNode[] {
    const dirs: TreeNode[] = []
    const filesOut: TreeNode[] = []
    for (const [, node] of [...d.kids.entries()].sort(([a], [b]) =>
      a.localeCompare(b, "zh")
    )) {
      if (node.kind === "dir") {
        dirs.push({
          kind: "dir",
          name: node.name,
          path: node.path,
          children: freeze(node),
        })
      } else {
        filesOut.push(node)
      }
    }
    return [...dirs, ...filesOut]
  }
  return freeze(root)
}

export function encPath(f: string) {
  return f.split("/").map(encodeURIComponent).join("/")
}

export function countFiles(n: TreeNode): number {
  if (n.kind === "file") return 1
  return n.children.reduce((s, c) => s + countFiles(c), 0)
}
