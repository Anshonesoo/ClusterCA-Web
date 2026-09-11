import { World } from "../engine/World";
import { encodeHeader, encodeInstruction } from "../genome/codec";
import type { Cluster } from "../model/types";

/**
 * 模板选择界面下方的复杂团簇实时演示世界。
 * 四个复杂胞团分别覆盖能量运动、信号逻辑、编译繁殖、物质群组，体现全部细胞器功能并自动运转。
 */

type Rt = Partial<Cluster["organelleRuntime"][number]>;
interface Entry { x: number; y: number; code: number; rt?: Rt; }

const set = (world: World, id: number, entries: readonly Entry[]): void => {
  for (const e of entries) world.setOrganelle(id, e.x, e.y, e.code, { enabled: true, ...(e.rt ?? {}) });
};

// 器官代码
const SHELL = 0x0001;
const GENE = 0x0002;
const CONV = 0x0003;
const ACCESS = 0x0005;
const EXCH = 0x0006;
const DPORT = 0x0007;
const CPORT = 0x0008;
const CTRL = 0x0009;
const SENSOR = 0x000a;
const CSTORE = 0x000b;
const CPROC = 0x000c;
const TRANS = 0x000d;
const GROUP = 0x000e;
const THRUST = 0x000f;
const JET = 0x0011;
const REPRO = 0x0012;
const MUTATOR = 0x0013;
void SHELL;

// A 能量与运动枢纽：光合→端口→推进（门控）；传感器光差→比较→非→门控推进（趋光）；喷射反冲
const buildEnergyMotion = (world: World, x: number, y: number): number => {
  const id = world.addCluster({ x, y, width: 9, height: 9 }).id;
  const entries: Entry[] = [];
  for (let iy = 1; iy <= 4; iy += 1) {
    entries.push({ x: 1, y: iy, code: CONV });
    entries.push({ x: 2, y: iy, code: CONV });
    entries.push({ x: 3, y: iy, code: ACCESS, rt: { mode: "energy" } });
    entries.push({ x: 4, y: iy, code: THRUST, rt: { direction: "right", force: 4, inputChannel: 40 } });
  }
  entries.push({ x: 1, y: 5, code: JET, rt: { direction: "left", inputChannel: 41 } });
  entries.push({ x: 1, y: 6, code: JET, rt: { direction: "left", inputChannel: 41 } });
  entries.push({ x: 3, y: 5, code: ACCESS, rt: { mode: "amount" } });
  entries.push({ x: 3, y: 6, code: ACCESS, rt: { mode: "both" } });
  entries.push({ x: 6, y: 1, code: SENSOR, rt: { operation: "light-gradient", direction: "right" } });
  entries.push({ x: 6, y: 2, code: SENSOR, rt: { operation: "proximity", direction: "right" } });
  entries.push({ x: 5, y: 1, code: DPORT, rt: { channel: 40 } });
  entries.push({ x: 5, y: 2, code: DPORT, rt: { channel: 41 } });
  entries.push({ x: 6, y: 4, code: DPORT, rt: { channel: 40 } });
  entries.push({ x: 6, y: 5, code: DPORT, rt: { channel: 41 } });
  entries.push({ x: 6, y: 6, code: DPORT, rt: { channel: 42 } });
  entries.push({ x: 5, y: 4, code: CTRL, rt: { operation: "compare", inputChannel: 40, channel: 41, value: 0 } });
  entries.push({ x: 5, y: 5, code: CTRL, rt: { operation: "not", inputChannel: 41, channel: 40 } });
  entries.push({ x: 5, y: 6, code: CTRL, rt: { operation: "and", inputChannel: 40, channel: 42, value: 1 } });
  entries.push({ x: 7, y: 4, code: TRANS, rt: { channel: 40, range: 24 } });
  entries.push({ x: 7, y: 7, code: GROUP, rt: { value: 8 } });
  set(world, id, entries);
  return id;
};

// B 信号与逻辑核心：控制器覆盖全部运算 + 传感器覆盖全部探测 + 收发器
const buildSignalLogic = (world: World, x: number, y: number): number => {
  const id = world.addCluster({ x, y, width: 11, height: 9 }).id;
  const entries: Entry[] = [];
  const ops: Array<[number, number, string, number, number, number]> = [
    [1, 1, "constant", 0, 5, 1000],
    [3, 1, "add", 5, 6, 500],
    [5, 1, "sub", 6, 7, 200],
    [1, 3, "compare", 7, 8, 1000],
    [3, 3, "and", 8, 9, 1],
    [5, 3, "or", 9, 10, 0],
    [1, 5, "not", 10, 11, 0],
    [3, 5, "delay", 11, 12, 0],
    [5, 5, "pulse", 12, 13, 7],
    [7, 5, "latch", 13, 14, 9],
  ];
  for (const [cx, cy, operation, inputChannel, channel, value] of ops) {
    entries.push({ x: cx, y: cy, code: CTRL, rt: { operation, inputChannel, channel, value } });
    entries.push({ x: cx + 1, y: cy, code: DPORT, rt: { channel } });
    entries.push({ x: cx, y: cy + 1, code: DPORT, rt: { channel: inputChannel } });
  }
  const sensorOps = ["light", "light-gradient", "energy", "amount", "proximity"];
  for (let i = 0; i < sensorOps.length; i += 1) {
    entries.push({ x: 9, y: 1 + i, code: SENSOR, rt: { operation: sensorOps[i], direction: "right" } });
    entries.push({ x: 8, y: 1 + i, code: DPORT, rt: { channel: 20 + i } });
  }
  entries.push({ x: 9, y: 6, code: TRANS, rt: { channel: 20, range: 32 } });
  entries.push({ x: 8, y: 6, code: DPORT, rt: { channel: 20 } });
  entries.push({ x: 9, y: 7, code: TRANS, rt: { channel: 21, range: 32 } });
  entries.push({ x: 8, y: 7, code: DPORT, rt: { channel: 21 } });
  entries.push({ x: 1, y: 7, code: CONV });
  entries.push({ x: 3, y: 7, code: CONV });
  entries.push({ x: 5, y: 7, code: CONV });
  entries.push({ x: 7, y: 7, code: GROUP, rt: { value: 8 } });
  set(world, id, entries);
  return id;
};

