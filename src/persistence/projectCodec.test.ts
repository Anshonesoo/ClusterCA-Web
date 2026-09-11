import { describe, expect, it } from "vitest";
import { World } from "../engine/World";
import { encodeHeader, encodeInstruction } from "../genome/codec";
import { WORLD_WIDTH } from "../model/constants";
import { decodeProject, encodeProject } from "./projectCodec";
import { createStoredZip, encodeUtf8, readStoredZip } from "./zipStore";

describe(".clusterca 项目文件", () => {
  it("生成标准 ZIP 头并还原条目", () => {
    const data = createStoredZip([{ name: "hello.txt", data: encodeUtf8("膜泡") }]);
    expect([...data.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(readStoredZip(data).has("hello.txt")).toBe(true);
  });

  it("保存加载后状态摘要一致", () => {
    const world = new World(7n);
    const cluster = world.addCluster({ x: WORLD_WIDTH - 1, y: 22, width: 3, height: 4 });
    cluster.motion.px = 93n;
    cluster.resources.amount = 17n;
    world.editMaterial(0, 0, 9n, -10n);
    world.step();
    const loaded = decodeProject(encodeProject(world));
    expect(loaded.stateDigest()).toBe(world.stateDigest());
  });

  it("恢复后继续运行仍一致", () => {
    const original = new World(7n);
    original.addCluster({ x: 30, y: 0, width: 3, height: 3 }).motion.py = 180n;
    original.editMaterial(31, 5, 0n, 35n);
    original.step();
    const loaded = decodeProject(encodeProject(original));
    original.step();
    loaded.step();
    expect(loaded.stateDigest()).toBe(original.stateDigest());
  });

  it("复杂运行态保存后连续多 Tick 与原世界逐步一致", () => {
    const original = new World(19n, {
      base: 64,
      noiseAmplitude: 8,
      noiseScale: 64,
      maximum: 255,
      sources: [{ x: 40, y: 40, intensity: 80, radius: 20 }],
    });
    const gene = encodeHeader({ generation: 1, familyPort: 5, purpose: 2, px: 0, py: 0, dormancy: 2 }) + encodeInstruction(0, 0xffff);
    const mother = original.addCluster({ x: 10, y: 10, width: 5, height: 5 });
    original.setOrganelle(mother.id, 2, 1, 0x000b);
    original.setOrganelle(mother.id, 1, 2, 0x000c);
    original.setOrganelle(mother.id, 2, 2, 0x0008, { enabled: true, channel: 5 });
    original.setOrganelle(mother.id, 3, 2, 0x0012, { enabled: true, direction: "right" });
    original.emitCompileSignal(mother.id, 1 * 5 + 2, gene);

    const groupA = original.addCluster({ x: 100, y: 100, width: 5, height: 5 });
    const groupB = original.addCluster({ x: 106, y: 100, width: 5, height: 5 });
    original.setOrganelle(groupA.id, 1, 1, 0x000e, { enabled: true, value: 77 });
    original.setOrganelle(groupB.id, 1, 1, 0x000e, { enabled: true, value: 77 });
    const group = original.createNormalGroup(groupA.id, groupB.id, 77);
    original.addGroupMomentum(group.id, 90n, 0n);
    original.addAlgae(180, 180).resources.amount = 30n;
    original.editMaterial(181, 186, 20n, 50n);

    original.organelleRegistry.registerCustom({
      code: 0x0100,
      kind: "controller",
      name: "存档测试器官",
      color: "#ffffff",
      buildAmount: 1n,
      buildEnergy: 1n,
      recycleNumerator: 1n,
      recycleDenominator: 2n,
      ruleId: "custom:save-test",
    });
    original.registerDeclarativeRule({
      id: "custom:save-test",
      conditions: [{ field: "tick", operator: "gte", value: "999999" }],
      actions: [{ type: "add-momentum", px: "1", py: "0" }],
    });
    original.registerTrustedRuleSource({ id: "trusted:save-test", enabled: false, source: "export default () => []" });
    original.step();

    const loaded = decodeProject(encodeProject(original));
    expect(loaded.stateDigest()).toBe(original.stateDigest());
    for (let tick = 0; tick < 12; tick += 1) {
      original.step();
      loaded.step();
      expect(loaded.stateDigest()).toBe(original.stateDigest());
    }
  });
});
