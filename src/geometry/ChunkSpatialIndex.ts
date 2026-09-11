import { CHUNKS_X, CHUNKS_Y, CHUNK_SIZE } from "../model/constants";
import type { ToroidalRect } from "../model/types";
import { splitToroidalRect } from "./torus";

const chunkKey = (chunkX: number, chunkY: number): number => chunkY * CHUNKS_X + chunkX;

export class ChunkSpatialIndex<T extends string | number> {
  readonly #buckets = new Map<number, Set<T>>();

  clear(): void {
    this.#buckets.clear();
  }

  insert(id: T, rects: readonly ToroidalRect[]): void {
    const touched = new Set<number>();
    for (const rect of rects) {
      for (const piece of splitToroidalRect(rect)) {
        const minChunkX = Math.floor(piece.x / CHUNK_SIZE);
        const maxChunkX = Math.floor((piece.x + piece.width - 1) / CHUNK_SIZE);
        const minChunkY = Math.floor(piece.y / CHUNK_SIZE);
        const maxChunkY = Math.floor((piece.y + piece.height - 1) / CHUNK_SIZE);
        for (let cy = minChunkY; cy <= maxChunkY; cy += 1) {
          for (let cx = minChunkX; cx <= maxChunkX; cx += 1) touched.add(chunkKey(cx, cy));
        }
      }
    }
    for (const key of touched) {
      const bucket = this.#buckets.get(key) ?? new Set<T>();
      bucket.add(id);
      this.#buckets.set(key, bucket);
    }
  }

  candidatePairs(compare: (a: T, b: T) => number): Array<readonly [T, T]> {
    const pairKeys = new Map<string, readonly [T, T]>();
    for (const key of [...this.#buckets.keys()].sort((a, b) => a - b)) {
      const ids = [...this.#buckets.get(key)!].sort(compare);
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          const left = ids[i];
          const right = ids[j];
          pairKeys.set(`${String(left)}\u0000${String(right)}`, [left, right]);
        }
      }
    }
    return [...pairKeys.values()].sort(([a1, b1], [a2, b2]) => compare(a1, a2) || compare(b1, b2));
  }

  bucketCount(): number {
    return this.#buckets.size;
  }

  static readonly dimensions = Object.freeze({ x: CHUNKS_X, y: CHUNKS_Y, size: CHUNK_SIZE });
}

if (CHUNKS_X !== 32 || CHUNKS_Y !== 32) throw new Error("默认区块网格必须为 32×32");
