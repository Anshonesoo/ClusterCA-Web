import { DEFAULT_MOTION_K, MIN_CLUSTER_SIZE } from "./constants";
import type { Cluster, ClusterId, ToroidalRect } from "./types";
import { assertValidRect } from "../geometry/torus";

export const clusterArea = (cluster: Pick<Cluster, "rect">): bigint =>
  BigInt(cluster.rect.width) * BigInt(cluster.rect.height);

export const motionThreshold = (cluster: Pick<Cluster, "rect">, k = DEFAULT_MOTION_K): bigint =>
  clusterArea(cluster) * k;

export const amountCapacity = (cluster: Cluster): bigint => clusterArea(cluster) * 4n + cluster.resources.amountCapacityBonus;

export const energyCapacity = (cluster: Cluster): bigint => clusterArea(cluster) * 8n + cluster.resources.energyCapacityBonus;

export const isAlgaeStructure = (cluster: Pick<Cluster, "rect" | "organelles">): boolean => {
  const { width, height } = cluster.rect;
  if (!((width === 3 && height >= 3 && height <= 6) || (height === 3 && width >= 3 && width <= 6))) return false;
  if (cluster.organelles.length !== width * height) return false;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const perimeter = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (cluster.organelles[y * width + x] !== (perimeter ? 0x0001 : 0x0003)) return false;
    }
  }
  return true;
};

export const createAlgaeOrganelleGrid = (width: number, height: number): Uint16Array => {
  if (!((width === 3 && height >= 3 && height <= 6) || (height === 3 && width >= 3 && width <= 6))) {
    throw new RangeError("藻类尺寸必须为 3×N，N=3..6");
  }
  const grid = new Uint16Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      grid[y * width + x] = x === 0 || y === 0 || x === width - 1 || y === height - 1 ? 0x0001 : 0x0003;
    }
  }
  return grid;
};

export const createCluster = (id: ClusterId, rect: ToroidalRect): Cluster => {
  assertValidRect(rect);
  if (rect.width < MIN_CLUSTER_SIZE || rect.height < MIN_CLUSTER_SIZE) {
    throw new RangeError(`正式胞团最小尺寸为 ${MIN_CLUSTER_SIZE}×${MIN_CLUSTER_SIZE}`);
  }
  const organelles = new Uint16Array(rect.width * rect.height);
  const index = (x: number, y: number): number => y * rect.width + x;
  organelles[index(0, 0)] = 1;
  organelles[index(rect.width - 1, 0)] = 1;
  organelles[index(0, rect.height - 1)] = 1;
  organelles[index(rect.width - 1, rect.height - 1)] = 1;
  const area = BigInt(rect.width * rect.height);
  return {
    id,
    rect: { ...rect },
    hp: area * 4n,
    maxHp: area * 4n,
    health: 64,
    resources: {
      amount: 0n,
      energy: area,
      amountCapacityBonus: 0n,
      energyCapacityBonus: 0n,
    },
    motion: { px: 0n, py: 0n, density: 1n },
    armor: { up: 0n, right: 0n, down: 0n, left: 0n },
    organelles,
    organelleRuntime: {},
    lifecycle: { kind: "active" },
  };
};

export const validateClusterBoundary = (cluster: Cluster): void => {
  const { width, height } = cluster.rect;
  if (cluster.organelles.length !== width * height) throw new Error(`胞团 ${cluster.id} 器官网格尺寸不匹配`);
  const at = (x: number, y: number): number => cluster.organelles[y * width + x];
  const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)];
  if (corners.some((code) => code !== 1)) throw new Error(`胞团 ${cluster.id} 四角壳不完整`);
  if (isAlgaeStructure(cluster)) return;
  for (let x = 1; x < width - 1; x += 1) {
    if (at(x, 0) !== 0 || at(x, height - 1) !== 0) throw new Error(`胞团 ${cluster.id} 非角边界必须为空`);
  }
  for (let y = 1; y < height - 1; y += 1) {
    if (at(0, y) !== 0 || at(width - 1, y) !== 0) throw new Error(`胞团 ${cluster.id} 非角边界必须为空`);
  }
};
