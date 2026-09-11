export type RuleField = "hp" | "maxHp" | "amount" | "energy" | "px" | "py" | "light" | "tick";
export type ComparisonOperator = "eq" | "ne" | "lt" | "lte" | "gt" | "gte";

export interface RuleCondition {
  readonly field: RuleField;
  readonly operator: ComparisonOperator;
  readonly value: string;
}

export type DeclarativeAction =
  | { readonly type: "add-momentum"; readonly px: string; readonly py: string }
  | { readonly type: "change-resource"; readonly amount: string; readonly energy: string };

export interface DeclarativeRule {
  readonly id: string;
  readonly conditions: readonly RuleCondition[];
  readonly actions: readonly DeclarativeAction[];
}

export interface DeclarativeRuleContext {
  readonly hp: bigint;
  readonly maxHp: bigint;
  readonly amount: bigint;
  readonly energy: bigint;
  readonly px: bigint;
  readonly py: bigint;
  readonly light: bigint;
  readonly tick: bigint;
}

export interface DeclarativeIntent {
  readonly actionIndex: number;
  readonly action: { type: "add-momentum"; px: bigint; py: bigint } | { type: "change-resource"; amount: bigint; energy: bigint };
}

const FIELDS = new Set<RuleField>(["hp", "maxHp", "amount", "energy", "px", "py", "light", "tick"]);
const OPERATORS = new Set<ComparisonOperator>(["eq", "ne", "lt", "lte", "gt", "gte"]);

const parseInteger = (label: string, value: string): bigint => {
  if (!/^-?\d+$/.test(value)) throw new Error(`${label} 必须是十进制整数字符串`);
  return BigInt(value);
};

export const validateDeclarativeRule = (rule: DeclarativeRule): void => {
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(rule.id)) throw new Error("规则 ID 只能包含字母、数字、点、冒号、下划线和连字符");
  if (rule.conditions.length > 32 || rule.actions.length < 1 || rule.actions.length > 32) throw new Error("规则条件最多 32 个，动作必须为 1..32 个");
  for (const condition of rule.conditions) {
    if (!FIELDS.has(condition.field) || !OPERATORS.has(condition.operator)) throw new Error(`规则 ${rule.id} 含未知条件`);
    parseInteger(`规则 ${rule.id} 条件值`, condition.value);
  }
  for (const action of rule.actions) {
    if (action.type === "add-momentum") {
      parseInteger(`规则 ${rule.id} px`, action.px);
      parseInteger(`规则 ${rule.id} py`, action.py);
    } else if (action.type === "change-resource") {
      parseInteger(`规则 ${rule.id} amount`, action.amount);
      parseInteger(`规则 ${rule.id} energy`, action.energy);
    } else {
      throw new Error(`规则 ${rule.id} 含未知动作`);
    }
  }
};

const compare = (left: bigint, operator: ComparisonOperator, right: bigint): boolean => {
  switch (operator) {
    case "eq": return left === right;
    case "ne": return left !== right;
    case "lt": return left < right;
    case "lte": return left <= right;
    case "gt": return left > right;
    case "gte": return left >= right;
  }
};

export const evaluateDeclarativeRule = (rule: DeclarativeRule, context: DeclarativeRuleContext): DeclarativeIntent[] => {
  validateDeclarativeRule(rule);
  const matches = rule.conditions.every((condition) => compare(context[condition.field], condition.operator, BigInt(condition.value)));
  if (!matches) return [];
  return rule.actions.map((action, actionIndex) => ({
    actionIndex,
    action: action.type === "add-momentum"
      ? { type: "add-momentum", px: BigInt(action.px), py: BigInt(action.py) }
      : { type: "change-resource", amount: BigInt(action.amount), energy: BigInt(action.energy) },
  }));
};
