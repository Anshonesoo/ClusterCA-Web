export const GENOME_HEADER_HEX_LENGTH = 20;
export const GENOME_INSTRUCTION_HEX_LENGTH = 6;
export const DEFAULT_MAX_INSTRUCTIONS = 65_535;

export interface GenomeHeader {
  generation: number;
  familyPort: number;
  purpose: number;
  px: number;
  py: number;
  dormancy: number;
}

export type GenomeControl = "grow-up" | "grow-right" | "grow-down" | "grow-left" | "move-only" | "end";

export interface GenomeInstruction {
  readonly checksum: number;
  readonly move: number;
  readonly code: number;
  readonly control?: GenomeControl;
}

export interface DecodedGenome {
  readonly normalizedHex: string;
  readonly header: GenomeHeader;
  readonly instructions: readonly GenomeInstruction[];
}

const CONTROL_CODES = new Map<number, GenomeControl>([
  [0xfff0, "grow-up"],
  [0xfff1, "grow-right"],
  [0xfff2, "grow-down"],
  [0xfff3, "grow-left"],
  [0xfff4, "move-only"],
  [0xffff, "end"],
]);

const normalizeHex = (source: string): string => {
  const normalized = source.replace(/\s+/g, "").toUpperCase();
  if (!/^[0-9A-F]*$/.test(normalized)) throw new Error("基因只能包含十六进制字符和空白");
  return normalized;
};

const parseUnsigned = (hex: string): number => Number.parseInt(hex, 16);
const parseSigned16 = (hex: string): number => {
  const raw = parseUnsigned(hex);
  return raw >= 0x8000 ? raw - 0x10000 : raw;
};
const encodeUnsigned = (value: number, digits: number): string => value.toString(16).toUpperCase().padStart(digits, "0");
const encodeSigned16 = (value: number): string => encodeUnsigned(value < 0 ? value + 0x10000 : value, 4);

const assertUint = (name: string, value: number, max: number): void => {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`${name} 超出范围 0..${max}`);
};

export const instructionChecksum = (move: number, code: number): number => {
  assertUint("move", move, 0xf);
  assertUint("code", code, 0xffff);
  return move ^ ((code >>> 12) & 0xf) ^ ((code >>> 8) & 0xf) ^ ((code >>> 4) & 0xf) ^ (code & 0xf);
};

export const decodeGenome = (source: string, maxInstructions = DEFAULT_MAX_INSTRUCTIONS): DecodedGenome => {
  const hex = normalizeHex(source);
  if (hex.length < GENOME_HEADER_HEX_LENGTH) throw new Error("基因短于 20 字符固定头部");
  const bodyLength = hex.length - GENOME_HEADER_HEX_LENGTH;
  if (bodyLength % GENOME_INSTRUCTION_HEX_LENGTH !== 0) throw new Error("基因正文长度不是 6 的整数倍");
  const count = bodyLength / GENOME_INSTRUCTION_HEX_LENGTH;
  if (count > maxInstructions) throw new Error(`基因指令数 ${count} 超过上限 ${maxInstructions}`);
  const header: GenomeHeader = {
    generation: parseUnsigned(hex.slice(0, 4)),
    familyPort: parseUnsigned(hex.slice(4, 6)),
    purpose: parseUnsigned(hex.slice(6, 8)),
    px: parseSigned16(hex.slice(8, 12)),
    py: parseSigned16(hex.slice(12, 16)),
    dormancy: parseUnsigned(hex.slice(16, 20)),
  };
  const instructions: GenomeInstruction[] = [];
  for (let offset = GENOME_HEADER_HEX_LENGTH; offset < hex.length; offset += GENOME_INSTRUCTION_HEX_LENGTH) {
    const chunk = hex.slice(offset, offset + GENOME_INSTRUCTION_HEX_LENGTH);
    const checksum = parseUnsigned(chunk[0]);
    const move = parseUnsigned(chunk[1]);
    const code = parseUnsigned(chunk.slice(2));
    const expected = instructionChecksum(move, code);
    if (checksum !== expected) throw new Error(`第 ${instructions.length + 1} 条指令校验失败：${checksum.toString(16)} != ${expected.toString(16)}`);
    if (code >= 0xfff0 && !CONTROL_CODES.has(code)) throw new Error(`第 ${instructions.length + 1} 条使用了保留控制码 ${code.toString(16).toUpperCase()}`);
    if (code < 0xfff0 && move > 3) throw new Error(`第 ${instructions.length + 1} 条普通指令的移动码必须为 0..3`);
    instructions.push({ checksum, move, code, control: CONTROL_CODES.get(code) });
  }
  return { normalizedHex: hex, header, instructions };
};

export const encodeHeader = (header: GenomeHeader): string => {
  assertUint("generation", header.generation, 0xffff);
  assertUint("familyPort", header.familyPort, 0xff);
  assertUint("purpose", header.purpose, 0xff);
  if (!Number.isInteger(header.px) || header.px < -0x8000 || header.px > 0x7fff) throw new RangeError("px 超出 int16");
  if (!Number.isInteger(header.py) || header.py < -0x8000 || header.py > 0x7fff) throw new RangeError("py 超出 int16");
  assertUint("dormancy", header.dormancy, 0xffff);
  return (
    encodeUnsigned(header.generation, 4) +
    encodeUnsigned(header.familyPort, 2) +
    encodeUnsigned(header.purpose, 2) +
    encodeSigned16(header.px) +
    encodeSigned16(header.py) +
    encodeUnsigned(header.dormancy, 4)
  );
};

export const encodeInstruction = (move: number, code: number): string => {
  const checksum = instructionChecksum(move, code);
  return encodeUnsigned(checksum, 1) + encodeUnsigned(move, 1) + encodeUnsigned(code, 4);
};

export const nextGeneration = (generation: number): number => Math.min(0xffff, generation + 1);
