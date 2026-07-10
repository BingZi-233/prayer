import { NextRequest, NextResponse } from "next/server";
import { readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, sep } from "node:path";
import { z } from "zod";
import { ok, fail } from "@/lib/api";
import { KB_DIR, isKbRelPath, safeKbAbs } from "@/lib/kb-path";

export async function GET(): Promise<NextResponse> {
  let files: string[] = [];
  try {
    files = readdirSync(KB_DIR, { recursive: true })
      .map((f) => String(f).split(sep).join("/"))
      .filter((f) => f.endsWith(".md") || f.endsWith(".txt"))
      .sort();
  } catch {
    files = [];
  }
  return NextResponse.json(ok(files));
}

const createSchema = z.object({
  path: z.string().min(1),
  content: z.string().optional(),
});

// 新建文档:自动建父目录;已存在则 409
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json(fail("参数非法"), { status: 400 });
    const rel = parsed.data.path.replace(/^\/+/, "").split(sep).join("/");
    if (!isKbRelPath(rel)) return NextResponse.json(fail("路径非法(仅 .md/.txt,禁止穿越)"), { status: 400 });
    const abs = safeKbAbs(rel);
    if (!abs) return NextResponse.json(fail("路径非法"), { status: 400 });
    if (existsSync(abs)) return NextResponse.json(fail("文件已存在"), { status: 409 });
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, parsed.data.content ?? "", "utf8");
    return NextResponse.json(ok({ path: rel }));
  } catch (err) {
    return NextResponse.json(fail(err instanceof Error ? err.message : String(err)), { status: 500 });
  }
}
