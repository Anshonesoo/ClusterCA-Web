import { describe, expect, it } from "vitest";
import { evaluateDeclarativeRule, type DeclarativeRule } from "./DeclarativeRule";

const context = { hp: 10n, maxHp: 20n, amount: 3n, energy: 8n, px: 0n, py: 0n, light: 64n, tick: 5n };

describe("声明式自定义规则", () => {
  it("条件成立时按声明顺序产生整数意图", () => {
    const rule: DeclarativeRule = {
      id: "custom:phototaxis",
      conditions: [{ field: "light", operator: "gte", value: "32" }],
      actions: [
        { type: "change-resource", amount: "0", energy: "2" },
        { type: "add-momentum", px: "3", py: "0" },
      ],
    };
    expect(evaluateDeclarativeRule(rule, context)).toEqual([
      { actionIndex: 0, action: { type: "change-resource", amount: 0n, energy: 2n } },
      { actionIndex: 1, action: { type: "add-momentum", px: 3n, py: 0n } },
    ]);
  });

  it("条件不成立时不产生意图", () => {
    expect(evaluateDeclarativeRule({
      id: "custom:none",
      conditions: [{ field: "amount", operator: "gt", value: "10" }],
      actions: [{ type: "add-momentum", px: "1", py: "0" }],
    }, context)).toEqual([]);
  });

  it("拒绝非整数与未知规则 ID 字符", () => {
    expect(() => evaluateDeclarativeRule({
      id: "bad id",
      conditions: [],
      actions: [{ type: "change-resource", amount: "0.5", energy: "0" }],
    }, context)).toThrow();
  });
});
