export const WORLD_WIDTH = 2048 as const;
export const WORLD_HEIGHT = 2048 as const;
export const CHUNK_SIZE = 64 as const;
export const CHUNKS_X = WORLD_WIDTH / CHUNK_SIZE;
export const CHUNKS_Y = WORLD_HEIGHT / CHUNK_SIZE;
export const DEFAULT_MOTION_K = 10n;
export const MIN_CLUSTER_SIZE = 3;
export const MAX_ORGANELLE_CODE = 0xffff;
export const BUILTIN_CODE_MAX = 0x00ff;
export const CUSTOM_CODE_MIN = 0x0100;
export const CUSTOM_CODE_MAX = 0xffef;
export const VM_CODE_MIN = 0xfff0;

export const assertWorldConfiguration = (): void => {
  if (WORLD_WIDTH % CHUNK_SIZE !== 0 || WORLD_HEIGHT % CHUNK_SIZE !== 0) {
    throw new Error("世界尺寸必须能被区块尺寸整除");
  }
};
