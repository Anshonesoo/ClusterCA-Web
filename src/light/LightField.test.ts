import { describe, expect, it } from "vitest";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../model/constants";
import { LightField } from "./LightField";

describe("程序化光层", () => {
  it("相同种子和坐标始终一致", () => {
    const left = new LightField(42n);
    const right = new LightField(42n);
    expect(left.sample(123, 456)).toBe(right.sample(123, 456));
  });

  it("采样遵循环面", () => {
    const field = new LightField(9n);
    expect(field.sample(-1, WORLD_HEIGHT)).toBe(field.sample(WORLD_WIDTH - 1, 0));
  });

  it("固定光源跨环面边界叠加且受上限约束", () => {
    const field = new LightField(1n, {
      base: 0,
      noiseAmplitude: 0,
      noiseScale: 64,
      maximum: 100,
      sources: [{ x: 0, y: 0, intensity: 150, radius: 4 }],
    });
    expect(field.sample(0, 0)).toBe(100);
    expect(field.sample(WORLD_WIDTH - 1, 0)).toBeGreaterThan(0);
  });
});
