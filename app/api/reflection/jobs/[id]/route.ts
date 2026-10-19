import { NextResponse } from "next/server"
import { getAppContext } from "@/lib/core/app-context"
import { getAdminJob } from "@/lib/core/admin-jobs"
import { fail, ok, safeApiError } from "@/lib/core/api"

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { repo } = getAppContext()
    const { id } = await context.params
    const job = getAdminJob(repo, id)
    return job
      ? NextResponse.json(ok(job))
      : NextResponse.json(
          fail(
            "任务记录不存在或已过期，执行结果无法确认，请核对反思条目与审计记录，勿重复提交"
          ),
          { status: 404 }
        )
  } catch (err) {
    return NextResponse.json(fail(safeApiError(err)), { status: 500 })
  }
}
