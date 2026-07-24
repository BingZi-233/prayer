import { NextResponse } from "next/server"
import { getRuntime } from "@/lib/runtime"
import { ok } from "@/lib/api"

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(ok(getRuntime().getStatus()))
}
