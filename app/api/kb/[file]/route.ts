import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { z } from "zod";
import { ok, fail } from "@/lib/api";

const KB_DIR = "docs/kb";

function safePath(file: string): string | null {
  const name = basename(file); // 去掉路径分隔,防穿越
  if (!name.endsWith(".md") && !name.endsWith(".txt")) return null;
  return join(KB_DIR, name);
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ file: string }> }): Promise<NextResponse> {
  const { file } = await ctx.params;
  const p = safePath(file);
  if (!p || !existsSync(p)) return NextResponse.json(fail("文件不存在"), { status: 404 });
  return NextResponse.json(ok(readFileSync(p, "utf8")));
}

const bodySchema = z.object({ content: z.string() });

export async function PUT(req: NextRequest, ctx: { params: Promise<{ file: string }> }): Promise<NextResponse> {
  const { file } = await ctx.params;
  const p = safePath(file);
  if (!p) return NextResponse.json(fail("文件名非法"), { status: 400 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json(fail("参数非法"), { status: 400 });
  writeFileSync(p, parsed.data.content, "utf8");
  return NextResponse.json(ok(true));
}
