import { describe, expect, it } from "vitest";
import { buildShowcaseWorld } from "./showcase";

describe("展示团簇", () => {
  it("包含四个大型复杂胞团，每个普通器官数量不低于 30", () => {
    const world = buildShowcaseWorld(1n);
    const clusters = [...world.clusters.values()].filter((cluster) => cluster.algaeState === undefined);
    expect(clusters.length).toBeGreaterThanOrEqual(4);
    for (const cluster of clusters) {
      const organelleCount = [...cluster.organelles].filter((code) => code !== 0 && code !== 0x0001).length;
      expect(organelleCount).toBeGreaterThanOrEqual(30);
    }
  });

  it("固定种子生成完全相同的展示世界", () => {
    expect(buildShowcaseWorld(3n).stateDigest()).toBe(buildShowcaseWorld(3n).stateDigest());
  });
});
