import { NextResponse } from "next/server"
import { getRuntime } from "@/lib/runtime"
import { fail, ok, safeApiError } from "@/lib/core/api"

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(ok(getRuntime().getStatus()))
  } catch (err) {
    return NextResponse.json(fail(safeApiError(err)), { status: 500 })
  }
}
