/// <reference lib="webworker" />
import { World } from "../engine/World";
import type { WorkerCommand, WorkerEvent } from "./protocol";
import { decodeProject, encodeProject } from "../persistence/projectCodec";
import type { SerializedWorldState } from "../engine/World";
import { TrustedRuleHost } from "../extensions/TrustedRuleHost";
import { encodeHeader, encodeInstruction } from "../genome/codec";
import { buildEcologyTemplate } from "../templates/ecologyTemplate";
import { buildTeachingMap } from "../templates/teachingMap";

const scope = self as DedicatedWorkerGlobalScope;
let world = new World(1n);
let running = false;
let ticksPerSecond = 5;
let timer: ReturnType<typeof setInterval> | undefined;
let undoStack: SerializedWorldState[] = [];
let redoStack: SerializedWorldState[] = [];
let metrics: Array<{ tick: string; clusters: number; seeds: number; totalHp: string; totalAmount: string; totalEnergy: string }> = [];
const trustedHost = new TrustedRuleHost();
let trustedScriptsApproved = false;
let stepInProgress = false;

const post = (event: WorkerEvent): void => scope.postMessage(event);
const snapshot = (): void => post({ type: "snapshot", snapshot: world.snapshot(running) });

let lastStepDuration = 0;
let scheduleToken = 0;

const stopTimer = (): void => {
  scheduleToken += 1;
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
};

const startTimer = (): void => {
  stopTimer();
  if (!running) return;
  const token = ++scheduleToken;
  lastStepDuration = 0;
  const loop = (): void => {
    if (token !== scheduleToken || !running) return;
    const started = performance.now();
    void executeOneStep(true).then(() => {
      lastStepDuration = performance.now() - started;
      if (token !== scheduleToken || !running) return;
      const target = Math.max(16, Math.floor(1000 / ticksPerSecond));
      const delay = Math.max(16, target - lastStepDuration);
      timer = setTimeout(loop, delay);
    });
  };
  loop();
};

const executeOneStep = async (emitSnapshot: boolean): Promise<void> => {
  if (stepInProgress) return;
  stepInProgress = true;
  try {
    const intents = trustedScriptsApproved ? await trustedHost.evaluate(world.snapshot(running)) : [];
    world.step(intents);
    recordMetrics();
    if (emitSnapshot) snapshot();
  } catch (error) {
    running = false;
    trustedScriptsApproved = false;
    trustedHost.dispose();
    stopTimer();
    post({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
      snapshot: world.snapshot(false),
    });
  } finally {
    stepInProgress = false;
  }
};

const resetTrustedScripts = (): void => {
  trustedScriptsApproved = false;
  trustedHost.dispose();
};

const announceUntrustedScripts = (): void => {
  const scriptIds = [...world.trustedRuleSources.values()].filter((script) => script.enabled).map((script) => script.id).sort();
  if (scriptIds.length > 0) post({ type: "trust-required", scriptIds, snapshot: world.snapshot(false) });
};

const recordMetrics = (): void => {
  let totalHp = 0n;
  let totalAmount = 0n;
  let totalEnergy = 0n;
  for (const cluster of world.clusters.values()) {
    totalHp += cluster.hp;
    totalAmount += cluster.resources.amount;
    totalEnergy += cluster.resources.energy;
  }
  metrics.push({
    tick: world.tick.toString(),
    clusters: world.clusters.size,
    seeds: world.seeds.size,
    totalHp: totalHp.toString(),
    totalAmount: totalAmount.toString(),
    totalEnergy: totalEnergy.toString(),
  });
  if (metrics.length > 100_000) metrics.shift();
};

const recordEdit = (before: SerializedWorldState): void => {
  undoStack.push(before);
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
};

