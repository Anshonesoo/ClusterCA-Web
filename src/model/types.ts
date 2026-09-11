export type ClusterId = number;
export type GroupId = number;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface ToroidalRect extends Point {
  readonly width: number;
  readonly height: number;
}

export interface ResourceState {
  amount: bigint;
  energy: bigint;
  amountCapacityBonus: bigint;
  energyCapacityBonus: bigint;
}

export interface MotionState {
  px: bigint;
  py: bigint;
  density: bigint;
}

export type LifecycleState =
  | { kind: "active" }
  | {
      kind: "developing";
      geneHex: string;
      genePointer: number;
      motherId: ClusterId;
      familyPort: number;
      ant: { x: number; y: number; direction: 0 | 1 | 2 | 3 };
    }
  | { kind: "failed"; reason: string };

export interface ArmorState {
  up: bigint;
  right: bigint;
  down: bigint;
  left: bigint;
}

export interface Cluster {
  readonly id: ClusterId;
  rect: ToroidalRect;
  hp: bigint;
  maxHp: bigint;
  resources: ResourceState;
  motion: MotionState;
  armor: ArmorState;
  organelles: Uint16Array;
  organelleRuntime: Record<number, {
    enabled: boolean;
    direction?: "up" | "right" | "down" | "left";
    force?: number;
    mode?: string;
    channel?: number;
    inputChannel?: number;
    value?: number;
    operation?: string;
    range?: number;
    lastInput?: number;
    latchValue?: number;
    reproduceCostAmount?: number;
    reproduceCostEnergy?: number;
    cooldown?: number;
    lastProducedTick?: number;
    compileBuffer?: string;
    compileEmitted?: string;
  }>;
  lifecycle: LifecycleState;
  geneHex?: string;
  note?: string;
  normalGroupId?: GroupId;
  algaeState?: {
    lockedDirection?: "up" | "right" | "down" | "left";
    age: number;
  };
}

export interface NormalGroup {
  readonly id: GroupId;
  readonly code: number;
  readonly memberIds: ClusterId[];
  px: bigint;
  py: bigint;
}

export interface Seed {
  readonly id: number;
  readonly motherId: ClusterId | null;
  x: number;
  y: number;
  hp: bigint;
  amount: bigint;
  energy: bigint;
  readonly geneHex: string;
  dormantTicks: number;
  readonly familyPort: number;
  readonly initialPx: bigint;
  readonly initialPy: bigint;
  readonly driveQueue: Point[];
}

export interface MaterialValue {
  amount: bigint;
  energy: bigint;
}

export interface MoveIntent {
  readonly bodyId: string;
  readonly clusterIds: readonly ClusterId[];
  readonly dx: -1 | 0 | 1;
  readonly dy: -1 | 0 | 1;
  readonly thresholdX: bigint;
  readonly thresholdY: bigint;
  readonly px: bigint;
  readonly py: bigint;
}

export interface BodySnapshot {
  readonly id: string;
  readonly clusterIds: readonly ClusterId[];
  readonly rects: readonly ToroidalRect[];
  readonly mass: bigint;
  readonly px: bigint;
  readonly py: bigint;
  readonly thresholdX: bigint;
  readonly thresholdY: bigint;
  readonly immovable?: boolean;
}

export interface CollisionContact {
  readonly a: string;
  readonly b: string;
  readonly normalX: -1 | 0 | 1;
  readonly normalY: -1 | 0 | 1;
}

export interface MovementResolution {
  readonly acceptedBodies: ReadonlySet<string>;
  readonly displacementByBody: ReadonlyMap<string, Point>;
  readonly contacts: readonly CollisionContact[];
  readonly damageByCluster: ReadonlyMap<ClusterId, bigint>;
  readonly damageEvents: readonly DamageEvent[];
  readonly impulseByBody: ReadonlyMap<string, PointBigInt>;
}

export interface DamageEvent {
  readonly clusterId: ClusterId;
  readonly rawDamage: bigint;
  readonly normalX: -1 | 0 | 1;
  readonly normalY: -1 | 0 | 1;
}

export interface PointBigInt {
  readonly x: bigint;
  readonly y: bigint;
}

export interface ClusterView {
  id: ClusterId;
  x: number;
  y: number;
  width: number;
  height: number;
  hp: string;
  maxHp: string;
  amount: string;
  energy: string;
  px: string;
  py: string;
  organelles: number[];
  organelleRuntime?: Cluster["organelleRuntime"];
  geneHex?: string;
  note?: string;
}

export interface WorldSnapshot {
  tick: string;
  running: boolean;
  clusters: ClusterView[];
  seeds: Array<{ id: number; motherId: number | null; x: number; y: number; dormantTicks: number }>;
  materialCells: Array<{ x: number; y: number; amount: string; energy: string }>;
  customOrganelles: Array<{ code: number; name: string; color: string; ruleId: string }>;
  warning?: string;
}
