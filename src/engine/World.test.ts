import { describe, expect, it } from "vitest";
import { World } from "./World";
import { encodeHeader, encodeInstruction } from "../genome/codec";
import { WORLD_WIDTH } from "../model/constants";

describe("World 确定性核心", () => {
  const endGenome = (dormancy = 0, px = 0, py = 0): string =>
    encodeHeader({ generation: 0, familyPort: 7, purpose: 0, px, py, dormancy }) + encodeInstruction(0, 0xffff);
  it("拒绝编辑产生的逻辑矩形重叠", () => {
    const world = new World();
    world.addCluster({ x: 1, y: 1, width: 3, height: 3 });
    expect(() => world.addCluster({ x: 3, y: 1, width: 3, height: 3 })).toThrow("重叠");
  });

  it("只在成功移动后扣除一个阈值", () => {
    const world = new World();
    const cluster = world.addCluster({ x: 1, y: 1, width: 3, height: 3 });
    cluster.motion.px = 180n;
    world.step();
    expect(cluster.rect.x).toBe(2);
    expect(cluster.motion.px).toBe(90n);
  });

  it("相同状态产生相同摘要", () => {
    const left = new World(42n);
    const right = new World(42n);
    left.addCluster({ x: 10, y: 10, width: 3, height: 3 }).motion.py = 90n;
    right.addCluster({ x: 10, y: 10, width: 3, height: 3 }).motion.py = 90n;
    left.editMaterial(20, 20, 10n, 25n);
    right.editMaterial(20, 20, 10n, 25n);
    left.step();
    right.step();
    expect(left.stateDigest()).toBe(right.stateDigest());
  });

  it("运动穿越环面边界", () => {
    const world = new World();
    const cluster = world.addCluster({ x: WORLD_WIDTH - 1, y: 10, width: 3, height: 3 });
    cluster.motion.px = 90n;
    world.step();
    expect(cluster.rect.x).toBe(0);
  });

  it("普通群组以成员矩形并集同步移动", () => {
    const world = new World();
    const left = world.addCluster({ x: 10, y: 10, width: 3, height: 3 });
    const right = world.addCluster({ x: 14, y: 10, width: 3, height: 3 });
    world.setOrganelle(left.id, 1, 1, 0x000e, { enabled: true, value: 8 });
    world.setOrganelle(right.id, 1, 1, 0x000e, { enabled: true, value: 8 });
    const group = world.createNormalGroup(left.id, right.id, 8);
    world.addGroupMomentum(group.id, 180n, 0n);
    world.step();
    expect(left.rect.x).toBe(11);
    expect(right.rect.x).toBe(15);
    expect(group.px).toBe(0n);
  });

  it("拒绝把远距离或已编组胞团直接合并", () => {
    const world = new World();
    const a = world.addCluster({ x: 0, y: 0, width: 3, height: 3 });
    const b = world.addCluster({ x: 4, y: 0, width: 3, height: 3 });
    const c = world.addCluster({ x: 20, y: 0, width: 3, height: 3 });
    world.setOrganelle(a.id, 1, 1, 0x000e, { enabled: true, value: 1 });
    world.setOrganelle(b.id, 1, 1, 0x000e, { enabled: true, value: 1 });
    world.createNormalGroup(a.id, b.id, 1);
    expect(() => world.createNormalGroup(b.id, c.id, 1)).toThrow("合并或重复");
  });

  it("光合作用按器官所在格的即时光强线性产能", () => {
    const world = new World(1n, { base: 64, noiseAmplitude: 0, noiseScale: 64, maximum: 255, sources: [] });
    const cluster = world.addCluster({ x: 10, y: 10, width: 3, height: 3 });
    cluster.organelles[4] = 0x0003;
    const before = cluster.resources.energy;
    world.step();
    expect(cluster.resources.energy).toBe(before - 1n + 4n);
  });

  it("藻类使用 4×面积移动阈值且不能编组", () => {
    const world = new World(1n, { base: 0, noiseAmplitude: 0, noiseScale: 64, maximum: 255, sources: [] });
    const algae = world.addAlgae(10, 10);
    const other = world.addCluster({ x: 14, y: 10, width: 3, height: 3 });
    algae.motion.px = 36n;
    world.step();
    expect(algae.rect.x).toBe(11);
    expect(algae.motion.px).toBe(0n);
    expect(() => world.createNormalGroup(algae.id, other.id, 1)).toThrow("藻类不能");
  });

  it("藻类锁定唯一亮向，长到 3×6 后强制分裂", () => {
    const world = new World(1n, {
      base: 0,
      noiseAmplitude: 0,
      noiseScale: 64,
      maximum: 255,
      sources: [{ x: 101, y: 80, intensity: 240, radius: 40 }],
    });
    const algae = world.addAlgae(100, 100);
    algae.resources.amount = 200n;
    algae.resources.energy = 200n;
    world.step();
    expect(algae.rect.height).toBe(4);
    expect(algae.algaeState?.lockedDirection).toBe("up");
    world.step();
    world.step();
    expect(algae.rect.height).toBe(6);
    world.step();
    expect(world.clusters.size).toBe(2);
    expect([...world.clusters.values()].every((cluster) => cluster.rect.width === 3 && cluster.rect.height === 3)).toBe(true);
    expect([...world.clusters.values()].every((cluster) => cluster.algaeState?.age === 0)).toBe(true);
  });

  it("休眠种子不维护也不移动，结束后 DRIVE 成功才耗能", () => {
    const world = new World();
    const mother = world.addCluster({ x: 10, y: 10, width: 3, height: 3 });
    mother.resources.energy = 30n;
    const seed = world.createSeed(mother.id, endGenome(1), 13, 11);
    world.transferResourceToSeed(mother.id, seed.id, 0n, 8n);
    world.queueSeedDrive(mother.id, seed.id, [{ x: 1, y: 0 }]);
    world.step();
    expect(seed.dormantTicks).toBe(0);
    expect(seed.x).toBe(13);
    expect(seed.energy).toBe(8n);
    world.step();
    expect(seed.x).toBe(14);
    expect(seed.energy).toBe(6n);
  });

  it("阻挡的 DRIVE 保留队列且不扣移动能量", () => {
    const world = new World();
    const mother = world.addCluster({ x: 10, y: 10, width: 3, height: 3 });
    mother.resources.energy = 30n;
    const seed = world.createSeed(mother.id, endGenome(), 13, 11);
    world.transferResourceToSeed(mother.id, seed.id, 0n, 8n);
    world.queueSeedDrive(mother.id, seed.id, [{ x: -1, y: 0 }]);
    world.step();
    expect(seed.x).toBe(13);
    expect(seed.energy).toBe(7n);
    expect(seed.driveQueue).toHaveLength(1);
  });

  it("种子展开为 3×3 后与母体形成家庭刚体并在 END 后脱离", () => {
    const world = new World();
    const mother = world.addCluster({ x: 10, y: 10, width: 3, height: 3 });
    mother.resources.amount = 10n;
    mother.resources.energy = 30n;
    const seed = world.createSeed(mother.id, endGenome(0, 180), 13, 11);
    world.transferResourceToSeed(mother.id, seed.id, 4n, 8n);
    world.queueSeedDrive(mother.id, seed.id, [{ x: 1, y: 0 }]);
    world.step();
    expect(world.seeds.size).toBe(0);
    const child = [...world.clusters.values()].find((cluster) => cluster.id !== mother.id)!;
    expect(child.lifecycle.kind).toBe("developing");
    world.step();
    expect(mother.rect.x).toBe(11);
    expect(child.rect.x).toBe(14);
    expect(child.lifecycle.kind).toBe("active");
  });

  it("遗传蚂蚁按显式增长码扩边，并先移动后写入器官", () => {
    const world = new World();
    const mother = world.addCluster({ x: 10, y: 10, width: 3, height: 3 });
    mother.resources.amount = 10n;
    mother.resources.energy = 30n;
    const gene = encodeHeader({ generation: 1, familyPort: 3, purpose: 0, px: 0, py: 0, dormancy: 0 })
      + encodeInstruction(9, 0xfff1)
      + encodeInstruction(2, 0x0003)
      + encodeInstruction(0, 0xffff);
    const seed = world.createSeed(mother.id, gene, 13, 11);
    world.transferResourceToSeed(mother.id, seed.id, 4n, 8n);
    world.queueSeedDrive(mother.id, seed.id, [{ x: 1, y: 0 }]);
    world.step();
    const child = [...world.clusters.values()].find((cluster) => cluster.id !== mother.id)!;
    child.resources.amount = 20n;
    child.resources.energy = 20n;
    world.step();
    expect(child.rect.width).toBe(4);
    expect(child.rect.x).toBe(13);
    world.step();
    expect(child.organelles[1 * 4 + 2]).toBe(0x0003);
    world.step();
    expect(child.lifecycle.kind).toBe("active");
  });

  it("无装甲高速碰撞使双方在 Tick 末死亡", () => {
    const world = new World();
    world.addCluster({ x: 0, y: 0, width: 5, height: 5 }).motion.px = 500n;
    world.addCluster({ x: 6, y: 0, width: 5, height: 5 }).motion.px = -500n;
    world.step();
    expect(world.clusters.size).toBe(0);
  });

  it("推进器按访问端口与方向运行，容量与面积绑定", () => {
    const world = new World(1n, { base: 0, noiseAmplitude: 0, noiseScale: 64, maximum: 255, sources: [] });
    const cluster = world.addCluster({ x: 20, y: 20, width: 5, height: 5 });
    world.setOrganelle(cluster.id, 2, 2, 0x0005);
    world.setOrganelle(cluster.id, 2, 1, 0x000f, { enabled: true, direction: "right", force: 90 });
    cluster.resources.energy = 20n;
    world.step();
    expect(cluster.resources.amountCapacityBonus).toBe(0n);
    expect(cluster.resources.energyCapacityBonus).toBe(0n);
    expect(cluster.maxHp).toBe(100n);
    expect(cluster.armor.right).toBe(0n);
    expect(cluster.motion.px).toBe(90n);
  });

  it("没有相邻储存访问端口的推进器不工作", () => {
    const world = new World();
    const cluster = world.addCluster({ x: 20, y: 20, width: 5, height: 5 });
    world.setOrganelle(cluster.id, 2, 2, 0x000f, { enabled: true, direction: "right", force: 20 });
    world.step();
    expect(cluster.motion.px).toBe(0n);
  });

  it("推进器可由相邻数字端口的指定频道确定性门控", () => {
    const world = new World(1n, { base: 0, noiseAmplitude: 0, noiseScale: 64, maximum: 255, sources: [] });
    const cluster = world.addCluster({ x: 20, y: 20, width: 5, height: 5 });
    world.setOrganelle(cluster.id, 2, 1, 0x0007, { enabled: true, channel: 7 });
    world.setOrganelle(cluster.id, 1, 1, 0x0009, { enabled: true, operation: "constant", channel: 7, value: 1 });
    world.setOrganelle(cluster.id, 2, 2, 0x000f, { enabled: true, direction: "right", force: 30, inputChannel: 7 });
    world.setOrganelle(cluster.id, 3, 2, 0x0005, { enabled: true, mode: "energy" });
    cluster.resources.energy = 20n;

    world.step();
    expect(cluster.motion.px).toBe(0n);
    world.step();
    expect(cluster.motion.px).toBe(30n);
  });

  it("喷射器使用相同数字门控且关闭时不排出物质", () => {
    const world = new World(1n, { base: 0, noiseAmplitude: 0, noiseScale: 64, maximum: 255, sources: [] });
    const cluster = world.addCluster({ x: 20, y: 20, width: 5, height: 5 });
    world.setOrganelle(cluster.id, 1, 1, 0x0007, { enabled: true, channel: 8 });
    world.setOrganelle(cluster.id, 1, 2, 0x0009, { enabled: true, operation: "constant", channel: 8, value: 1 });
    world.setOrganelle(cluster.id, 2, 1, 0x0011, { enabled: true, direction: "up", inputChannel: 8 });
    world.setOrganelle(cluster.id, 2, 2, 0x0005, { enabled: true, mode: "amount" });
    cluster.resources.amount = 10n;

    world.step();
    expect(world.material.get(22, 19).amount).toBe(0n);
    world.step();
    expect(world.material.get(22, 19).amount).toBe(1n);
    expect(cluster.motion.py).toBe(1n);
  });

  it("边缘物质交换器从外侧格吸收，并按端口能力排出溢出", () => {
    const world = new World();
    const cluster = world.addCluster({ x: 20, y: 20, width: 5, height: 5 });
    world.setOrganelle(cluster.id, 2, 2, 0x0005);
    world.setOrganelle(cluster.id, 1, 2, 0x0006, { enabled: true, direction: "left" });
    world.editMaterial(19, 22, 5n, 0n);
    world.step();
    expect(cluster.resources.amount).toBe(1n);
    expect(world.material.get(19, 22).amount).toBe(4n);

    cluster.resources.amount = 102n;
    world.step();
    expect(cluster.resources.amount).toBe(102n);
    expect(world.material.get(19, 22).amount).toBe(4n);
    expect(cluster.hp).toBe(99n);
  });

  it("自定义器官通过声明式规则输出经排序验证的意图", () => {
    const world = new World();
    world.organelleRegistry.registerCustom({
      code: 0x0100,
      kind: "controller",
      name: "确定性推进模块",
      color: "#ffffff",
      buildAmount: 1n,
      buildEnergy: 1n,
      recycleNumerator: 1n,
      recycleDenominator: 2n,
      ruleId: "custom:drive",
    });
    world.registerDeclarativeRule({
      id: "custom:drive",
      conditions: [{ field: "energy", operator: "gte", value: "1" }],
      actions: [
        { type: "change-resource", amount: "0", energy: "-1" },
        { type: "add-momentum", px: "30", py: "0" },
      ],
    });
    const cluster = world.addCluster({ x: 30, y: 30, width: 5, height: 5 });
    world.setOrganelle(cluster.id, 2, 2, 0x0100);
    world.step();
    expect(cluster.motion.px).toBe(30n);
    expect(cluster.resources.energy).toBe(22n);
    expect(world.snapshot().customOrganelles).toEqual([{ code: 0x0100, name: "确定性推进模块", color: "#ffffff", ruleId: "custom:drive" }]);
    const restored = World.fromState(world.exportState());
    expect(restored.organelleRegistry.get(0x0100)?.name).toBe("确定性推进模块");
    expect(restored.declarativeRules.has("custom:drive")).toBe(true);
  });

  it("可信脚本意图在 Tick 边界验证，非法资源结果回滚", () => {
    const world = new World();
    const cluster = world.addCluster({ x: 50, y: 50, width: 3, height: 3 });
    world.registerTrustedRuleSource({ id: "script:test", enabled: true, source: "export default () => []" });
    world.step([{ moduleId: "script:test", intentIndex: 0, intent: { type: "add-momentum", clusterId: cluster.id, px: "90", py: "0" } }]);
    expect(cluster.rect.x).toBe(51);
    expect(world.exportState().trustedRuleSources).toHaveLength(1);

    const tickBefore = world.tick;
    expect(() => world.step([{
      moduleId: "script:test",
      intentIndex: 0,
      intent: { type: "change-resource", clusterId: cluster.id, amount: "-1", energy: "0" },
    }])).toThrow("物质量为负");
    expect(world.tick).toBe(tickBefore);
    expect(world.clusters.get(cluster.id)?.resources.amount).toBe(0n);
  });

  it("数字信号经相邻端口延迟一 Tick，并在读取时饱和", () => {
    const world = new World();
    const cluster = world.addCluster({ x: 60, y: 60, width: 5, height: 5 });
    world.setOrganelle(cluster.id, 2, 1, 0x0007, { enabled: true, channel: 5 });
    world.setOrganelle(cluster.id, 1, 1, 0x0009, { enabled: true, operation: "constant", value: 20_000 });
    world.setOrganelle(cluster.id, 3, 1, 0x0009, { enabled: true, operation: "constant", value: 20_000 });
    expect(world.readDigitalSignal(cluster.id, 2 * 5 + 2)).toBe(0);
    world.step();
    expect(world.readDigitalSignal(cluster.id, 2 * 5 + 2)).toBe(0);
    world.step();
    expect(world.readDigitalSignal(cluster.id, 2 * 5 + 2)).toBe(32767);
  });

  it("编译信号队列能随项目状态精确恢复", () => {
    const world = new World();
    const cluster = world.addCluster({ x: 70, y: 70, width: 5, height: 5 });
    world.setOrganelle(cluster.id, 2, 1, 0x0008, { enabled: true, channel: 9 });
    world.setOrganelle(cluster.id, 2, 2, 0x000c);
    world.emitCompileSignal(cluster.id, 2 * 5 + 2, "A0FF");
    const restored = World.fromState(world.exportState());
    restored.step();
    expect(restored.readCompileSignal(cluster.id, 2 * 5 + 2).map((message) => message.payload)).toEqual(["A0FF"]);
  });

  it("编译信号通过边界生殖端口生成休眠种子，并在阻挡时保留缓冲", () => {
    const gene = endGenome(2, 12, -7);
    const world = new World();
    const mother = world.addCluster({ x: 10, y: 10, width: 5, height: 5 });
    world.setOrganelle(mother.id, 1, 2, 0x000c);
    world.setOrganelle(mother.id, 2, 2, 0x0008, { enabled: true, channel: 3 });
    world.setOrganelle(mother.id, 3, 2, 0x0012, { enabled: true, direction: "right" });
    world.emitCompileSignal(mother.id, 2 * 5 + 1, gene);

    world.step();

    const seed = [...world.seeds.values()][0];
    expect(seed).toMatchObject({ motherId: mother.id, x: 15, y: 12, dormantTicks: 2 });
    expect(seed.geneHex).toBe(gene);

    const blocked = new World();
    const blockedMother = blocked.addCluster({ x: 10, y: 10, width: 5, height: 5 });
    blocked.addCluster({ x: 15, y: 12, width: 3, height: 3 });
    blocked.setOrganelle(blockedMother.id, 1, 2, 0x000c);
    blocked.setOrganelle(blockedMother.id, 2, 2, 0x0008, { enabled: true, channel: 3 });
    blocked.setOrganelle(blockedMother.id, 3, 2, 0x0012, { enabled: true, direction: "right" });
    blocked.emitCompileSignal(blockedMother.id, 2 * 5 + 1, gene);

    blocked.step();

    expect(blocked.seeds.size).toBe(0);
    expect(blockedMother.organelleRuntime[2 * 5 + 3]?.compileBuffer).toBe(gene);
  });

  it("非边界生殖端口不能由编译信号生成休眠种子", () => {
    const world = new World();
    const mother = world.addCluster({ x: 30, y: 30, width: 5, height: 5 });
    world.setOrganelle(mother.id, 1, 1, 0x000c);
    world.setOrganelle(mother.id, 2, 1, 0x0008, { enabled: true, channel: 4 });
    world.setOrganelle(mother.id, 2, 2, 0x0012, { enabled: true, direction: "right" });
    world.emitCompileSignal(mother.id, 1 * 5 + 1, endGenome());

    world.step();

    expect(world.seeds.size).toBe(0);
  });

  it("母体向发育子体转移资源时不会产生负转移或超容量", () => {
    const world = new World();
    const mother = world.addCluster({ x: 10, y: 10, width: 3, height: 3 });
    const child = world.addCluster({ x: 20, y: 20, width: 3, height: 3 });
    child.lifecycle = { kind: "developing", geneHex: endGenome(), genePointer: 0, motherId: mother.id, familyPort: 7, ant: { x: 1, y: 1, direction: 0 } };

    mother.resources.amount = 10n;
    mother.resources.energy = 10n;
    child.resources.amount = 40n;
    child.resources.energy = 80n;
    world.transferResourceToDevelopingChild(mother.id, child.id, 5n, 5n);
    expect(mother.resources.amount).toBe(10n);
    expect(mother.resources.energy).toBe(10n);
    expect(child.resources.amount).toBe(40n);
    expect(child.resources.energy).toBe(80n);

    mother.resources.amount = -2n;
    mother.resources.energy = -3n;
    child.resources.amount = 35n;
    child.resources.energy = 71n;
    world.transferResourceToDevelopingChild(mother.id, child.id, 5n, 5n);
    expect(mother.resources.amount).toBe(-2n);
    expect(mother.resources.energy).toBe(-3n);
    expect(child.resources.amount).toBe(35n);
    expect(child.resources.energy).toBe(71n);

    mother.resources.amount = 10n;
    mother.resources.energy = 10n;
    world.transferResourceToDevelopingChild(mother.id, child.id, 5n, 5n);
    expect(mother.resources.amount).toBe(9n);
    expect(mother.resources.energy).toBe(9n);
    expect(child.resources.amount).toBe(36n);
    expect(child.resources.energy).toBe(72n);
  });

  it("匹配编组器在 Tick 末自动握手，移除编组器后成员退出", () => {
    const world = new World();
    const left = world.addCluster({ x: 100, y: 100, width: 3, height: 3 });
    const right = world.addCluster({ x: 104, y: 100, width: 3, height: 3 });
    world.setOrganelle(left.id, 1, 1, 0x000e, { enabled: true, value: 22 });
    world.setOrganelle(right.id, 1, 1, 0x000e, { enabled: true, value: 22 });
    world.step();
    expect(world.normalGroups.size).toBe(1);
    expect(left.normalGroupId).toBeDefined();
    world.setOrganelle(left.id, 1, 1, 0);
    world.step();
    expect(world.normalGroups.size).toBe(0);
    expect(left.normalGroupId).toBeUndefined();
    expect(right.normalGroupId).toBeUndefined();
  });

  it("外部收发器只在有效普通群组内向匹配频道广播", () => {
    const world = new World();
    const sender = world.addCluster({ x: 0, y: 200, width: 5, height: 5 });
    const receiver = world.addCluster({ x: 6, y: 200, width: 5, height: 5 });
    for (const cluster of [sender, receiver]) {
      world.setOrganelle(cluster.id, 1, 1, 0x000e, { enabled: true, value: 33 });
      world.setOrganelle(cluster.id, 1, 2, 0x000d, { enabled: true, channel: 7 });
      world.setOrganelle(cluster.id, 2, 2, 0x0007, { enabled: true, channel: 7 });
    }
    world.createNormalGroup(sender.id, receiver.id, 33);
    world.broadcastGroupDigital(sender.id, 123);
    expect(world.readDigitalSignal(receiver.id, 2 * 5 + 3)).toBe(0);
    world.step();
    expect(world.readDigitalSignal(receiver.id, 2 * 5 + 3)).toBe(123);

    const outsider = world.addCluster({ x: 30, y: 200, width: 5, height: 5 });
    expect(() => world.broadcastGroupDigital(outsider.id, 1)).toThrow("未编组");
  });

  it("控制器支持常量、加减、比较、与或非、延迟的稳定整数运算", () => {
    const world = new World(1n, { base: 0, noiseAmplitude: 0, noiseScale: 64, maximum: 255, sources: [] });
    const cluster = world.addCluster({ x: 20, y: 20, width: 9, height: 9 });
    world.setOrganelle(cluster.id, 1, 4, 0x0007, { enabled: true, channel: 5 });
    world.setOrganelle(cluster.id, 2, 4, 0x0009, { enabled: true, operation: "constant", value: 1000 });
    const ops: Array<[string, number, number]> = [
      ["add", 10, 500], ["sub", 11, 200], ["compare", 12, 500],
      ["and", 13, 0], ["or", 14, 0], ["not", 15, 0], ["delay", 16, 0],
    ];
    const expected: number[] = [1500, 800, 1, 0, 1, 0, 1000];
    ops.forEach(([op, channel, value], i) => {
      world.setOrganelle(cluster.id, 3, 1 + i, 0x0007, { enabled: true, channel });
      world.setOrganelle(cluster.id, 4, 1 + i, 0x0009, { enabled: true, operation: op, inputChannel: 5, value });
    });
    world.step();
    world.step();
    world.step();
    for (let i = 0; i < ops.length; i += 1) {
      const consumerIndex = (1 + i) * 9 + 4;
      expect(world.readDigitalChannel(cluster.id, consumerIndex, ops[i][1])).toBe(expected[i]);
    }
  });

  it("控制器脉冲按输入上升沿触发，锁存保持输出", () => {
    const world = new World(1n, { base: 0, noiseAmplitude: 0, noiseScale: 64, maximum: 255, sources: [] });
    const cluster = world.addCluster({ x: 40, y: 40, width: 7, height: 7 });
    world.setOrganelle(cluster.id, 1, 3, 0x0007, { enabled: true, channel: 5 });
    world.setOrganelle(cluster.id, 2, 3, 0x0009, { enabled: true, operation: "constant", value: 0 });
    const cinIndex = 3 * 7 + 2;
    world.setOrganelle(cluster.id, 1, 1, 0x0007, { enabled: true, channel: 6 });
    world.setOrganelle(cluster.id, 2, 1, 0x0009, { enabled: true, operation: "pulse", inputChannel: 5, value: 99 });
    world.setOrganelle(cluster.id, 1, 5, 0x0007, { enabled: true, channel: 7 });
    world.setOrganelle(cluster.id, 2, 5, 0x0009, { enabled: true, operation: "latch", inputChannel: 5, value: 77 });
    const pulseConsumer = 1 * 7 + 2;
    const latchConsumer = 5 * 7 + 2;
    world.step();
    world.clusters.get(cluster.id)!.organelleRuntime[cinIndex].value = 1000;
    world.step();
    world.step();
    world.step();
    expect(world.readDigitalChannel(cluster.id, pulseConsumer, 6)).toBe(99);
    expect(world.readDigitalChannel(cluster.id, latchConsumer, 7)).toBe(77);
    world.clusters.get(cluster.id)!.organelleRuntime[cinIndex].value = 0;
    world.step();
    expect(world.readDigitalChannel(cluster.id, latchConsumer, 7)).toBe(77);
  });

  it("传感器输出所在格光强", () => {
    const world = new World(1n, { base: 100, noiseAmplitude: 0, noiseScale: 64, maximum: 255, sources: [] });
    const cluster = world.addCluster({ x: 60, y: 60, width: 5, height: 5 });
    world.setOrganelle(cluster.id, 1, 2, 0x0007, { enabled: true, channel: 8 });
    world.setOrganelle(cluster.id, 2, 2, 0x000a, { enabled: true, operation: "light" });
    const consumer = 2 * 5 + 2;
    world.step();
    world.step();
    expect(world.readDigitalChannel(cluster.id, consumer, 8)).toBe(100);
  });

  it("方向光差传感器输出前后边界的有符号光强差", () => {
    const world = new World(1n, {
      base: 0,
      noiseAmplitude: 0,
      noiseScale: 64,
      maximum: 255,
      sources: [{ x: 30, y: 22, intensity: 200, radius: 20 }],
    });
    const cluster = world.addCluster({ x: 20, y: 20, width: 5, height: 5 });
    world.setOrganelle(cluster.id, 1, 2, 0x0007, { enabled: true, channel: 18 });
    world.setOrganelle(cluster.id, 2, 2, 0x000a, { enabled: true, operation: "light-gradient", direction: "right" });
    const consumer = 2 * 5 + 2;

    world.step();
    world.step();

    expect(world.readDigitalChannel(cluster.id, consumer, 18)).toBeGreaterThan(0);
  });

  it("方向光差经比较控制器启动单轴趋光推进", () => {
    const world = new World(1n, {
      base: 0,
      noiseAmplitude: 0,
      noiseScale: 64,
      maximum: 255,
      sources: [{ x: 240, y: 123, intensity: 180, radius: 96 }],
    });
    const cluster = world.addCluster({ x: 200, y: 120, width: 7, height: 7 });
    world.setOrganelle(cluster.id, 1, 2, 0x000a, { enabled: true, operation: "light-gradient", direction: "right" });
    world.setOrganelle(cluster.id, 2, 2, 0x0007, { enabled: true, channel: 20 });
    world.setOrganelle(cluster.id, 3, 2, 0x0009, { enabled: true, operation: "compare", inputChannel: 20, channel: 21, value: 0 });
    world.setOrganelle(cluster.id, 4, 2, 0x0007, { enabled: true, channel: 21 });
    world.setOrganelle(cluster.id, 4, 3, 0x000f, { enabled: true, direction: "right", force: 30, inputChannel: 21 });
    world.setOrganelle(cluster.id, 5, 3, 0x0005, { enabled: true, mode: "energy" });
    cluster.resources.energy = 60n;

    world.step();
    world.step();
    expect(cluster.motion.px).toBe(0n);
    world.step();
    expect(cluster.motion.px).toBe(30n);
  });

  it("传感器方向邻近探测检测前方物质", () => {
    const world = new World();
    const cluster = world.addCluster({ x: 70, y: 70, width: 5, height: 5 });
    world.setOrganelle(cluster.id, 1, 2, 0x0007, { enabled: true, channel: 9 });
    world.setOrganelle(cluster.id, 2, 2, 0x000a, { enabled: true, operation: "proximity", direction: "right" });
    const consumer = 2 * 5 + 2;
    world.editMaterial(75, 72, 5n, 0n);
    world.step();
    world.step();
    expect(world.readDigitalChannel(cluster.id, consumer, 9)).toBe(1);
    world.editMaterial(75, 72, 0n, 0n);
    world.step();
    world.step();
    expect(world.readDigitalChannel(cluster.id, consumer, 9)).toBe(0);
  });

  it("编译端口支持清空/覆盖并保存模板到编译存储器", () => {
    const world = new World();
    const mother = world.addCluster({ x: 10, y: 10, width: 5, height: 5 });
    world.setOrganelle(mother.id, 1, 2, 0x000c);
    world.setOrganelle(mother.id, 2, 2, 0x0008, { enabled: true, channel: 3 });
    world.setOrganelle(mother.id, 3, 2, 0x0012, { enabled: true, direction: "right" });
    world.setOrganelle(mother.id, 2, 1, 0x000b);
    const gene = endGenome(2, 12, -7);
    world.emitCompileSignal(mother.id, 1 * 5 + 2, "0011");
    world.step();
    expect(world.seeds.size).toBe(0);
    world.emitCompileSignal(mother.id, 1 * 5 + 2, "!CLEAR");
    world.step();
    world.emitCompileSignal(mother.id, 1 * 5 + 2, gene);
    world.step();
    expect(world.seeds.size).toBe(0);
    world.step();
    expect(world.seeds.size).toBe(1);
    expect(mother.organelleRuntime[1 * 5 + 2]?.compileBuffer).toBe(gene);
    expect(mother.organelleRuntime[2 * 5 + 1]?.compileBuffer).toBe(gene);
    expect(mother.organelleRuntime[2 * 5 + 1]?.compileEmitted).toBe(gene);
  });

  it("生殖端口拒绝绕过编译处理器的原始基因消息", () => {
    const world = new World();
    const mother = world.addCluster({ x: 90, y: 90, width: 5, height: 5 });
    world.setOrganelle(mother.id, 2, 2, 0x0008, { enabled: true, channel: 3 });
    world.setOrganelle(mother.id, 3, 2, 0x0012, { enabled: true, direction: "right" });
    world.setOrganelle(mother.id, 2, 1, 0x000b);
    world.emitCompileSignal(mother.id, 1 * 5 + 2, endGenome());

    world.step();

    expect(world.seeds.size).toBe(0);
    expect(mother.organelleRuntime[2 * 5 + 3]?.compileBuffer ?? "").toBe("");
  });

  it("储存访问端口按通道限制资源消费者", () => {
    const world = new World(1n, { base: 0, noiseAmplitude: 0, noiseScale: 64, maximum: 255, sources: [] });
    const cluster = world.addCluster({ x: 30, y: 30, width: 5, height: 5 });
    world.setOrganelle(cluster.id, 2, 2, 0x0005, { enabled: true, mode: "amount" });
    world.setOrganelle(cluster.id, 2, 1, 0x000f, { enabled: true, direction: "right", force: 30 });
    cluster.resources.energy = 20n;
    world.step();
    expect(cluster.motion.px).toBe(0n);
  });

  it("物质交换器可在预设范围内吸收物质", () => {
    const world = new World();
    const cluster = world.addCluster({ x: 50, y: 50, width: 5, height: 5 });
    world.setOrganelle(cluster.id, 2, 2, 0x0005);
    world.setOrganelle(cluster.id, 1, 2, 0x0006, { enabled: true, mode: "absorb", direction: "right", range: 3 });
    world.editMaterial(58, 52, 5n, 0n);
    world.step();
    expect(cluster.resources.amount).toBe(1n);
  });

  it("物质交换器可由数字频道门控且关闭时不吸收", () => {
    const world = new World(1n, { base: 0, noiseAmplitude: 0, noiseScale: 64, maximum: 255, sources: [] });
    const cluster = world.addCluster({ x: 50, y: 50, width: 5, height: 5 });
    world.setOrganelle(cluster.id, 2, 1, 0x0007, { enabled: true, channel: 9 });
    world.setOrganelle(cluster.id, 1, 1, 0x0009, { enabled: true, operation: "constant", channel: 9, value: 1 });
    world.setOrganelle(cluster.id, 2, 2, 0x0006, { enabled: true, mode: "absorb", direction: "right", range: 1, inputChannel: 9 });
    world.setOrganelle(cluster.id, 3, 2, 0x0005, { enabled: true, mode: "amount" });
    world.editMaterial(55, 52, 5n, 0n);

    world.step();
    expect(cluster.resources.amount).toBe(0n);
    world.step();
    expect(cluster.resources.amount).toBe(1n);
  });

  it("资源传感器与控制器把持续吸收限制在阈值及信号延迟余量内", () => {
    const world = new World(1n, { base: 0, noiseAmplitude: 0, noiseScale: 64, maximum: 255, sources: [] });
    const cluster = world.addCluster({ x: 200, y: 160, width: 7, height: 7 });
    world.setOrganelle(cluster.id, 1, 2, 0x000a, { enabled: true, operation: "amount" });
    world.setOrganelle(cluster.id, 2, 2, 0x0007, { enabled: true, channel: 30 });
    world.setOrganelle(cluster.id, 3, 2, 0x0009, { enabled: true, operation: "compare", inputChannel: 30, channel: 31, value: 20 });
    world.setOrganelle(cluster.id, 4, 2, 0x0007, { enabled: true, channel: 31 });
    world.setOrganelle(cluster.id, 5, 2, 0x0009, { enabled: true, operation: "not", inputChannel: 31, channel: 32 });
    world.setOrganelle(cluster.id, 5, 3, 0x0007, { enabled: true, channel: 32 });
    world.setOrganelle(cluster.id, 5, 4, 0x0006, { enabled: true, mode: "absorb", direction: "right", range: 2, inputChannel: 32 });
    world.setOrganelle(cluster.id, 4, 4, 0x0005, { enabled: true, mode: "amount" });
    world.editMaterial(207, 164, 40n, 0n);

    for (let tick = 0; tick < 40; tick += 1) world.step();

    expect(cluster.resources.amount).toBeGreaterThan(20n);
    expect(cluster.resources.amount).toBeLessThanOrEqual(24n);
  });

  it("外部收发器通信距离限制生效", () => {
    const world = new World();
    const sender = world.addCluster({ x: 0, y: 300, width: 5, height: 5 });
    const receiver = world.addCluster({ x: 6, y: 300, width: 5, height: 5 });
    for (const cluster of [sender, receiver]) {
      world.setOrganelle(cluster.id, 1, 1, 0x000e, { enabled: true, value: 33 });
      world.setOrganelle(cluster.id, 1, 2, 0x000d, { enabled: true, channel: 7, range: 0 });
      world.setOrganelle(cluster.id, 2, 2, 0x0007, { enabled: true, channel: 7 });
    }
    world.createNormalGroup(sender.id, receiver.id, 33);
    world.broadcastGroupDigital(sender.id, 123);
    world.step();
    expect(world.readDigitalSignal(receiver.id, 2 * 5 + 3)).toBe(0);

    world.clusters.get(sender.id)!.organelleRuntime[2 * 5 + 1].range = undefined;
    world.broadcastGroupDigital(sender.id, 456);
    world.step();
    expect(world.readDigitalSignal(receiver.id, 2 * 5 + 3)).toBe(456);
  });

  it("生殖端口按配置消耗母体资源产种，资源不足时不产并保留", () => {
    const world = new World();
    const mother = world.addCluster({ x: 10, y: 10, width: 5, height: 5 });
    mother.resources.amount = 0n;
    world.setOrganelle(mother.id, 1, 2, 0x000c);
    world.setOrganelle(mother.id, 2, 2, 0x0008, { enabled: true, channel: 3 });
    world.setOrganelle(mother.id, 3, 2, 0x0012, { enabled: true, direction: "right", reproduceCostAmount: 5 });
    world.emitCompileSignal(mother.id, 1 * 5 + 2, endGenome());
    world.step();
    expect(world.seeds.size).toBe(0);
    expect(mother.resources.amount).toBe(0n);
    mother.resources.amount = 20n;
    world.step();
    expect(world.seeds.size).toBe(1);
    expect(mother.resources.amount).toBe(15n);
  });

  it("健康值随血量升降，低健康值休眠、归零坏死", () => {
    const world = new World(1n, { base: 0, noiseAmplitude: 0, noiseScale: 64, maximum: 255, sources: [] });
    const cluster = world.addCluster({ x: 10, y: 10, width: 5, height: 5 });
    cluster.health = 40;
    world.step();
    expect(cluster.health).toBe(41);
    cluster.hp = 1n;
    cluster.health = 17;
    world.step();
    expect(cluster.health).toBe(16);
    expect(cluster.dormant).toBe(true);
    expect(world.clusters.size).toBe(1);
    cluster.hp = 1n;
    cluster.health = 1;
    world.step();
    expect(world.clusters.size).toBe(0);
  });
});
