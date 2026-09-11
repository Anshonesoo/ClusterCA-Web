import { describe, expect, it } from "vitest";
import { isAlgaeStructure } from "../model/cluster";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../model/constants";
import { buildEcologyTemplate, ecologyTemplateCounts } from "./ecologyTemplate";

describe("标准生态模板", () => {
  it("固定种子生成完全相同的世界", () => {
    expect(buildEcologyTemplate(42n).stateDigest()).toBe(buildEcologyTemplate(42n).stateDigest());
    expect(buildEcologyTemplate(42n).stateDigest()).not.toBe(buildEcologyTemplate(43n).stateDigest());
  });

  it("生成固定数量藻类、资源格和中心样本", () => {
    const world = buildEcologyTemplate(7n);
    expect(world.width).toBe(WORLD_WIDTH);
    expect(world.height).toBe(WORLD_HEIGHT);
    expect(world.clusters.size).toBe(ecologyTemplateCounts.algae);
    expect([...world.clusters.values()].every(isAlgaeStructure)).toBe(true);
    expect(world.material.entries()).toHaveLength(ecologyTemplateCounts.materialCells);
    expect(world.material.get(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 + 4)).toEqual({ amount: 40n, energy: 100n });
  });

  it("物质按少量局部斑块生成而非全图均匀散点", () => {
    const entries = buildEcologyTemplate(99n).material.entries();
    const occupiedChunks = new Set(entries.map((cell) => `${Math.floor(cell.x / 64)},${Math.floor(cell.y / 64)}`));
    expect(occupiedChunks.size).toBeLessThan(40);
    expect(ecologyTemplateCounts.patches).toBe(4);
  });
});