// C 编译繁殖中心：编译端口→处理器→存储器→生殖端口（构建时发送完整基因触发产种）
const buildCompileRepro = (world: World, x: number, y: number): number => {
  const id = world.addCluster({ x, y, width: 11, height: 9 }).id;
  const entries: Entry[] = [];
  for (let iy = 1; iy <= 6; iy += 1) {
    entries.push({ x: 1, y: iy, code: CPORT, rt: { channel: 3 } });
    entries.push({ x: 2, y: iy, code: CPROC });
    entries.push({ x: 3, y: iy, code: CSTORE });
    entries.push({ x: 4, y: iy, code: CPROC });
    entries.push({ x: 5, y: iy, code: CPORT, rt: { channel: 3 } });
    entries.push({ x: 6, y: iy, code: CPROC });
    entries.push({ x: 7, y: iy, code: CPORT, rt: { channel: 3 } });
    entries.push({ x: 8, y: iy, code: CPORT, rt: { channel: 3 } });
    entries.push({ x: 9, y: iy, code: REPRO, rt: { direction: "right", reproduceCostAmount: 5 } });
  }
  for (let ix = 1; ix <= 9; ix += 1) entries.push({ x: ix, y: 7, code: ix === 2 ? GENE : CONV });
  set(world, id, entries);
  return id;
};

// D 物质与群组工厂：交换器（absorb/eject/range/门控）+ 编组 + 收发 + 变异器（预留）
const buildMaterialGroup = (world: World, x: number, y: number): number => {
  const id = world.addCluster({ x, y, width: 9, height: 9 }).id;
  const entries: Entry[] = [];
  for (let iy = 1; iy <= 5; iy += 1) {
    entries.push({ x: 1, y: iy, code: EXCH, rt: { mode: "absorb", direction: "left", range: 3 } });
    entries.push({ x: 2, y: iy, code: ACCESS, rt: { mode: "both" } });
    entries.push({ x: 3, y: iy, code: CONV });
    entries.push({ x: 4, y: iy, code: CONV });
    entries.push({ x: 5, y: iy, code: CONV });
    entries.push({ x: 6, y: iy, code: ACCESS, rt: { mode: "both" } });
    entries.push({ x: 7, y: iy, code: EXCH, rt: { mode: "eject", direction: "right" } });
  }
  entries.push({ x: 2, y: 6, code: SENSOR, rt: { operation: "amount" } });
  entries.push({ x: 3, y: 6, code: DPORT, rt: { channel: 30 } });
  entries.push({ x: 4, y: 6, code: TRANS, rt: { channel: 30, range: 32 } });
  entries.push({ x: 5, y: 6, code: MUTATOR });
  entries.push({ x: 6, y: 6, code: MUTATOR });
  entries.push({ x: 7, y: 6, code: GROUP, rt: { value: 9 } });
  set(world, id, entries);
  return id;
};

export const buildShowcaseWorld = (seed = 1n): World => {
  const world = new World(seed, { base: 64, noiseAmplitude: 0, noiseScale: 64, maximum: 255, sources: [] });

  const energy = buildEnergyMotion(world, 20, 20);
  const signal = buildSignalLogic(world, 30, 20);
  const compile = buildCompileRepro(world, 44, 20);
  const material = buildMaterialGroup(world, 20, 50);

  // A 与 B 相邻（矩形距离 1）编组
  world.createNormalGroup(energy, signal, 8);

  // 给 C 发送一段完整 END 基因，触发 编译→处理器→存储器→生殖 链路
  const gene = encodeHeader({ generation: 0, familyPort: 7, purpose: 0, px: 0, py: 0, dormancy: 2 })
    + encodeInstruction(0, 0xffff);
  world.emitCompileSignal(compile, 2 * 11 + 1, gene);

  // 给 D 周围布置环境物质，供交换器范围吸收
  for (let i = 0; i < 24; i += 1) {
    world.editMaterial(10 + (i % 4), 52 + Math.floor(i / 4), BigInt(6 + i % 12), 0n);
  }

  return world;
};

export const SHOWCASE_CAMERA = Object.freeze({ x: 37, y: 39, zoom: 5.5 });
