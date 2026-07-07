#!/usr/bin/env node
/**
 * PackyAPI MCP server —— 单工具 `packy`,走公开 JSON API 本地计价/过滤,输出极简结构化文本。
 * stdio transport。TypeScript 由 Node(v22.6+/24)原生 strip 运行。
 * SDK(@modelcontextprotocol/sdk)从 repo 根 node_modules 解析(本 plugin 在 prayer repo 内)。
 *
 * 工具 packy(action + 可选参数):
 *   action=price  [keyword] [group] [base]   计价 $/1M tokens
 *   action=models [endpoint] [group]         列可用模型 ID
 *   action=groups                            分组倍率与说明
 *   action=raw    model                       单模型原始 JSON
 *
 * 计价公式(new-api,quota_type=0 按量):
 *   input  $/1M = model_ratio * group_ratio * base   (base 默认 2,即 $0.002/1K)
 *   output $/1M = input * completion_ratio
 *   cache  $/1M = input * cache_ratio
 * quota_type=1(按次):  price/次 = model_price * group_ratio
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

export const API = "https://www.packyapi.com/api/pricing";

export interface Model {
  model_name: string;
  quota_type: number;
  model_ratio: number;
  completion_ratio: number;
  cache_ratio: number;
  model_price: number;
  enable_groups: string[];
  supported_endpoint_types: string[];
}

export interface Pricing {
  data: Model[];
  group_ratio: Record<string, number>;
  usable_group: Record<string, string>;
}

async function fetchPricing(): Promise<Pricing> {
  const res = await fetch(API, { headers: { "User-Agent": "packy-mcp" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Pricing;
}

function grValue(d: Pricing, group: string): number {
  return d.group_ratio?.[group] ?? 1;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function padStart(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

// —— 纯格式化函数:输入 Pricing + 参数,返回结构化文本(便于单测,不触网) ——

export function formatPrice(
  d: Pricing,
  opts: { keyword?: string; group?: string; base?: number } = {}
): string {
  const groupArg = opts.group;
  const base = opts.base ?? 2;
  const kw = (opts.keyword ?? "").toLowerCase();
  // 行:[model, group, in, out, cache, endpoints]
  const rows: string[][] = [];
  for (const m of d.data) {
    if (kw && !m.model_name.toLowerCase().includes(kw)) continue;
    let groups: string[];
    if (groupArg) {
      if (!m.enable_groups?.includes(groupArg)) continue;
      groups = [groupArg];
    } else if (kw) {
      groups = m.enable_groups ?? [];
    } else {
      groups = m.enable_groups?.includes("cc") ? ["cc"] : [];
    }
    const ep = (m.supported_endpoint_types ?? []).join(",");
    for (const g of groups) {
      const gr = grValue(d, g);
      if (m.quota_type === 1) {
        rows.push([m.model_name, g, `$${(m.model_price * gr).toFixed(4)}/次`, "-", "-", ep]);
      } else {
        const inp = m.model_ratio * gr * base;
        rows.push([
          m.model_name,
          g,
          `$${inp.toFixed(2)}`,
          `$${(inp * m.completion_ratio).toFixed(2)}`,
          `$${(inp * m.cache_ratio).toFixed(2)}`,
          ep,
        ]);
      }
    }
  }
  if (rows.length === 0) {
    return `无匹配(group=${groupArg ?? "自动"}, 关键词=${kw || "无"})`;
  }
  const scope = groupArg ? `组 ${groupArg}(倍率 ${grValue(d, groupArg)})` : kw ? "各分组" : "组 cc";
  const out: string[] = [`# ${scope}, base ${base} — 单位 $/1M tokens`];
  out.push(
    `${pad("model", 32)} ${pad("group", 18)} ${padStart("in", 8)} ${padStart("out", 9)} ${padStart("cache", 8)}  endpoints`
  );
  const sorted = rows.sort((a, b) => a[0].localeCompare(b[0]) || grValue(d, a[1]) - grValue(d, b[1]));
  for (const r of sorted) {
    out.push(
      `${pad(r[0], 32)} ${pad(r[1], 18)} ${padStart(r[2], 8)} ${padStart(r[3], 9)} ${padStart(r[4], 8)}  ${r[5]}`
    );
  }
  return out.join("\n");
}

export function formatModels(d: Pricing, opts: { group?: string; endpoint?: string } = {}): string {
  const group = opts.group ?? "cc";
  const endpoint = opts.endpoint;
  const names: string[] = [];
  for (const m of d.data) {
    if (!m.enable_groups?.includes(group)) continue;
    if (endpoint && !m.supported_endpoint_types?.includes(endpoint)) continue;
    names.push(m.model_name);
  }
  const out: string[] = [
    `# group=${group}${endpoint ? ` endpoint=${endpoint}` : ""} — ${names.length} 个模型`,
  ];
  for (const n of names.sort((a, b) => a.localeCompare(b))) out.push(n);
  return out.join("\n");
}

export function formatGroups(d: Pricing): string {
  const gr = d.group_ratio ?? {};
  const desc = d.usable_group ?? {};
  const out: string[] = ["# 分组倍率(group_ratio)与说明"];
  for (const g of Object.keys(gr).sort((a, b) => gr[a] - gr[b])) {
    out.push(`${pad(g, 22)} x${pad(String(gr[g]), 5)} ${(desc[g] ?? "").trim()}`);
  }
  return out.join("\n");
}

export function formatRaw(d: Pricing, model?: string): string {
  if (!model) return "raw 需 model 参数";
  const m = d.data.find((x) => x.model_name === model);
  if (!m) return `未找到模型: ${model}`;
  return JSON.stringify(m, null, 2);
}

// —— MCP server ——

const server = new McpServer({ name: "packyapi", version: "0.2.0" });

server.registerTool(
  "packy",
  {
    title: "PackyAPI 查询",
    description:
      "查 PackyAPI(Claude/OpenAI/Gemini 中转平台)模型价格、可用模型 ID、分组倍率、单模型原始数据。走公开 JSON API,省 token、精确。",
    inputSchema: {
      action: z
        .enum(["price", "models", "groups", "raw"])
        .describe("price=计价 / models=列模型ID / groups=分组倍率 / raw=单模型原始JSON"),
      keyword: z.string().optional().describe("price:模型名关键词过滤(给了则列该模型所有可用分组)"),
      group: z.string().optional().describe("price/models:锁定单个分组(如 cc、cc-sale)"),
      endpoint: z.string().optional().describe("models:按端点过滤(anthropic/openai/gemini)"),
      base: z.number().optional().describe("price:计价 base,默认 2($0.002/1K)"),
      model: z.string().optional().describe("raw:模型 ID(必填)"),
    },
  },
  async ({ action, keyword, group, endpoint, base, model }) => {
    let d: Pricing;
    try {
      d = await fetchPricing();
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: `取 API 失败: ${(e as Error).message}` }] };
    }
    let text: string;
    switch (action) {
      case "price":
        text = formatPrice(d, { keyword, group, base });
        break;
      case "models":
        text = formatModels(d, { group, endpoint });
        break;
      case "groups":
        text = formatGroups(d);
        break;
      case "raw":
        if (!model) {
          return { isError: true, content: [{ type: "text", text: "raw 需 model 参数" }] };
        }
        text = formatRaw(d, model);
        break;
    }
    return { content: [{ type: "text", text }] };
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// 直接运行时启动 stdio server;被 import(测试)时不启动。
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
