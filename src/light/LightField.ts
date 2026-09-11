import { WORLD_HEIGHT, WORLD_WIDTH } from "../model/constants";
import { toroidalDelta, wrap } from "../geometry/torus";

export interface FixedLightSource {
  readonly x: number;
  readonly y: number;
  readonly intensity: number;
  readonly radius: number;
}

export interface LightConfig {
  readonly base: number;
  readonly noiseAmplitude: number;
  readonly noiseScale: number;
  readonly maximum: number;
  readonly sources: readonly FixedLightSource[];
}

export const DEFAULT_LIGHT_CONFIG: LightConfig = Object.freeze({
  base: 48,
  noiseAmplitude: 32,
  noiseScale: 64,
  maximum: 255,
  sources: [],
});

const assertConfig = (config: LightConfig): void => {
  for (const [name, value] of Object.entries({
    base: config.base,
    noiseAmplitude: config.noiseAmplitude,
    noiseScale: config.noiseScale,
    maximum: config.maximum,
  })) {
    if (!Number.isInteger(value) || value < 0) throw new RangeError(`光参数 ${name} 必须是非负整数`);
  }
  if (config.noiseScale < 1 || WORLD_WIDTH % config.noiseScale !== 0 || WORLD_HEIGHT % config.noiseScale !== 0) {
    throw new RangeError("光噪声尺度必须是世界宽高的正整数因数");
  }
  for (const source of config.sources) {
    if (!Number.isInteger(source.intensity) || !Number.isInteger(source.radius) || source.intensity < 0 || source.radius < 1) {
      throw new RangeError("固定光源强度必须非负，半径必须为正整数");
    }
  }
};

const hashGrid = (seed: bigint, x: number, y: number): number => {
  let value = BigInt.asUintN(64, seed ^ BigInt(x) * 0x9e3779b185ebca87n ^ BigInt(y) * 0xc2b2ae3d27d4eb4fn);
  value ^= value >> 30n;
  value = BigInt.asUintN(64, value * 0xbf58476d1ce4e5b9n);
  value ^= value >> 27n;
  value = BigInt.asUintN(64, value * 0x94d049bb133111ebn);
  value ^= value >> 31n;
  return Number(value & 0xffn);
};

const lerpInteger = (a: number, b: number, fraction: number, scale: number): number =>
  Math.floor((a * (scale - fraction) + b * fraction) / scale);

export class LightField {
  readonly seed: bigint;
  readonly config: LightConfig;

  constructor(seed: bigint, config: LightConfig = DEFAULT_LIGHT_CONFIG) {
    assertConfig(config);
    this.seed = seed;
    this.config = Object.freeze({ ...config, sources: config.sources.map((source) => Object.freeze({ ...source })) });
  }

  sample(xInput: number, yInput: number): number {
    const x = wrap(xInput, WORLD_WIDTH);
    const y = wrap(yInput, WORLD_HEIGHT);
    const scale = this.config.noiseScale;
    const gridCountX = WORLD_WIDTH / scale;
    const gridCountY = WORLD_HEIGHT / scale;
    const gx = Math.floor(x / scale);
    const gy = Math.floor(y / scale);
    const fx = x % scale;
    const fy = y % scale;
    const top = lerpInteger(
      hashGrid(this.seed, gx, gy),
      hashGrid(this.seed, (gx + 1) % gridCountX, gy),
      fx,
      scale,
    );
    const bottom = lerpInteger(
      hashGrid(this.seed, gx, (gy + 1) % gridCountY),
      hashGrid(this.seed, (gx + 1) % gridCountX, (gy + 1) % gridCountY),
      fx,
      scale,
    );
    const noise = lerpInteger(top, bottom, fy, scale);
    let result = this.config.base + Math.floor((noise * this.config.noiseAmplitude) / 255);
    for (const source of this.config.sources) {
      const dx = Math.abs(toroidalDelta(source.x, x, WORLD_WIDTH));
      const dy = Math.abs(toroidalDelta(source.y, y, WORLD_HEIGHT));
      const distance = Math.max(dx, dy);
      if (distance < source.radius) result += Math.floor((source.intensity * (source.radius - distance)) / source.radius);
    }
    return Math.max(0, Math.min(this.config.maximum, result));
  }
}
