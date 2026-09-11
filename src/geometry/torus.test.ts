import { describe, expect, it } from "vitest";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../model/constants";
import { splitToroidalRect, toroidalDelta, toroidalRectChebyshevDistance, toroidalRectsOverlap, translateRect, wrap } from "./torus";

describe("环面几何", () => {
  it("正确归一化正负坐标", () => {
    expect(wrap(-1, WORLD_WIDTH)).toBe(WORLD_WIDTH - 1);
    expect(wrap(WORLD_WIDTH, WORLD_WIDTH)).toBe(0);
  });

  it("跨右下边界的矩形拆成四块", () => {
    expect(splitToroidalRect({ x: WORLD_WIDTH - 2, y: WORLD_HEIGHT - 1, width: 4, height: 3 })).toHaveLength(4);
  });

  it("检测跨边界重叠", () => {
    expect(
      toroidalRectsOverlap(
        { x: WORLD_WIDTH - 2, y: 10, width: 4, height: 3 },
        { x: 0, y: 10, width: 2, height: 3 },
      ),
    ).toBe(true);
  });

  it("平移后保持尺寸并环绕", () => {
    expect(translateRect({ x: WORLD_WIDTH - 1, y: 0, width: 3, height: 3 }, 1, -1)).toEqual({
      x: 0,
      y: WORLD_HEIGHT - 1,
      width: 3,
      height: 3,
    });
  });

  it("取最短环面位移", () => {
    expect(toroidalDelta(WORLD_WIDTH - 1, 1, WORLD_WIDTH)).toBe(2);
    expect(toroidalDelta(1, WORLD_WIDTH - 1, WORLD_WIDTH)).toBe(-2);
  });

  it("矩形切比雪夫距离遵循环面最短方向", () => {
    expect(toroidalRectChebyshevDistance(
      { x: WORLD_WIDTH - 4, y: 10, width: 3, height: 3 },
      { x: 0, y: 10, width: 3, height: 3 },
    )).toBe(1);
  });
});
