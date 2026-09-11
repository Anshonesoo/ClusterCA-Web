import { describe, expect, it } from "vitest";
import { toroidalRectsOverlap, translateRect } from "../geometry/torus";
import type { BodySnapshot, MoveIntent } from "../model/types";
import { resolveMovements } from "./solver";

const body = (id: string, x: number, px = 90n): BodySnapshot => ({
  id,
  clusterIds: [Number(id.slice(1))],
  rects: [{ x, y: 10, width: 3, height: 3 }],
  mass: 9n,
  px,
  py: 0n,
  thresholdX: 90n,
  thresholdY: 90n,
});

const intent = (id: string, dx: -1 | 0 | 1): MoveIntent => ({
  bodyId: id,
  clusterIds: [Number(id.slice(1))],
  dx,
  dy: 0,
  thresholdX: 90n,
  thresholdY: 90n,
  px: dx === 0 ? 0n : BigInt(dx) * 90n,
  py: 0n,
});

describe("事务式移动求解器", () => {
  it("允许互不冲突的移动", () => {
    const result = resolveMovements([body("c1", 0), body("c2", 10)], [intent("c1", 1)]);
    expect(result.displacementByBody.get("c1")).toEqual({ x: 1, y: 0 });
  });

  it("相向运动不会提交重叠位置", () => {
    const result = resolveMovements([body("c1", 0), body("c2", 4, -90n)], [intent("c1", 1), intent("c2", -1)]);
    expect(result.displacementByBody.get("c1")).toEqual({ x: 0, y: 0 });
    expect(result.displacementByBody.get("c2")).toEqual({ x: 0, y: 0 });
    expect(result.contacts).toHaveLength(1);
  });

  it("拒绝开始状态中的重叠", () => {
    expect(() => resolveMovements([body("c1", 0), body("c2", 2)], [])).toThrow("已经存在重叠");
  });

  it("结果不依赖输入插入顺序", () => {
    const left = resolveMovements([body("c1", 0), body("c2", 4, -90n)], [intent("c1", 1), intent("c2", -1)]);
    const right = resolveMovements([body("c2", 4, -90n), body("c1", 0)], [intent("c2", -1), intent("c1", 1)]);
    expect([...left.displacementByBody]).toEqual([...right.displacementByBody]);
    expect(left.contacts).toEqual(right.contacts);
  });

  it("总动量达到联合阈值时整条接触链同步推动", () => {
    const leader = body("c1", 0, 180n);
    const follower = body("c2", 3, 0n);
    const result = resolveMovements([leader, follower], [intent("c1", 1)]);
    expect(result.displacementByBody.get("c1")).toEqual({ x: 1, y: 0 });
    expect(result.displacementByBody.get("c2")).toEqual({ x: 1, y: 0 });
  });

  it("链中存在不可推动刚体时整链保持原位", () => {
    const leader = body("c1", 0, 180n);
    const follower = { ...body("c2", 3, 0n), immovable: true };
    const result = resolveMovements([leader, follower], [intent("c1", 1)]);
    expect(result.displacementByBody.get("c1")).toEqual({ x: 0, y: 0 });
    expect(result.displacementByBody.get("c2")).toEqual({ x: 0, y: 0 });
  });

  it("大量确定性接触组合提交后始终无重叠", () => {
    let state = 17;
    const next = (): number => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state;
    };
    for (let scenario = 0; scenario < 200; scenario += 1) {
      const bodies: BodySnapshot[] = [];
      const intents: MoveIntent[] = [];
      for (let index = 0; index < 12; index += 1) {
        const dx = ((next() % 3) - 1) as -1 | 0 | 1;
        const current = body(`c${index + 1}`, index * 4, BigInt(dx) * 90n);
        bodies.push(current);
        if (dx !== 0) intents.push(intent(current.id, dx));
      }
      const result = resolveMovements(bodies, intents);
      const finalRects = bodies.map((current) => translateRect(current.rects[0], result.displacementByBody.get(current.id)?.x ?? 0, 0));
      for (let left = 0; left < finalRects.length; left += 1) {
        for (let right = left + 1; right < finalRects.length; right += 1) {
          expect(toroidalRectsOverlap(finalRects[left], finalRects[right])).toBe(false);
        }
      }
    }
  });
});
