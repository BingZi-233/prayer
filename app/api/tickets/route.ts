import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sharedDb } from "@/lib/db/shared";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { ok, fail } from "@/lib/api";
import { bus } from "@/lib/bus";

function repo(): Repo {
  const cfg = getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")));
  return new Repo(sharedDb(cfg.dbPath));
}

// 工单专页:全量工单(含 closed)
export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(ok(repo().listTickets()));
  } catch (err) {
    return NextResponse.json(fail(err instanceof Error ? err.message : String(err)), { status: 500 });
  }
}

const patchSchema = z.object({
  id: z.number(),
  status: z.enum(["closed"]),
  /** 关闭时是否恢复该会话自动答;默认 true */
  resume: z.boolean().optional(),
});

// 关闭工单(+可选恢复自动答)
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json(fail("参数非法"), { status: 400 });
    const r = repo();
    const t = r.getTicket(parsed.data.id);
    if (!t) return NextResponse.json(fail("工单不存在"), { status: 404 });
    if (t.status === "closed") return NextResponse.json(ok(t));
    r.closeTicket(parsed.data.id);
    if (parsed.data.resume !== false) {
      bus.emit("handoff.resumed", { sessionKey: t.sessionKey, by: "ticket" });
    } else {
      // 只关单不恢复:仍清 human 外的 open tickets 已关;human_mode 保留
    }
    const next = r.getTicket(parsed.data.id);
    return NextResponse.json(ok(next));
  } catch (err) {
    return NextResponse.json(fail(err instanceof Error ? err.message : String(err)), { status: 500 });
  }
}
