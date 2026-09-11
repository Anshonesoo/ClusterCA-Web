import { WORLD_HEIGHT, WORLD_WIDTH } from "../model/constants";
import type { MaterialValue } from "../model/types";
import { wrap } from "../geometry/torus";

const DIRECTIONS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

const keyOf = (x: number, y: number): number => wrap(y, WORLD_HEIGHT) * WORLD_WIDTH + wrap(x, WORLD_WIDTH);
const pointOf = (key: number): { x: number; y: number } => ({ x: key % WORLD_WIDTH, y: Math.floor(key / WORLD_WIDTH) });
const abs = (value: bigint): bigint => (value < 0n ? -value : value);

export class SparseMaterialLayer {
  readonly #cells = new Map<number, MaterialValue>();

  get(x: number, y: number): MaterialValue {
    const value = this.#cells.get(keyOf(x, y));
    return value ? { ...value } : { amount: 0n, energy: 0n };
  }

  clear(): void {
    this.#cells.clear();
  }

  set(x: number, y: number, value: MaterialValue): void {
    if (value.amount < 0n) throw new RangeError("物质量不能为负数");
    const key = keyOf(x, y);
    if (value.amount === 0n && value.energy === 0n) this.#cells.delete(key);
    else this.#cells.set(key, { ...value });
  }

  add(x: number, y: number, delta: MaterialValue): void {
    const current = this.get(x, y);
    this.set(x, y, { amount: current.amount + delta.amount, energy: current.energy + delta.energy });
  }

  entries(): Array<{ x: number; y: number; amount: bigint; energy: bigint }> {
    return [...this.#cells.entries()]
      .sort(([a], [b]) => a - b)
      .map(([key, value]) => ({ ...pointOf(key), ...value }));
  }

  totals(): MaterialValue {
    let amount = 0n;
    let energy = 0n;
    for (const value of this.#cells.values()) {
      amount += value.amount;
      energy += value.energy;
    }
    return { amount, energy };
  }

  diffuseEnergyAndDrag(dragCoefficient = 1n): void {
    if (dragCoefficient < 0n) throw new RangeError("拖曳系数不能为负数");
    const next = new Map<number, MaterialValue>();
    const add = (key: number, amount: bigint, energy: bigint): void => {
      const current = next.get(key) ?? { amount: 0n, energy: 0n };
      const result = { amount: current.amount + amount, energy: current.energy + energy };
      if (result.amount < 0n) throw new Error("扩散产生了负物质量");
      if (result.amount !== 0n || result.energy !== 0n) next.set(key, result);
    };

    for (const [sourceKey, source] of [...this.#cells.entries()].sort(([a], [b]) => a - b)) {
      const { x, y } = pointOf(sourceKey);
      const share = source.energy / 5n;
      let remainingAmount = source.amount;
      add(sourceKey, 0n, source.energy - 4n * share);
      for (const [dx, dy] of DIRECTIONS) {
        const targetKey = keyOf(x + dx, y + dy);
        const requestedAmount = abs(share) * dragCoefficient;
        const movedAmount = requestedAmount < remainingAmount ? requestedAmount : remainingAmount;
        remainingAmount -= movedAmount;
        add(targetKey, movedAmount, share);
      }
      add(sourceKey, remainingAmount, 0n);
    }

    this.#cells.clear();
    for (const [key, value] of next) this.#cells.set(key, value);
  }
}