const buildDeveloperTemplate = (seed: bigint): World => {
  const generated = new World(seed, {
    base: 48,
    noiseAmplitude: 16,
    noiseScale: 64,
    maximum: 255,
    sources: [{ x: 240, y: 123, intensity: 180, radius: 96 }],
  });
  const energy = generated.addCluster({ x: 80, y: 80, width: 5, height: 5 });
  generated.setOrganelle(energy.id, 1, 1, 0x0003);
  generated.setOrganelle(energy.id, 1, 2, 0x0005);
  generated.setOrganelle(energy.id, 2, 1, 0x000f, { enabled: true, direction: "right", force: 30 });
  generated.setClusterNote(energy.id, "能量链：光合器官产能，经储存访问端口驱动推进器，演示「产能→供能→推进」闭环。");
  energy.resources.amount = 20n;
  energy.resources.energy = 40n;

  const signal = generated.addCluster({ x: 120, y: 80, width: 5, height: 5 });
  generated.setOrganelle(signal.id, 1, 1, 0x0009, { enabled: true, operation: "constant", value: 3000 });
  generated.setOrganelle(signal.id, 3, 1, 0x0009, { enabled: true, operation: "constant", value: 2000 });
  generated.setOrganelle(signal.id, 2, 1, 0x0007, { enabled: true, channel: 5 });
  generated.setClusterNote(signal.id, "信号链：两个常量控制器经数字端口求和（3000+2000=5000），演示数字信号总线。");
  signal.resources.energy = 40n;

  const repro = generated.addCluster({ x: 160, y: 80, width: 5, height: 5 });
  generated.setOrganelle(repro.id, 2, 2, 0x0008, { enabled: true, channel: 3 });
  generated.setOrganelle(repro.id, 1, 2, 0x000c);
  generated.setOrganelle(repro.id, 3, 2, 0x0012, { enabled: true, direction: "right" });
  generated.setOrganelle(repro.id, 2, 1, 0x000b);
  const demoGene = encodeHeader({ generation: 0, familyPort: 3, purpose: 1, px: 0, py: 0, dormancy: 1 }) + encodeInstruction(0, 0xffff);
  generated.emitCompileSignal(repro.id, 1 * 5 + 2, demoGene);
  generated.setClusterNote(repro.id, "生殖链：初始基因片段已排队；第 1 Tick 由编译处理器校验并存储，第 2 Tick 由生殖端口在右侧生成休眠种子。");
  repro.resources.amount = 20n;
  repro.resources.energy = 40n;

  const groupA = generated.addCluster({ x: 80, y: 120, width: 5, height: 5 });
  generated.setOrganelle(groupA.id, 1, 1, 0x000e, { enabled: true, value: 7 });
  const groupB = generated.addCluster({ x: 86, y: 120, width: 5, height: 5 });
  generated.setOrganelle(groupB.id, 1, 1, 0x000e, { enabled: true, value: 7 });
  generated.createNormalGroup(groupA.id, groupB.id, 7);
  generated.setClusterNote(groupA.id, "编组 A：与右侧编组 B 通过编组器握手组成普通群组，可作为一个刚体整体移动。");
  generated.setClusterNote(groupB.id, "编组 B：与左侧编组 A 同为普通群组成员，运动与碰撞作为单一刚体处理。");
  groupA.resources.energy = 30n;
  groupB.resources.energy = 30n;

  const exchanger = generated.addCluster({ x: 120, y: 120, width: 5, height: 5 });
  generated.setOrganelle(exchanger.id, 2, 2, 0x0005);
  generated.setOrganelle(exchanger.id, 1, 2, 0x0006, { enabled: true, mode: "both", direction: "left", range: 2 });
  generated.setClusterNote(exchanger.id, "物质交换：吸收口在预设范围内吸收环境物质，输出口排出溢出，演示双向分离与范围吸收。");
  exchanger.resources.energy = 30n;

  const avoidance = generated.addCluster({ x: 160, y: 120, width: 7, height: 7 });
  generated.setOrganelle(avoidance.id, 1, 2, 0x000a, { enabled: true, operation: "proximity", direction: "right" });
  generated.setOrganelle(avoidance.id, 2, 2, 0x0007, { enabled: true, channel: 10 });
  generated.setOrganelle(avoidance.id, 3, 2, 0x0009, { enabled: true, operation: "not", inputChannel: 10, channel: 11 });
  generated.setOrganelle(avoidance.id, 4, 2, 0x0007, { enabled: true, channel: 11 });
  generated.setOrganelle(avoidance.id, 4, 3, 0x000f, { enabled: true, direction: "right", force: 30, inputChannel: 11 });
  generated.setOrganelle(avoidance.id, 5, 3, 0x0005, { enabled: true, mode: "energy" });
  generated.editMaterial(167, 122, 5n, 0n);
  generated.setClusterNote(avoidance.id, "避障组合：右向邻近传感器→NOT 控制器→频道 11 门控推进器。右侧标记物存在时停止，清除后恢复推进。");
  avoidance.resources.energy = 60n;

  const lightSeeker = generated.addCluster({ x: 200, y: 120, width: 7, height: 7 });
  generated.setOrganelle(lightSeeker.id, 1, 2, 0x000a, { enabled: true, operation: "light-gradient", direction: "right" });
  generated.setOrganelle(lightSeeker.id, 2, 2, 0x0007, { enabled: true, channel: 20 });
  generated.setOrganelle(lightSeeker.id, 3, 2, 0x0009, { enabled: true, operation: "compare", inputChannel: 20, channel: 21, value: 0 });
  generated.setOrganelle(lightSeeker.id, 4, 2, 0x0007, { enabled: true, channel: 21 });
  generated.setOrganelle(lightSeeker.id, 4, 3, 0x000f, { enabled: true, direction: "right", force: 30, inputChannel: 21 });
  generated.setOrganelle(lightSeeker.id, 5, 3, 0x0005, { enabled: true, mode: "energy" });
  generated.setClusterNote(lightSeeker.id, "单轴趋光：方向光差传感器比较左右边界光强；右侧更亮时经频道 21 启动右向推进器。");
  lightSeeker.resources.energy = 60n;

  const algae = generated.addAlgae(80, 160);
  generated.setClusterNote(algae.id, "藻类：结构识别型光合生物，逐 Tick 沿唯一亮向生长，长到 3×6 后强制分裂。");
  algae.resources.amount = 30n;
  algae.resources.energy = 60n;

  const jet = generated.addCluster({ x: 120, y: 160, width: 5, height: 5 });
  generated.setOrganelle(jet.id, 1, 2, 0x0005);
  generated.setOrganelle(jet.id, 2, 2, 0x0011, { enabled: true, direction: "up" });
  generated.setClusterNote(jet.id, "喷射：喷射器定向排出物质并产生反冲推进，演示资源消耗与动量交换。");
  jet.resources.amount = 30n;
  jet.resources.energy = 40n;

  const resourceRegulator = generated.addCluster({ x: 200, y: 160, width: 7, height: 7 });
  generated.setOrganelle(resourceRegulator.id, 1, 2, 0x000a, { enabled: true, operation: "amount" });
  generated.setOrganelle(resourceRegulator.id, 2, 2, 0x0007, { enabled: true, channel: 30 });
  generated.setOrganelle(resourceRegulator.id, 3, 2, 0x0009, { enabled: true, operation: "compare", inputChannel: 30, channel: 31, value: 20 });
  generated.setOrganelle(resourceRegulator.id, 4, 2, 0x0007, { enabled: true, channel: 31 });
  generated.setOrganelle(resourceRegulator.id, 5, 2, 0x0009, { enabled: true, operation: "not", inputChannel: 31, channel: 32 });
  generated.setOrganelle(resourceRegulator.id, 5, 3, 0x0007, { enabled: true, channel: 32 });
  generated.setOrganelle(resourceRegulator.id, 5, 4, 0x0006, { enabled: true, mode: "absorb", direction: "right", range: 2, inputChannel: 32 });
  generated.setOrganelle(resourceRegulator.id, 4, 4, 0x0005, { enabled: true, mode: "amount" });
  generated.editMaterial(207, 164, 40n, 0n);
  generated.setClusterNote(resourceRegulator.id, "资源限量吸收：物质量传感器→阈值比较→NOT→频道 32 门控交换器；物质超过 20 后停止吸收。");
  resourceRegulator.resources.energy = 60n;

  for (let index = 0; index < 40; index += 1) {
    generated.editMaterial(64 + (index * 17) % 192, 64 + (index * 29) % 192, BigInt(10 + index % 20), BigInt(20 + index % 40));
  }
  return generated;
};

