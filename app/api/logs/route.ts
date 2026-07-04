import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { ok } from "@/lib/api";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(ok(logger.tail()));
}
