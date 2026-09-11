import { World } from "../engine/World";
import type { Cluster } from "../model/types";

export interface TeachingSpot {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly organelleCode: number;
  readonly col: number;
  readonly row: number;
}

const SPOT = (col: number, row: number): { x: number; y: number } => ({ x: 16 + col * 64, y: 16 + row * 64 });

const addFive = (world: World, col: number, row: number): number => {
  const { x, y } = SPOT(col, row);
  const cluster = world.addCluster({ x, y, width: 5, height: 5 });
  cluster.resources.amount = 40n;
  cluster.resources.energy = 120n;
  return cluster.id;
};

/**
 * 教学展示配置。追加 / 修改本数组即可实时更新教学模式的内同与布局。
 */
export const TEACHING_SPOTS: readonly TeachingSpot[] = [  { id: "shell", title: "壳 / 边界", detail: "四角必须是壳，提供结构完整；其他边格默认为空，器官只能放内部。", organelleCode: 0x0001, col: 0, row: 0 },
  { id: "gene-core", title: "基因核心", detail: "保存并执行基因；发育期遗传蚂蚁的起点，执行完后转为激活态。", organelleCode: 0x0002, col: 1, row: 0 },
  { id: "converter", title: "能量转换器", detail: "按所在格光强生产能量：min(16, floor(light/16))。", organelleCode: 0x0003, col: 2, row: 0 },
  { id: "storage-access", title: "储存访问端口", detail: "为四邻接的消费者开放团簇仓库；mode 可只放行为量/能量/both。", organelleCode: 0x0005, col: 3, row: 0 },
  { id: "exchanger", title: "物质交换器", detail: "双向分离：吸收口在预设范围吸收环境物质，输出口排出溢出。", organelleCode: 0x0006, col: 0, row: 1 },
  { id: "digital-port", title: "数字信号端口", detail: "接入数字总线（int16，256 频道），信号下一 Tick 送达，同频道求和再饱和。", organelleCode: 0x0007, col: 1, row: 1 },
  { id: "compile-port", title: "编译信号端口", detail: "接入编译总线，传递 hex 基因片段与 ! 命令。", organelleCode: 0x0008, col: 2, row: 1 },
  { id: "controller", title: "控制器", detail: "整数运算：常量/加减/比较/与或非/延迟/脉冲/锁存，读 inputChannel 写 channel。", organelleCode: 0x0009, col: 3, row: 1 },
  { id: "sensor", title: "传感器", detail: "探测本地光强/资源或前方邻近，输出到数字总线。", organelleCode: 0x000a, col: 0, row: 2 },
  { id: "compile-storage", title: "编译存储器", detail: "保存合法完整基因作为模板，由处理器/生殖端口产出时自动写入。", organelleCode: 0x000b, col: 1, row: 2 },
  { id: "compile-processor", title: "编译处理器", detail: "片段存储、确定性拼接、!CLEAR/!RESET 覆盖清空、完整 END 基因检测。", organelleCode: 0x000c, col: 2, row: 2 },
  { id: "transceiver", title: "外部收发器", detail: "有效群组内同频道广播数字信号，range 限制通信距离。", organelleCode: 0x000d, col: 3, row: 2 },
  { id: "grouper", title: "编组器", detail: "同码相邻自动握手组成普通刚体群组，整体移动与碰撞。", organelleCode: 0x000e, col: 0, row: 3 },
  { id: "thruster", title: "推进器", detail: "消耗 1 能量，按方向加运动计数，force 1–1024。", organelleCode: 0x000f, col: 1, row: 3 },
  { id: "jet", title: "喷射器", detail: "消耗 1 物质，向指定方向排出物质并产生反冲。", organelleCode: 0x0011, col: 2, row: 3 },
  { id: "reproduction", title: "生殖端口", detail: "接收完整 END 基因，在边界外生成单格休眠种子，目标占用时保留缓冲重试。", organelleCode: 0x0012, col: 3, row: 3 },
];

const placeDemonstration = (world: World, clusterId: number, spot: TeachingSpot): void => {
  const code = spot.organelleCode;
  const set = (x: number, y: number, c: number, runtime?: Partial<Cluster["organelleRuntime"][number]>): void => {
    world.setOrganelle(clusterId, x, y, c, { enabled: true, ...runtime });
  };
  switch (code) {
    case 0x0001:
      set(2, 2, 0x0003);
      break;
    case 0x0002:
      set(2, 2, 0x0002);
      break;
    case 0x0003:
      set(2, 2, 0x0003);
      break;
    case 0x0005:
      set(2, 2, 0x0005, { mode: "both" });
      break;
    case 0x0006:
      set(1, 2, 0x0005, { mode: "both" });
      set(2, 2, 0x0006, { mode: "both", direction: "left", range: 2 });
      break;
    case 0x0007:
      set(2, 2, 0x0007, { channel: 1 });
      break;
    case 0x0008:
      set(2, 2, 0x0008, { channel: 1 });
      break;
    case 0x0009:
      set(2, 2, 0x0007, { channel: 5 });
      set(2, 1, 0x0009, { operation: "add", inputChannel: 5, value: 500, channel: 5 });
      break;
    case 0x000a:
      set(2, 2, 0x0007, { channel: 6 });
      set(2, 1, 0x000a, { operation: "light" });
      break;
    case 0x000b:
      set(2, 2, 0x000b);
      break;
    case 0x000c:
      set(1, 2, 0x0008, { channel: 3 });
      set(2, 2, 0x000c);
      break;
    case 0x000d:
      set(2, 2, 0x0007, { channel: 7 });
      set(2, 1, 0x000d, { channel: 7, range: 20 });
      break;
    case 0x000e:
      set(2, 2, 0x000e, { value: 8 });
      break;
    case 0x000f:
      set(1, 2, 0x0005, { mode: "energy" });
      set(2, 1, 0x000f, { direction: "right", force: 30 });
      break;
    case 0x0011:
      set(1, 2, 0x0005, { mode: "amount" });
      set(2, 1, 0x0011, { direction: "up" });
      break;
    case 0x0012:
      set(1, 2, 0x0008, { channel: 4 });
      set(2, 2, 0x000c);
      set(3, 2, 0x0012, { direction: "right" });
      break;
    default:
      break;
  }
};

export const TEACHING_REGION = Object.freeze({ x0: 4, y0: 4, x1: 256, y1: 256 });

/** 生成教学世界：0..256 展示区内布置各器官演示团簇，可运行观察每个器官的行为。 */
export const buildTeachingMap = (seed: bigint): World => {
  const world = new World(seed, { base: 128, noiseAmplitude: 0, noiseScale: 64, maximum: 255, sources: [] });
  for (const spot of TEACHING_SPOTS) {
    const clusterId = addFive(world, spot.col, spot.row);
    placeDemonstration(world, clusterId, spot);
    world.setClusterNote(clusterId, spot.detail);
  }
  const center = world.addAlgae(120, 120);
  center.resources.amount = 30n;
  center.resources.energy = 60n;
  return world;
};
