import { describe, expect, it } from "vitest";
import { createAlgaeOrganelleGrid, isAlgaeStructure } from "../model/cluster";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../model/constants";
import type { Cluster } from "../model/types";
import { grownAlgaeRect, uniqueBrightestDirection } from "./algae";

const algae = (width: number, height: number): Cluster => ({
  id: 1,
  rect: { x: 0, y: 0, width, height },
  hp: 1n,
  maxHp: 1n,
  health: 64,
  resources: { amount: 0n, energy: 0n, amountCapacityBonus: 0n, energyCapacityBonus: 0n },
  motion: { px: 0n, py: 0n, density: 1n },
  armor: { up: 0n, right: 0n, down: 0n, left: 0n },
  organelles: createAlgaeOrganelleGrid(width, height),
  organelleRuntime: {},
  lifecycle: { kind: "active" },
});

describe("藻类结构规则", () => {
  it("只按完整壳和全光合内部动态识别", () => {
    const cluster = algae(3, 5);
    expect(isAlgaeStructure(cluster)).toBe(true);
    cluster.organelles[0] = 0;
    expect(isAlgaeStructure(cluster)).toBe(false);
  });

  it("最亮方向并列时等待", () => {
    expect(uniqueBrightestDirection({ up: 10, right: 10, down: 0, left: 1 })).toBeUndefined();
    expect(uniqueBrightestDirection({ up: 11, right: 10, down: 0, left: 1 })?.direction).toBe("up");
  });

  it("向左上生长保持原有世界位置并移动局部原点", () => {
    expect(grownAlgaeRect(algae(3, 3).rect, "left")).toEqual({ x: WORLD_WIDTH - 1, y: 0, width: 4, height: 3 });
    expect(grownAlgaeRect(algae(3, 3).rect, "up")).toEqual({ x: 0, y: WORLD_HEIGHT - 1, width: 3, height: 4 });
  });
});
