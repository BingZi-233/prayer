import { NextResponse } from "next/server";
import { readdirSync } from "node:fs";
import { sep } from "node:path";
import { ok } from "@/lib/api";

const KB_DIR = "docs/kb";

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
