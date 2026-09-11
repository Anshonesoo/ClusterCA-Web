/**
 * 预留的性能探针契约。初版不实例化、不采样，也不提供性能面板。
 * 若后续启用，调用方必须同时提供活跃物质格、胞团数和平均胞团面积。
 */
export interface PerformanceProbeSample {
  readonly tick: string;
  readonly elapsedMilliseconds: number;
  readonly activeMaterialCells: number;
  readonly clusterCount: number;
  readonly averageClusterArea: number;
}

export interface PerformanceProbe {
  record(sample: PerformanceProbeSample): void;
}

export const NOOP_PERFORMANCE_PROBE: PerformanceProbe = Object.freeze({
  record: (_sample: PerformanceProbeSample): void => undefined,
});
