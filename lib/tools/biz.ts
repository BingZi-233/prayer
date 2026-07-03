import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// stub:接真实业务系统时替换 handler 内部实现
export function makeOrderTool() {
  return tool(
    "lookup_order",
    "按订单号查询订单状态。",
    { orderId: z.string().describe("订单号") },
    async ({ orderId }) => {
      // TODO 接真实订单 API;当前返回占位
      return { content: [{ type: "text", text: `订单 ${orderId}: 状态=已发货(示例数据)` }] };
    }
  );
}
