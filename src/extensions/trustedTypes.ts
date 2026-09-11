import type { WorldSnapshot } from "../model/types";

export interface TrustedRuleSource {
  readonly id: string;
  readonly source: string;
  readonly enabled: boolean;
}

export type TrustedRuleIntent =
  | { type: "add-momentum"; clusterId: number; px: string; py: string }
  | { type: "change-resource"; clusterId: number; amount: string; energy: string };

export interface TrustedRuleModule {
  readonly id: string;
  evaluate(snapshot: Readonly<WorldSnapshot>): readonly TrustedRuleIntent[] | Promise<readonly TrustedRuleIntent[]>;
}

export interface AttributedTrustedIntent {
  readonly moduleId: string;
  readonly intentIndex: number;
  readonly intent: TrustedRuleIntent;
}

export const validateTrustedRuleSource = (script: TrustedRuleSource): void => {
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(script.id)) throw new Error("脚本 ID 非法");
  if (!script.source.trim() || script.source.length > 1_000_000) throw new Error(`脚本 ${script.id} 为空或超过 1 MB`);
};
