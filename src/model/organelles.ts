import { BUILTIN_CODE_MAX, CUSTOM_CODE_MAX, CUSTOM_CODE_MIN, MAX_ORGANELLE_CODE } from "./constants";

export type OrganelleKind =
  | "shell"
  | "gene-core"
  | "energy-converter"
  | "storage"
  | "storage-access"
  | "material-exchanger"
  | "digital-port"
  | "compile-port"
  | "controller"
  | "sensor"
  | "compile-storage"
  | "compile-processor"
  | "transceiver"
  | "grouper"
  | "thruster"
  | "defense"
  | "jet"
  | "reproduction-port"
  | "mutator";

export interface OrganelleDefinition {
  readonly code: number;
  readonly kind: OrganelleKind;
  readonly name: string;
  readonly color: string;
  readonly buildAmount: bigint;
  readonly buildEnergy: bigint;
  readonly recycleNumerator: bigint;
  readonly recycleDenominator: bigint;
  readonly ruleId: string;
}

const BUILTINS: readonly OrganelleDefinition[] = [
  [0x0001, "shell", "壳", "#b8d8ce"],
  [0x0002, "gene-core", "基因核心", "#f5cf63"],
  [0x0003, "energy-converter", "能量转换器", "#82d173"],
  [0x0005, "storage-access", "储存访问端口", "#f0b77b"],
  [0x0006, "material-exchanger", "物质交换器", "#55c1a7"],
  [0x0007, "digital-port", "数字信号端口", "#57a6ff"],
  [0x0008, "compile-port", "编译信号端口", "#8a7dff"],
  [0x0009, "controller", "控制器", "#c783e8"],
  [0x000a, "sensor", "传感器", "#52d7e8"],
  [0x000b, "compile-storage", "编译存储器", "#9e7ced"],
  [0x000c, "compile-processor", "编译处理器", "#c05ee0"],
  [0x000d, "transceiver", "外部收发器", "#4ebbe8"],
  [0x000e, "grouper", "编组器", "#ff8e72"],
  [0x000f, "thruster", "推进器", "#ff645f"],
  [0x0011, "jet", "喷射器", "#ff9d47"],
  [0x0012, "reproduction-port", "生殖端口", "#f06aab"],
  [0x0013, "mutator", "变异器", "#b78df5"],
].map(([code, kind, name, color]) => ({
  code: code as number,
  kind: kind as OrganelleKind,
  name: name as string,
  color: color as string,
  buildAmount: 2n,
  buildEnergy: 1n,
  recycleNumerator: 1n,
  recycleDenominator: 2n,
  ruleId: `builtin:${kind as string}`,
}));

export class OrganelleRegistry {
  readonly #definitions = new Map<number, OrganelleDefinition>();

  constructor() {
    for (const definition of BUILTINS) this.#definitions.set(definition.code, definition);
  }

  get(code: number): OrganelleDefinition | undefined {
    return this.#definitions.get(code);
  }

  list(): OrganelleDefinition[] {
    return [...this.#definitions.values()].sort((a, b) => a.code - b.code);
  }

  listCustom(): OrganelleDefinition[] {
    return this.list().filter((definition) => definition.code >= CUSTOM_CODE_MIN && definition.code <= CUSTOM_CODE_MAX);
  }

  registerCustom(definition: OrganelleDefinition): void {
    if (!Number.isInteger(definition.code) || definition.code < CUSTOM_CODE_MIN || definition.code > CUSTOM_CODE_MAX) {
      throw new RangeError("自定义器官代码必须位于 0100–FFEF");
    }
    if (!definition.name.trim() || !definition.ruleId.trim()) throw new Error("自定义器官名称和 ruleId 不能为空");
    if (
      definition.buildAmount < 0n ||
      definition.buildEnergy < 0n ||
      definition.recycleNumerator < 0n ||
      definition.recycleDenominator <= 0n
    ) {
      throw new RangeError("自定义器官成本和回收率必须为合法非负整数，回收分母必须大于 0");
    }
    this.#definitions.set(definition.code, Object.freeze({ ...definition }));
  }

  isValidCode(code: number): boolean {
    if (!Number.isInteger(code) || code < 0 || code > MAX_ORGANELLE_CODE) return false;
    return code === 0 || this.#definitions.has(code);
  }
}

export const builtinOrganelles = BUILTINS;
