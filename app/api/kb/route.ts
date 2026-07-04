import { NextResponse } from "next/server";
import { readdirSync } from "node:fs";
import { ok } from "@/lib/api";

const KB_DIR = "docs/kb";

export async function GET(): Promise<NextResponse> {
  let files: string[] = [];
  try {
    files = readdirSync(KB_DIR).filter((f) => f.endsWith(".md") || f.endsWith(".txt"));
  } catch {
    files = [];
  }
  return NextResponse.json(ok(files));
}
