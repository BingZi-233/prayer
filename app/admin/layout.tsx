import Link from "next/link";

const nav = [
  { href: "/admin", label: "状态" },
  { href: "/admin/config", label: "配置" },
  { href: "/admin/kb", label: "知识库" },
  { href: "/admin/sessions", label: "会话/日志" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh">
      <aside className="w-48 border-r p-4">
        <h2 className="mb-4 font-semibold">客服 Agent 管理</h2>
        <nav className="flex flex-col gap-1">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="rounded px-2 py-1 text-sm hover:bg-muted">
              {n.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
