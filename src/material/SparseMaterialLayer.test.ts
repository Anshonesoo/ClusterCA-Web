import { describe, expect, it } from "vitest";
import { WORLD_WIDTH } from "../model/constants";
import { SparseMaterialLayer } from "./SparseMaterialLayer";

describe("物质层", () => {
  it("五等分扩散同时守恒能量和拖曳物质", () => {
    const layer = new SparseMaterialLayer();
    layer.set(0, 0, { amount: 10n, energy: 10n });
    const before = layer.totals();
    layer.diffuseEnergyAndDrag(1n);
    expect(layer.totals()).toEqual(before);
    expect(layer.get(0, 0)).toEqual({ amount: 2n, energy: 2n });
    expect(layer.get(1, 0)).toEqual({ amount: 2n, energy: 2n });
    expect(layer.get(WORLD_WIDTH - 1, 0)).toEqual({ amount: 2n, energy: 2n });
  });

  it("小于五的能量不扩散", () => {
    const layer = new SparseMaterialLayer();
    layer.set(3, 3, { amount: 1n, energy: -0n });
    layer.diffuseEnergyAndDrag();
    expect(layer.entries()).toEqual([{ x: 3, y: 3, amount: 1n, energy: -0n }]);
  });
});
