import { describe, expect, it } from "vitest";
import { decodeGenome, encodeHeader, encodeInstruction, nextGeneration } from "./codec";
import { executeGenomeInstruction } from "./vm";

describe("基因编码与虚拟机", () => {
  const header = encodeHeader({ generation: 5, familyPort: 7, purpose: 0, px: -2, py: 300, dormancy: 12 });

  it("固定头部能无损解码有符号动量", () => {
    const genome = decodeGenome(header);
    expect(genome.header).toEqual({ generation: 5, familyPort: 7, purpose: 0, px: -2, py: 300, dormancy: 12 });
  });

  it("逐条 XOR 校验并执行先移动后写入", () => {
    const instructionHex = encodeInstruction(2, 0x0003);
    const genome = decodeGenome(header + instructionHex);
    const action = executeGenomeInstruction({ x: 1, y: 1, direction: 0 }, genome.instructions[0]);
    expect(action).toEqual({ kind: "write", x: 2, y: 1, code: 3, state: { x: 2, y: 1, direction: 1 } });
  });

  it("增长码不移动蚂蚁", () => {
    const genome = decodeGenome(header + encodeInstruction(9, 0xfff3));
    expect(executeGenomeInstruction({ x: 2, y: 2, direction: 1 }, genome.instructions[0])).toEqual({
      kind: "grow",
      side: "left",
      state: { x: 2, y: 2, direction: 1 },
    });
  });

  it("拒绝校验错误和保留控制码", () => {
    expect(() => decodeGenome(header + "000003")).toThrow("校验失败");
    expect(() => decodeGenome(header + encodeInstruction(0, 0xfff5))).toThrow("保留控制码");
  });

  it("代数在 uint16 上限饱和", () => {
    expect(nextGeneration(0xffff)).toBe(0xffff);
  });
});
