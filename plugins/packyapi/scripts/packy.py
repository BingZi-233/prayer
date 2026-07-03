#!/usr/bin/env python3
"""PackyAPI 查询工具 —— 直接读公开 JSON API,本地过滤/计价,输出极简结构化文本。

用法:
  packy.py price  [关键词] [--group cc] [--base 2]   # 计价(默认 cc 组)
  packy.py models [--endpoint anthropic] [--group cc] # 列可用模型 ID
  packy.py groups                                      # 列分组倍率+说明
  packy.py raw    <model>                              # 某模型原始字段

计价公式(new-api,quota_type=0 按量):
  input  $/1M = model_ratio * group_ratio * base   (base 默认 2,即 $0.002/1K)
  output $/1M = input * completion_ratio
  cache  $/1M = input * cache_ratio
quota_type=1(按次):  price/次 = model_price * group_ratio
"""
import sys
import json
import urllib.request

API = "https://www.packyapi.com/api/pricing"


def fetch():
    req = urllib.request.Request(API, headers={"User-Agent": "packy-cli"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def opt(args, name, default=None):
    if name in args:
        i = args.index(name)
        return args[i + 1] if i + 1 < len(args) else default
    return default


def positional(args):
    out, skip = [], False
    for i, a in enumerate(args):
        if skip:
            skip = False
            continue
        if a.startswith("--"):
            skip = True
            continue
        out.append(a)
    return out


def gr_value(d, group):
    return d.get("group_ratio", {}).get(group, 1)


def cmd_price(d, args):
    group = opt(args, "--group", "cc")
    base = float(opt(args, "--base", "2"))
    kw = (positional(args)[0] if positional(args) else "").lower()
    gr = gr_value(d, group)
    rows = []
    for m in d["data"]:
        if group not in m.get("enable_groups", []):
            continue
        if kw and kw not in m["model_name"].lower():
            continue
        if m["quota_type"] == 1:  # 按次
            price = m["model_price"] * gr
            rows.append((m["model_name"], f"${price:.4f}/次", "-", "-",
                         ",".join(m.get("supported_endpoint_types", []))))
        else:  # 按量
            inp = m["model_ratio"] * gr * base
            out = inp * m["completion_ratio"]
            cache = inp * m["cache_ratio"]
            rows.append((m["model_name"], f"${inp:.2f}", f"${out:.2f}",
                         f"${cache:.2f}",
                         ",".join(m.get("supported_endpoint_types", []))))
    if not rows:
        print(f"无匹配(group={group}, 关键词={kw or '无'})")
        return
    print(f"# 组 {group}(倍率 {gr}, base {base}) — 单位 $/1M tokens")
    print(f"{'model':<32} {'in':>8} {'out':>9} {'cache':>8}  endpoints")
    for r in sorted(rows):
        print(f"{r[0]:<32} {r[1]:>8} {r[2]:>9} {r[3]:>8}  {r[4]}")


def cmd_models(d, args):
    group = opt(args, "--group", "cc")
    endpoint = opt(args, "--endpoint")
    names = []
    for m in d["data"]:
        if group not in m.get("enable_groups", []):
            continue
        if endpoint and endpoint not in m.get("supported_endpoint_types", []):
            continue
        names.append(m["model_name"])
    print(f"# group={group}"
          + (f" endpoint={endpoint}" if endpoint else "")
          + f" — {len(names)} 个模型")
    for n in sorted(names):
        print(n)


def cmd_groups(d, args):
    gr = d.get("group_ratio", {})
    desc = d.get("usable_group", {})
    print("# 分组倍率(group_ratio)与说明")
    for g in sorted(gr, key=lambda x: gr[x]):
        print(f"{g:<22} x{gr[g]:<5} {desc.get(g, '').strip()}")


def cmd_raw(d, args):
    pos = positional(args)
    if not pos:
        print("用法: packy.py raw <model>")
        return
    name = pos[0]
    m = next((x for x in d["data"] if x["model_name"] == name), None)
    if not m:
        print(f"未找到模型: {name}")
        return
    print(json.dumps(m, ensure_ascii=False, indent=2))


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    sub, args = sys.argv[1], sys.argv[2:]
    try:
        d = fetch()
    except Exception as e:  # noqa: BLE001
        print(f"取 API 失败: {e}", file=sys.stderr)
        sys.exit(1)
    fn = {"price": cmd_price, "models": cmd_models,
          "groups": cmd_groups, "raw": cmd_raw}.get(sub)
    if not fn:
        print(__doc__)
        sys.exit(1)
    fn(d, args)


if __name__ == "__main__":
    main()
