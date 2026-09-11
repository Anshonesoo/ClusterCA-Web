import { describe, expect, it } from "vitest";
import { ChunkSpatialIndex } from "./ChunkSpatialIndex";

describe("64×64 格区块空间索引", () => {
  it("2048×2048 世界恰好划分为 32×32 个区块", () => {
    expect(ChunkSpatialIndex.dimensions).toEqual({ x: 32, y: 32, size: 64 });
  });

  it("跨环面边界的矩形进入两侧区块", () => {
    const index = new ChunkSpatialIndex<string>();
    index.insert("edge", [{ x: 2047, y: 1, width: 3, height: 3 }]);
    index.insert("origin", [{ x: 0, y: 0, width: 3, height: 3 }]);
    expect(index.candidatePairs((a, b) => a.localeCompare(b))).toEqual([["edge", "origin"]]);
  });

  it("不把远处对象列为候选对", () => {
    const index = new ChunkSpatialIndex<string>();
    index.insert("a", [{ x: 0, y: 0, width: 3, height: 3 }]);
    index.insert("b", [{ x: 500, y: 500, width: 3, height: 3 }]);
    expect(index.candidatePairs((a, b) => a.localeCompare(b))).toEqual([]);
  });
});
