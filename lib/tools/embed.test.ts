import { describe, it, expect } from "vitest";
import { embed } from "./embed";
import { DIM } from "../db/index";

describe("embed", () => {
  it("返回长度为 DIM 的归一化向量", async () => {
    const v = await embed("退货政策");
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(DIM);
  }, 120000);

  it("相近语义向量点积高于不相近", async () => {
    const a = await embed("怎么退货");
    const b = await embed("退货流程");
    const c = await embed("今天天气");
    const dot = (x: Float32Array, y: Float32Array) => x.reduce((s, xi, i) => s + xi * y[i], 0);
    expect(dot(a, b)).toBeGreaterThan(dot(a, c));
  }, 120000);
});
