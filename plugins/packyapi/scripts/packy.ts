#!/usr/bin/env node
/**
 * PackyAPI 查询工具 —— 直接读公开 JSON API,本地过滤/计价,输出极简结构化文本。
 * 零依赖:用 Node 全局 fetch,TypeScript 由 Node(v22.6+/24)原生 strip 运行。
 *
 * 用法:
 *   node packy.ts price  [关键词] [--group cc] [--base 2]
 *   node packy.ts models [--endpoint anthropic] [--group cc]
 *   node packy.ts groups
 *   node packy.ts raw    <model>
 *
 * 计价公式(new-api,quota_type=0 按量):
 *   input  $/1M = model_ratio * group_ratio * base   (base 默认 2,即 $0.002/1K)
 *   output $/1M = input * completion_ratio
 *   cache  $/1M = input * cache_ratio
 * quota_type=1(按次):  price/次 = model_price * group_ratio
 */

const API = "https://www.packyapi.com/api/pricing";

interface Model {
  model_name: string;
  quota_type: number;
  model_ratio: number;
  completion_ratio: number;
  cache_ratio: number;
  model_price: number;
  enable_groups: string[];
  supported_endpoint_types: string[];
}

interface Pricing {
  data: Model[];
  group_ratio: Record<string, number>;
  usable_group: Record<string, string>;
}

const HELP = `用法:
  node packy.ts price  [关键词] [--group cc] [--base 2]
  node packy.ts models [--endpoint anthropic] [--group cc]
  node packy.ts groups
  node packy.ts raw    <model>`;

async function fetchPricing(): Promise<Pricing> {
  const res = await fetch(API, { headers: { "User-Agent": "packy-cli" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Pricing;
}

function opt(args: string[], name: string, def?: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
}

function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      i++; // 跳过该选项的值
      continue;
    }
    out.push(args[i]);
  }
  return out;
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

function cmdPrice(d: Pricing, args: string[]): void {
  // --group 显式指定 → 仅该组;未指定时查具体模型(有关键词)→ 列出模型所在全部分组,
  // 无关键词(列全表)→ 默认 cc,避免逐组笛卡尔积爆表。
  const groupArg = opt(args, "--group");
  const base = Number(opt(args, "--base", "2"));
  const kw = (positional(args)[0] ?? "").toLowerCase();
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
    console.log(`无匹配(group=${groupArg ?? "自动"}, 关键词=${kw || "无"})`);
    return;
  }
  const scope = groupArg ? `组 ${groupArg}(倍率 ${grValue(d, groupArg)})` : kw ? "各分组" : "组 cc";
  console.log(`# ${scope}, base ${base} — 单位 $/1M tokens`);
  console.log(
    `${pad("model", 32)} ${pad("group", 18)} ${padStart("in", 8)} ${padStart("out", 9)} ${padStart("cache", 8)}  endpoints`
  );
  const sorted = rows.sort((a, b) => a[0].localeCompare(b[0]) || grValue(d, a[1]) - grValue(d, b[1]));
  for (const r of sorted) {
    console.log(
      `${pad(r[0], 32)} ${pad(r[1], 18)} ${padStart(r[2], 8)} ${padStart(r[3], 9)} ${padStart(r[4], 8)}  ${r[5]}`
    );
  }
}

function cmdModels(d: Pricing, args: string[]): void {
  const group = opt(args, "--group", "cc")!;
  const endpoint = opt(args, "--endpoint");
  const names: string[] = [];
  for (const m of d.data) {
    if (!m.enable_groups?.includes(group)) continue;
    if (endpoint && !m.supported_endpoint_types?.includes(endpoint)) continue;
    names.push(m.model_name);
  }
  console.log(`# group=${group}${endpoint ? ` endpoint=${endpoint}` : ""} — ${names.length} 个模型`);
  for (const n of names.sort((a, b) => a.localeCompare(b))) console.log(n);
}

function cmdGroups(d: Pricing): void {
  const gr = d.group_ratio ?? {};
  const desc = d.usable_group ?? {};
  console.log("# 分组倍率(group_ratio)与说明");
  for (const g of Object.keys(gr).sort((a, b) => gr[a] - gr[b])) {
    console.log(`${pad(g, 22)} x${pad(String(gr[g]), 5)} ${(desc[g] ?? "").trim()}`);
  }
}

function cmdRaw(d: Pricing, args: string[]): void {
  const name = positional(args)[0];
  if (!name) return console.log("用法: node packy.ts raw <model>");
  const m = d.data.find((x) => x.model_name === name);
  if (!m) return console.log(`未找到模型: ${name}`);
  console.log(JSON.stringify(m, null, 2));
}

async function main(): Promise<void> {
  const [sub, ...args] = process.argv.slice(2);
  if (!sub) return console.log(HELP);
  let d: Pricing;
  try {
    d = await fetchPricing();
  } catch (e) {
    console.error(`取 API 失败: ${(e as Error).message}`);
    process.exit(1);
  }
  switch (sub) {
    case "price":
      return cmdPrice(d, args);
    case "models":
      return cmdModels(d, args);
    case "groups":
      return cmdGroups(d);
    case "raw":
      return cmdRaw(d, args);
    default:
      console.log(HELP);
      process.exit(1);
  }
}

main();
