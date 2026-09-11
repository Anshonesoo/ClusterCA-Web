import type { WorldSnapshot } from "../model/types";
import type { AttributedTrustedIntent, TrustedRuleSource } from "./trustedTypes";

interface PendingRequest {
  resolve: (value: AttributedTrustedIntent[]) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class TrustedRuleHost {
  #worker: Worker | undefined;
  #requestId = 1;
  readonly #pending = new Map<number, PendingRequest>();

  async configure(scripts: TrustedRuleSource[]): Promise<void> {
    this.dispose();
    this.#worker = new Worker(new URL("./trusted-rule.worker.ts", import.meta.url), { type: "module" });
    this.#worker.onmessage = (event: MessageEvent<{ type: string; requestId: number; intents?: AttributedTrustedIntent[]; message?: string }>) => {
      const pending = this.#pending.get(event.data.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.#pending.delete(event.data.requestId);
      if (event.data.type === "error") pending.reject(new Error(event.data.message ?? "可信脚本执行失败"));
      else pending.resolve(event.data.intents ?? []);
    };
    await this.request({ type: "configure", scripts }, 2_000);
  }

  evaluate(snapshot: WorldSnapshot): Promise<AttributedTrustedIntent[]> {
    if (!this.#worker) return Promise.resolve([]);
    return this.request({ type: "evaluate", snapshot }, 50);
  }

  dispose(): void {
    this.#worker?.terminate();
    this.#worker = undefined;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("可信脚本运行器已停止"));
    }
    this.#pending.clear();
  }

  private request(payload: Record<string, unknown>, timeoutMs: number): Promise<AttributedTrustedIntent[]> {
    if (!this.#worker) return Promise.reject(new Error("可信脚本运行器未初始化"));
    const requestId = this.#requestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        this.dispose();
        reject(new Error(`可信脚本超过 ${timeoutMs} ms 时间限制`));
      }, timeoutMs);
      this.#pending.set(requestId, { resolve, reject, timer });
      this.#worker!.postMessage({ ...payload, requestId });
    });
  }
}
