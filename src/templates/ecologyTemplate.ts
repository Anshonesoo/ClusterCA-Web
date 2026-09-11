import { World } from "../engine/World";
import { wrap } from "../geometry/torus";

const MATERIAL_CELL_COUNT = 256;
const ALGAE_COUNT = 8;
const PATCH_COUNT = 4;
const PATCH_RADIUS = 32;

const createSequence = (seed: bigint): (() => number) => {
  let state = BigInt.asUintN(64, seed || 1n);
  return (): number => {
    state = BigInt.asUintN(64, state * 6364136223846793005n + 1442695040888963407n);
    return Number((state >> 32n) & 0x7fffffffn);
  };
};

export const buildEcologyTemplate = (seed: bigint): World => {
  const world = new World(seed, { base: 96, noiseAmplitude: 16, noiseScale: 64, maximum: 255, sources: [] });
  const next = createSequence(seed);
  const centerX = Math.floor(world.width / 2);
  const centerY = Math.floor(world.height / 2);

  const centerAlgae = world.addAlgae(centerX - 1, centerY - 1);
  centerAlgae.resources.amount = 30n;
  centerAlgae.resources.energy = 60n;

  const materialKeys = new Set<number>();
  const addMaterial = (xInput: number, yInput: number, amount: bigint, energy: bigint): boolean => {
    const x = wrap(xInput, world.width);
    const y = wrap(yInput, world.height);
    const key = y * world.width + x;
    if (materialKeys.has(key)) return false;
    materialKeys.add(key);
    world.editMaterial(x, y, amount, energy);
    return true;
  };

  addMaterial(centerX, centerY + 4, 40n, 100n);
  const patchCenters = Array.from({ length: PATCH_COUNT }, () => ({
    x: next() % world.width,
    y: next() % world.height,
  }));
  let attempts = 0;
  while (materialKeys.size < MATERIAL_CELL_COUNT && attempts < 100_000) {
    const patch = patchCenters[attempts % patchCenters.length];
    const x = patch.x + (next() % (PATCH_RADIUS * 2 + 1)) - PATCH_RADIUS;
    const y = patch.y + (next() % (PATCH_RADIUS * 2 + 1)) - PATCH_RADIUS;
    addMaterial(x, y, BigInt(8 + next() % 48), BigInt((next() % 161) - 40));
    attempts += 1;
  }
  if (materialKeys.size !== MATERIAL_CELL_COUNT) throw new Error("标准生态物质斑块生成失败");

  attempts = 0;
  while (world.clusters.size < ALGAE_COUNT && attempts < 1_024) {
    world.addAlgaeBatch([{ x: next() % world.width, y: next() % world.height }]);
    attempts += 1;
  }
  if (world.clusters.size !== ALGAE_COUNT) throw new Error("标准生态藻类生成失败");
  return world;
};

export const ecologyTemplateCounts = Object.freeze({ algae: ALGAE_COUNT, materialCells: MATERIAL_CELL_COUNT, patches: PATCH_COUNT });