scope.onmessage = async ({ data }: MessageEvent<WorkerCommand>) => {
  try {
    switch (data.type) {
      case "initialize":
        running = false;
        stopTimer();
        world = new World(BigInt(data.seed));
        resetTrustedScripts();
        metrics = [];
        post({ type: "ready", snapshot: world.snapshot(false) });
        break;
      case "new-project": {
        running = false;
        stopTimer();
        const seed = BigInt(data.seed);
        world = data.template === "ecology" ? buildEcologyTemplate(seed)
          : data.template === "developer" ? buildDeveloperTemplate(seed)
          : data.template === "teach" ? buildTeachingMap(seed)
          : new World(seed);
        resetTrustedScripts();
        undoStack = [];
        redoStack = [];
        metrics = [];
        snapshot();
        break;
      }
      case "run":
        undoStack = [];
        redoStack = [];
        running = true;
        startTimer();
        snapshot();
        break;
      case "pause":
        running = false;
        stopTimer();
        snapshot();
        break;
      case "step":
        undoStack = [];
        redoStack = [];
        running = false;
        stopTimer();
        await executeOneStep(false);
        snapshot();
        break;
      case "set-rate":
        ticksPerSecond = Math.min(60, Math.max(1, Math.floor(data.ticksPerSecond)));
        startTimer();
        break;
      case "add-cluster":
        running = false;
        stopTimer();
        {
          const before = world.exportState();
          world.addCluster(data.rect);
          recordEdit(before);
        }
        snapshot();
        break;
      case "remove-cluster":
        running = false;
        stopTimer();
        {
          const before = world.exportState();
          world.removeCluster(data.clusterId);
          recordEdit(before);
        }
        snapshot();
        break;
      case "set-cluster-note":
        running = false;
        stopTimer();
        {
          const before = world.exportState();
          world.setClusterNote(data.clusterId, data.note);
          recordEdit(before);
        }
        snapshot();
        break;
      case "add-template-seed":
        running = false;
        stopTimer();
        {
          const before = world.exportState();
          world.addTemplateSeed(data.geneHex, data.x, data.y);
          recordEdit(before);
        }
        snapshot();
        break;
      case "set-material":
        running = false;
        stopTimer();
        {
          const before = world.exportState();
          world.editMaterial(data.x, data.y, BigInt(data.amount), BigInt(data.energy));
          recordEdit(before);
        }
        snapshot();
        break;
      case "set-organelle":
        running = false;
        stopTimer();
        {
          const before = world.exportState();
          world.setOrganelle(data.clusterId, data.localX, data.localY, data.code, {
            enabled: true,
            direction: data.direction,
            channel: data.channel,
            inputChannel: data.inputChannel,
            value: data.value,
            force: data.force,
            operation: data.operation,
            mode: data.mode,
            range: data.range,
          });
          recordEdit(before);
        }
        snapshot();
        break;
      case "register-custom-organelle": {
        running = false;
        stopTimer();
        const before = world.exportState();
        try {
          if (data.definition.ruleId !== data.rule.id) throw new Error("器官 ruleId 必须与声明式规则 id 一致");
          if (!/^#[0-9A-Fa-f]{6}$/.test(data.definition.color)) throw new Error("器官颜色必须是 #RRGGBB");
          world.registerDeclarativeRule(data.rule);
          world.organelleRegistry.registerCustom({
            ...data.definition,
            buildAmount: BigInt(data.definition.buildAmount),
            buildEnergy: BigInt(data.definition.buildEnergy),
            recycleNumerator: BigInt(data.definition.recycleNumerator),
            recycleDenominator: BigInt(data.definition.recycleDenominator),
          });
        } catch (error) {
          world = World.fromState(before);
          throw error;
        }
        recordEdit(before);
        snapshot();
        break;
      }
      case "export-project": {
        const bytes = encodeProject(world);
        post({
          type: "project-data",
          bytes,
          fileName: `ClusterCA-tick-${world.tick}.clusterca`,
          purpose: data.purpose,
          snapshot: world.snapshot(running),
        });
        break;
      }
      case "import-project":
        running = false;
        stopTimer();
        world = decodeProject(data.bytes);
        resetTrustedScripts();
        metrics = [];
        undoStack = [];
        redoStack = [];
        snapshot();
        announceUntrustedScripts();
        break;
      case "undo-edit": {
        running = false;
        stopTimer();
        const previous = undoStack.pop();
        if (previous) {
          redoStack.push(world.exportState());
          world = World.fromState(previous);
        }
        snapshot();
        break;
      }
      case "redo-edit": {
        running = false;
        stopTimer();
        const next = redoStack.pop();
        if (next) {
          undoStack.push(world.exportState());
          world = World.fromState(next);
        }
        snapshot();
        break;
      }
      case "export-metrics": {
        const header = "tick,clusters,seeds,total_hp,total_amount,total_energy\r\n";
        const rows = metrics.map((row) => [row.tick, row.clusters, row.seeds, row.totalHp, row.totalAmount, row.totalEnergy].join(",")).join("\r\n");
        post({
          type: "export-data",
          bytes: new TextEncoder().encode(`\uFEFF${header}${rows}${rows ? "\r\n" : ""}`),
          fileName: `ClusterCA-metrics-tick-${world.tick}.csv`,
          mimeType: "text/csv;charset=utf-8",
          snapshot: world.snapshot(running),
        });
        break;
      }
      case "export-selection": {
        const cluster = world.clusters.get(data.clusterId);
        if (!cluster) throw new Error(`选中的胞团 ${data.clusterId} 不存在`);
        const state = world.exportState().clusters.find((item) => item.id === data.clusterId)!;
        const material = [];
        const light = [];
        for (let localY = 0; localY < cluster.rect.height; localY += 1) {
          for (let localX = 0; localX < cluster.rect.width; localX += 1) {
            const x = (cluster.rect.x + localX) % world.width;
            const y = (cluster.rect.y + localY) % world.height;
            const cell = world.material.get(x, y);
            material.push({ x, y, amount: cell.amount.toString(), energy: cell.energy.toString() });
            light.push({ x, y, intensity: world.light.sample(x, y) });
          }
        }
        const bytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, cluster: state, material, light }, null, 2));
        post({
          type: "export-data",
          bytes,
          fileName: `ClusterCA-cluster-${cluster.id}-tick-${world.tick}.json`,
          mimeType: "application/json",
          snapshot: world.snapshot(running),
        });
        break;
      }
      case "trust-project-scripts": {
        const scripts = [...world.trustedRuleSources.values()].filter((script) => script.enabled).sort((a, b) => a.id.localeCompare(b.id));
        await trustedHost.configure(scripts);
        trustedScriptsApproved = true;
        post({ type: "scripts-trusted", scriptIds: scripts.map((script) => script.id), snapshot: world.snapshot(false) });
        break;
      }
      case "request-snapshot":
        snapshot();
        break;
    }
  } catch (error) {
    running = false;
    stopTimer();
    post({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
      snapshot: world.snapshot(false),
    });
  }
};
