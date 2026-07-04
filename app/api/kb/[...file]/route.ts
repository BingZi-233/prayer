import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { z } from "zod";
import { ok, fail } from "@/lib/api";

const KB_DIR = "docs/kb";
const KB_ROOT = resolve(KB_DIR);

// catch-all 段:file 为路径片段数组(如 ["faq","退款.md"]),支持子目录
function safePath(parts: string[]): string | null {
  const rel = parts.join("/");
  if (!rel.endsWith(".md") && !rel.endsWith(".txt")) return null;
  const p = resolve(KB_DIR, rel);
  // 防目录穿越:解析后必须仍在 KB_ROOT 内
  if (p !== KB_ROOT && !p.startsWith(KB_ROOT + sep)) return null;
  return p;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ file: string[] }> }): Promise<NextResponse> {
  const { file } = await ctx.params;
  const p = safePath(file);
  if (!p || !existsSync(p)) return NextResponse.json(fail("文件不存在"), { status: 404 });
  return NextResponse.json(ok(readFileSync(p, "utf8")));
}

const bodySchema = z.object({ content: z.string() });

export async function PUT(req: NextRequest, ctx: { params: Promise<{ file: string[] }> }): Promise<NextResponse> {
  const { file } = await ctx.params;
  const p = safePath(file);
  if (!p) return NextResponse.json(fail("文件名非法"), { status: 400 });
  if (!existsSync(p)) return NextResponse.json(fail("文件不存在"), { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json(fail("参数非法"), { status: 400 });
  writeFileSync(p, parsed.data.content, "utf8");
  return NextResponse.json(ok(true));
}
