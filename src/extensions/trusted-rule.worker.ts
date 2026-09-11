/// <reference lib="webworker" />
import type { TrustedRuleIntent, TrustedRuleSource } from "./trustedTypes";
import type { WorldSnapshot } from "../model/types";

const scope = self as DedicatedWorkerGlobalScope;
const modules = new Map<string, (snapshot: Readonly<WorldSnapshot>) => readonly TrustedRuleIntent[] | Promise<readonly TrustedRuleIntent[]>>();
const moduleUrls: string[] = [];

Object.defineProperty(Math, "random", { value: () => { throw new Error("可信规则禁止使用 Math.random"); } });
Object.defineProperty(Date, "now", { value: () => { throw new Error("可信规则禁止读取系统时间"); } });
try {
  Object.defineProperty(performance, "now", { value: () => { throw new Error("可信规则禁止读取高精度时间"); } });
} catch {
  // 某些浏览器把 performance.now 定义为不可配置；模块仍不获得任何平台 API 引用。
}

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
};

const configure = async (scripts: TrustedRuleSource[]): Promise<void> => {
  modules.clear();
  for (const url of moduleUrls.splice(0)) URL.revokeObjectURL(url);
  for (const script of [...scripts].filter((item) => item.enabled).sort((a, b) => a.id.localeCompare(b.id))) {
    const wrapped = `${script.source}\n//# sourceURL=clusterca-rule:${script.id}`;
    const url = URL.createObjectURL(new Blob([wrapped], { type: "text/javascript" }));
    moduleUrls.push(url);
    const imported = await import(/* @vite-ignore */ url) as { default?: unknown; evaluate?: unknown };
    const evaluator = imported.default ?? imported.evaluate;
    if (typeof evaluator !== "function") throw new Error(`脚本 ${script.id} 必须默认导出函数或导出 evaluate 函数`);
    modules.set(script.id, evaluator as (snapshot: Readonly<WorldSnapshot>) => readonly TrustedRuleIntent[] | Promise<readonly TrustedRuleIntent[]>);
  }
};

scope.onmessage = async (event: MessageEvent<
  | { type: "configure"; requestId: number; scripts: TrustedRuleSource[] }
  | { type: "evaluate"; requestId: number; snapshot: WorldSnapshot }
>) => {
  const { data } = event;
  try {
    if (data.type === "configure") {
      await configure(data.scripts);
      scope.postMessage({ type: "configured", requestId: data.requestId });
      return;
    }
    const snapshot = deepFreeze(structuredClone(data.snapshot));
    const results: Array<{ moduleId: string; intentIndex: number; intent: TrustedRuleIntent }> = [];
    for (const [moduleId, evaluator] of [...modules.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const intents = await evaluator(snapshot);
      if (!Array.isArray(intents)) throw new Error(`脚本 ${moduleId} 必须返回意图数组`);
      for (let intentIndex = 0; intentIndex < intents.length; intentIndex += 1) {
        results.push({ moduleId, intentIndex, intent: intents[intentIndex] });
      }
    }
    scope.postMessage({ type: "evaluated", requestId: data.requestId, intents: results });
  } catch (error) {
    scope.postMessage({ type: "error", requestId: data.requestId, message: error instanceof Error ? error.message : String(error) });
  }
};
