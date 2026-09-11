import { resolveMovements } from "../collision/solver";
import { toroidalRectChebyshevDistance, toroidalRectsOverlap, translateRect, wrap, splitToroidalRect } from "../geometry/torus";
import { SparseMaterialLayer } from "../material/SparseMaterialLayer";
import { createAlgaeOrganelleGrid, createCluster, clusterArea, energyCapacity, amountCapacity, isAlgaeStructure, motionThreshold, validateClusterBoundary } from "../model/cluster";
import { CHUNK_SIZE, CHUNKS_X, CHUNKS_Y, WORLD_HEIGHT, WORLD_WIDTH } from "../model/constants";
import type { BodySnapshot, Cluster, ClusterId, MoveIntent, NormalGroup, Point, Seed, ToroidalRect, WorldSnapshot } from "../model/types";
import { absBigInt, bigintSqrt, ceilDiv } from "./math";
import { DEFAULT_LIGHT_CONFIG, LightField, type LightConfig } from "../light/LightField";
import { directionVector, grownAlgaeRect, isAlgaeAtMaximum, sampleAlgaeSides, uniqueBrightestDirection, type AlgaeDirection } from "../rules/algae";
import { decodeGenome } from "../genome/codec";
import { executeGenomeInstruction } from "../genome/vm";
import { OrganelleRegistry, type OrganelleKind } from "../model/organelles";
import { evaluateDeclarativeRule, validateDeclarativeRule, type DeclarativeIntent, type DeclarativeRule } from "../extensions/DeclarativeRule";
import { validateTrustedRuleSource, type AttributedTrustedIntent, type TrustedRuleSource } from "../extensions/trustedTypes";
import { SignalBus, type CompileMessage, type SerializedSignalBus } from "../signals/SignalBus";

const directionForCounter = (counter: bigint, threshold: bigint): -1 | 0 | 1 => {
  if (counter >= threshold) return 1;
  if (counter <= -threshold) return -1;
  return 0;
};

const stableClusterSort = (a: Cluster, b: Cluster): number => a.id - b.id;

const clamp16 = (value: number): number => Math.max(-32768, Math.min(32767, value));

const oppositeDirection = (direction: AlgaeDirection): AlgaeDirection => {
  if (direction === "up") return "down";
  if (direction === "right") return "left";
  if (direction === "down") return "up";
  return "right";
};

const bigintClamp16 = (value: bigint): number => {
  if (value > 32767n) return 32767;
  if (value < -32768n) return -32768;
  return Number(value);
};

const minBigInt = (...values: bigint[]): bigint => values.reduce((a, b) => (a < b ? a : b));

const nonNegative = (value: bigint): bigint => value > 0n ? value : 0n;

export class World {
  readonly width = WORLD_WIDTH;
  readonly height = WORLD_HEIGHT;
  readonly topology = "torus" as const;
  readonly material = new SparseMaterialLayer();
  readonly clusters = new Map<ClusterId, Cluster>();
  readonly normalGroups = new Map<number, NormalGroup>();
  readonly seeds = new Map<number, Seed>();
  readonly organelleRegistry = new OrganelleRegistry();
  readonly declarativeRules = new Map<string, DeclarativeRule>();
  readonly trustedRuleSources = new Map<string, TrustedRuleSource>();
  readonly signalBuses = new Map<ClusterId, SignalBus>();
  tick = 0n;
  seed: bigint;
  light: LightField;
  #nextClusterId = 1;
  #nextGroupId = 1;
  #nextSeedId = 1;
  #reproductionIntents: Array<{
    clusterId: ClusterId;
    organelleIndex: number;
    geneHex: string;
    direction: AlgaeDirection;
    costAmount: bigint;
    costEnergy: bigint;
  }> = [];
  #chunkClusters = new Map<number, Cluster[]>();
  lastWarning: string | undefined;

  constructor(seed = 1n, lightConfig: LightConfig = DEFAULT_LIGHT_CONFIG) {
    this.seed = seed;
    this.light = new LightField(seed, lightConfig);
  }

  addCluster(rect: ToroidalRect): Cluster {
    const cluster = createCluster(this.#nextClusterId, rect);
    this.assertRectFree(cluster.rect);
    validateClusterBoundary(cluster);
    this.clusters.set(cluster.id, cluster);
    this.signalBuses.set(cluster.id, new SignalBus());
    this.#nextClusterId += 1;
    return cluster;
  }

  addAlgae(x: number, y: number): Cluster {
    const cluster = this.addCluster({ x, y, width: 3, height: 3 });
    cluster.organelles = createAlgaeOrganelleGrid(3, 3);
    cluster.algaeState = { age: 0 };
    validateClusterBoundary(cluster);
    return cluster;
  }

  addAlgaeBatch(candidates: ReadonlyArray<{ x: number; y: number }>): number {
    const occupied = new Set<string>();
    for (const cluster of this.clusters.values()) {
      for (let y = 0; y < cluster.rect.height; y += 1) {
        for (let x = 0; x < cluster.rect.width; x += 1) {
          occupied.add(`${wrap(cluster.rect.x + x, WORLD_WIDTH)},${wrap(cluster.rect.y + y, WORLD_HEIGHT)}`);
        }
      }
    }
    let created = 0;
    for (const candidate of candidates) {
      const originX = wrap(candidate.x, WORLD_WIDTH);
      const originY = wrap(candidate.y, WORLD_HEIGHT);
      let free = true;
      for (let dy = 0; dy < 3 && free; dy += 1) {
        for (let dx = 0; dx < 3; dx += 1) {
          const key = `${wrap(originX + dx, WORLD_WIDTH)},${wrap(originY + dy, WORLD_HEIGHT)}`;
          if (occupied.has(key)) {
            free = false;
            break;
          }
        }
      }
      if (!free) continue;
      const cluster = createCluster(this.#nextClusterId, { x: originX, y: originY, width: 3, height: 3 });
      cluster.organelles = createAlgaeOrganelleGrid(3, 3);
      cluster.algaeState = { age: 0 };
      cluster.resources.amount = 30n;
      cluster.resources.energy = 60n;
      for (let dy = 0; dy < 3; dy += 1) {
        for (let dx = 0; dx < 3; dx += 1) {
          occupied.add(`${wrap(originX + dx, WORLD_WIDTH)},${wrap(originY + dy, WORLD_HEIGHT)}`);
        }
      }
      validateClusterBoundary(cluster);
      this.clusters.set(cluster.id, cluster);
      this.signalBuses.set(cluster.id, new SignalBus());
      this.#nextClusterId += 1;
      created += 1;
    }
    return created;
  }

  removeCluster(id: ClusterId): void {
    const cluster = this.clusters.get(id);
    if (cluster?.normalGroupId !== undefined) this.removeMemberFromGroup(cluster.normalGroupId, id);
    this.clusters.delete(id);
    this.signalBuses.delete(id);
  }

  setClusterNote(id: ClusterId, note: string): void {
    const cluster = this.clusters.get(id);
    if (!cluster) throw new Error(`胞团 ${id} 不存在`);
    cluster.note = note.trim() === "" ? undefined : note.trim();
  }

  createNormalGroup(leftId: ClusterId, rightId: ClusterId, code: number): NormalGroup {
    if (!Number.isInteger(code) || code < 0 || code > 0xffff) throw new RangeError("群组码必须为 uint16");
    const left = this.clusters.get(leftId);
    const right = this.clusters.get(rightId);
    if (!left || !right || leftId === rightId) throw new Error("编组双方必须是两个现存胞团");
    if (left.normalGroupId !== undefined || right.normalGroupId !== undefined) throw new Error("不能合并或重复加入普通群组");
    if (left.lifecycle.kind !== "active" || right.lifecycle.kind !== "active") throw new Error("种子或发育胞团不能加入普通群组");
    if (isAlgaeStructure(left) || isAlgaeStructure(right)) throw new Error("藻类不能加入普通群组");
    if (toroidalRectChebyshevDistance(left.rect, right.rect) > 1) throw new Error("编组双方矩形距离必须不超过 1");
    const group: NormalGroup = {
      id: this.#nextGroupId,
      code,
      memberIds: [leftId, rightId].sort((a, b) => a - b),
      px: left.motion.px + right.motion.px,
      py: left.motion.py + right.motion.py,
    };
    left.motion.px = 0n;
    left.motion.py = 0n;
    right.motion.px = 0n;
    right.motion.py = 0n;
    left.normalGroupId = group.id;
    right.normalGroupId = group.id;
    this.normalGroups.set(group.id, group);
    this.#nextGroupId += 1;
    return group;
  }

  addGroupMomentum(groupId: number, px: bigint, py: bigint): void {
    const group = this.normalGroups.get(groupId);
    if (!group) throw new Error(`普通群组 ${groupId} 不存在`);
    group.px += px;
    group.py += py;
  }

  createSeed(motherId: ClusterId, geneHex: string, x: number, y: number): Seed {
    const mother = this.clusters.get(motherId);
    if (!mother) throw new Error(`母体 ${motherId} 不存在`);
    const genome = decodeGenome(geneHex);
    const point = { x: wrap(x, WORLD_WIDTH), y: wrap(y, WORLD_HEIGHT) };
    const seedRect = { ...point, width: 1, height: 1 };
    this.assertRectFree(seedRect);
    if (this.seedAt(point.x, point.y)) throw new Error("目标格已有种子");
    if (toroidalRectChebyshevDistance(mother.rect, seedRect) > 0) throw new Error("种子必须创建在母体边界外相邻格");
    const seed: Seed = {
      id: this.#nextSeedId,
      motherId,
      x: point.x,
      y: point.y,
      hp: 4n,
      amount: 0n,
      energy: 0n,
      geneHex: genome.normalizedHex,
      dormantTicks: genome.header.dormancy,
      familyPort: genome.header.familyPort,
      initialPx: BigInt(genome.header.px),
      initialPy: BigInt(genome.header.py),
      driveQueue: [],
    };
    this.seeds.set(seed.id, seed);
    this.#nextSeedId += 1;
    return seed;
  }

  addTemplateSeed(geneHex: string, x: number, y: number): Seed {
    const genome = decodeGenome(geneHex);
    const point = { x: wrap(x, WORLD_WIDTH), y: wrap(y, WORLD_HEIGHT) };
    const rect = { ...point, width: 1, height: 1 };
    this.assertRectFree(rect);
    if (this.seedAt(point.x, point.y)) throw new Error("目标格已有种子");
    const seed: Seed = {
      id: this.#nextSeedId,
      motherId: null,
      x: point.x,
      y: point.y,
      hp: 4n,
      amount: 8n,
      energy: 8n,
      geneHex: genome.normalizedHex,
      dormantTicks: 0,
      familyPort: genome.header.familyPort,
      initialPx: BigInt(genome.header.px),
      initialPy: BigInt(genome.header.py),
      driveQueue: [],
    };
    this.seeds.set(seed.id, seed);
    this.#nextSeedId += 1;
    return seed;
  }

  transferResourceToSeed(motherId: ClusterId, seedId: number, amount: bigint, energy: bigint): void {
    if (amount < 0n || energy < 0n) throw new RangeError("RESOURCE 转移量必须非负");
    const mother = this.clusters.get(motherId);
    const seed = this.seeds.get(seedId);
    if (!mother || !seed || seed.motherId !== motherId) throw new Error("母体与种子关系无效");
    const movedAmount = minBigInt(amount, nonNegative(mother.resources.amount), nonNegative(4n - seed.amount));
    const movedEnergy = minBigInt(energy, nonNegative(mother.resources.energy), nonNegative(8n - seed.energy));
    mother.resources.amount -= movedAmount;
    mother.resources.energy -= movedEnergy;
    seed.amount += movedAmount;
    seed.energy += movedEnergy;
  }

  transferResourceToDevelopingChild(motherId: ClusterId, childId: ClusterId, amount: bigint, energy: bigint): void {
    if (amount < 0n || energy < 0n) throw new RangeError("RESOURCE 转移量必须非负");
    const mother = this.clusters.get(motherId);
    const child = this.clusters.get(childId);
    if (!mother || !child || child.lifecycle.kind !== "developing" || child.lifecycle.motherId !== motherId) {
      throw new Error("母体与发育子体关系无效");
    }
    const movedAmount = minBigInt(amount, nonNegative(mother.resources.amount), nonNegative(amountCapacity(child) - child.resources.amount));
    const movedEnergy = minBigInt(energy, nonNegative(mother.resources.energy), nonNegative(energyCapacity(child) - absBigInt(child.resources.energy)));
    mother.resources.amount -= movedAmount;
    mother.resources.energy -= movedEnergy;
    child.resources.amount += movedAmount;
    child.resources.energy += movedEnergy;
  }

  queueSeedDrive(motherId: ClusterId, seedId: number, moves: readonly Point[]): void {
    const seed = this.seeds.get(seedId);
    if (!seed || seed.motherId !== motherId || !this.clusters.has(motherId)) throw new Error("母体与种子关系无效");
    for (const move of moves) {
      if (!Number.isInteger(move.x) || !Number.isInteger(move.y) || Math.abs(move.x) > 1 || Math.abs(move.y) > 1) {
        throw new RangeError("DRIVE 的每一步必须位于 -1..1");
      }
      if (move.x === 0 && move.y === 0) continue;
      seed.driveQueue.push({ x: move.x, y: move.y });
    }
  }

  emitDigitalSignal(clusterId: ClusterId, sourceIndex: number, value: number): void {
    const cluster = this.requireCluster(clusterId);
    const portIndex = this.firstAdjacentPortIndex(cluster, sourceIndex, 0x0007);
    if (portIndex === undefined) throw new Error("数字信号源必须四邻接数字信号端口");
    const channel = cluster.organelleRuntime[portIndex]?.channel ?? 0;
    const localX = sourceIndex % cluster.rect.width;
    const localY = Math.floor(sourceIndex / cluster.rect.width);
    this.signalBuses.get(clusterId)!.sendDigital({ clusterId, localX, localY, channel, value });
  }

  readDigitalSignal(clusterId: ClusterId, consumerIndex: number): number {
    const cluster = this.requireCluster(clusterId);
    const portIndex = this.firstAdjacentPortIndex(cluster, consumerIndex, 0x0007);
    if (portIndex === undefined) throw new Error("数字信号消费者必须四邻接数字信号端口");
    return this.signalBuses.get(clusterId)!.readDigital(cluster.organelleRuntime[portIndex]?.channel ?? 0);
  }

  emitDigitalChannel(clusterId: ClusterId, sourceIndex: number, channel: number, value: number): void {
    const cluster = this.requireCluster(clusterId);
    const portIndex = this.firstAdjacentPortIndex(cluster, sourceIndex, 0x0007);
    if (portIndex === undefined) throw new Error("数字信号源必须四邻接数字信号端口");
    if (!Number.isInteger(value) || value < -32768 || value > 32767) throw new RangeError("数字信号必须为 int16");
    const localX = sourceIndex % cluster.rect.width;
    const localY = Math.floor(sourceIndex / cluster.rect.width);
    this.signalBuses.get(clusterId)!.sendDigital({ clusterId, localX, localY, channel, value });
  }

  readDigitalChannel(clusterId: ClusterId, consumerIndex: number, channel: number): number {
    const cluster = this.requireCluster(clusterId);
    const portIndex = this.firstAdjacentPortIndex(cluster, consumerIndex, 0x0007);
    if (portIndex === undefined) throw new Error("数字信号消费者必须四邻接数字信号端口");
    return this.signalBuses.get(clusterId)!.readDigital(channel);
  }

  emitCompileSignal(clusterId: ClusterId, sourceIndex: number, payload: string): void {
    const cluster = this.requireCluster(clusterId);
    const portIndex = this.firstAdjacentPortIndex(cluster, sourceIndex, 0x0008);
    if (portIndex === undefined) throw new Error("编译信号源必须四邻接编译信号端口");
    const channel = cluster.organelleRuntime[portIndex]?.channel ?? 0;
    const localX = sourceIndex % cluster.rect.width;
    const localY = Math.floor(sourceIndex / cluster.rect.width);
    this.signalBuses.get(clusterId)!.sendCompile({ clusterId, localX, localY, channel, payload });
  }

  readCompileSignal(clusterId: ClusterId, consumerIndex: number): readonly CompileMessage[] {
    const cluster = this.requireCluster(clusterId);
    const portIndex = this.firstAdjacentPortIndex(cluster, consumerIndex, 0x0008);
    if (portIndex === undefined) throw new Error("编译信号消费者必须四邻接编译信号端口");
    return this.signalBuses.get(clusterId)!.readCompile(cluster.organelleRuntime[portIndex]?.channel ?? 0);
  }

  broadcastGroupDigital(senderClusterId: ClusterId, value: number): void {
    this.broadcastGroupSignal(senderClusterId, "digital", value);
  }

  broadcastGroupCompile(senderClusterId: ClusterId, payload: string): void {
    this.broadcastGroupSignal(senderClusterId, "compile", payload);
  }

  sendFamilyDigital(motherId: ClusterId, childId: ClusterId, value: number): void {
    const child = this.clusters.get(childId);
    if (!child || child.lifecycle.kind !== "developing" || child.lifecycle.motherId !== motherId) throw new Error("只允许母体向自己的发育子体发送家庭信号");
    this.signalBuses.get(childId)!.sendDigital({
      clusterId: motherId,
      localX: 0,
      localY: 0,
      channel: child.lifecycle.familyPort,
      value,
    });
  }

  sendFamilyCompile(motherId: ClusterId, childId: ClusterId, payload: string): void {
    const child = this.clusters.get(childId);
    if (!child || child.lifecycle.kind !== "developing" || child.lifecycle.motherId !== motherId) throw new Error("只允许母体向自己的发育子体发送家庭信号");
    this.signalBuses.get(childId)!.sendCompile({
      clusterId: motherId,
      localX: 0,
      localY: 0,
      channel: child.lifecycle.familyPort,
      payload,
    });
  }

  assertRectFree(rect: ToroidalRect, ignoredIds: ReadonlySet<ClusterId> = new Set()): void {
    for (const other of this.clusters.values()) {
      if (!ignoredIds.has(other.id) && toroidalRectsOverlap(rect, other.rect)) {
        throw new Error(`矩形与胞团 ${other.id} 重叠`);
      }
    }
  }

  private rebuildChunkIndex(): void {
    this.#chunkClusters.clear();
    for (const cluster of this.clusters.values()) {
      for (const piece of splitToroidalRect(cluster.rect)) {
        const minX = Math.floor(piece.x / CHUNK_SIZE);
        const maxX = Math.floor((piece.x + piece.width - 1) / CHUNK_SIZE);
        const minY = Math.floor(piece.y / CHUNK_SIZE);
        const maxY = Math.floor((piece.y + piece.height - 1) / CHUNK_SIZE);
        for (let cy = minY; cy <= maxY; cy += 1) {
          for (let cx = minX; cx <= maxX; cx += 1) {
            const key = (((cy % CHUNKS_Y) + CHUNKS_Y) % CHUNKS_Y) * CHUNKS_X + (((cx % CHUNKS_X) + CHUNKS_X) % CHUNKS_X);
            const bucket = this.#chunkClusters.get(key) ?? [];
            bucket.push(cluster);
            this.#chunkClusters.set(key, bucket);
          }
        }
      }
    }
  }

  private growRectFree(rect: ToroidalRect, ignoredId?: number): boolean {
    for (const piece of splitToroidalRect(rect)) {
      const minX = Math.floor(piece.x / CHUNK_SIZE);
      const maxX = Math.floor((piece.x + piece.width - 1) / CHUNK_SIZE);
      const minY = Math.floor(piece.y / CHUNK_SIZE);
      const maxY = Math.floor((piece.y + piece.height - 1) / CHUNK_SIZE);
      for (let cy = minY; cy <= maxY; cy += 1) {
        for (let cx = minX; cx <= maxX; cx += 1) {
          const key = (((cy % CHUNKS_Y) + CHUNKS_Y) % CHUNKS_Y) * CHUNKS_X + (((cx % CHUNKS_X) + CHUNKS_X) % CHUNKS_X);
          for (const other of this.#chunkClusters.get(key) ?? []) {
            if (other.id === ignoredId) continue;
            if (toroidalRectsOverlap(rect, other.rect)) return false;
          }
        }
      }
    }
    return true;
  }

  private indexCluster(cluster: Cluster): void {
    for (const piece of splitToroidalRect(cluster.rect)) {
      const minX = Math.floor(piece.x / CHUNK_SIZE);
      const maxX = Math.floor((piece.x + piece.width - 1) / CHUNK_SIZE);
      const minY = Math.floor(piece.y / CHUNK_SIZE);
      const maxY = Math.floor((piece.y + piece.height - 1) / CHUNK_SIZE);
      for (let cy = minY; cy <= maxY; cy += 1) {
        for (let cx = minX; cx <= maxX; cx += 1) {
          const key = (((cy % CHUNKS_Y) + CHUNKS_Y) % CHUNKS_Y) * CHUNKS_X + (((cx % CHUNKS_X) + CHUNKS_X) % CHUNKS_X);
          const bucket = this.#chunkClusters.get(key) ?? [];
          bucket.push(cluster);
          this.#chunkClusters.set(key, bucket);
        }
      }
    }
  }

  editMaterial(x: number, y: number, amount: bigint, energy: bigint): void {
    this.material.set(x, y, { amount, energy });
  }

  setOrganelle(
    clusterId: ClusterId,
    localX: number,
    localY: number,
    code: number,
    runtime: Cluster["organelleRuntime"][number] = { enabled: true },
  ): void {
    const cluster = this.clusters.get(clusterId);
    if (!cluster) throw new Error(`胞团 ${clusterId} 不存在`);
    if (!this.organelleRegistry.isValidCode(code)) throw new Error(`器官代码 ${code.toString(16)} 未注册`);
    if (!Number.isInteger(localX) || !Number.isInteger(localY) || localX < 0 || localY < 0 || localX >= cluster.rect.width || localY >= cluster.rect.height) {
      throw new RangeError("器官局部坐标越界");
    }
    const corner = (localX === 0 || localX === cluster.rect.width - 1) && (localY === 0 || localY === cluster.rect.height - 1);
    const boundary = localX === 0 || localY === 0 || localX === cluster.rect.width - 1 || localY === cluster.rect.height - 1;
    if (corner && code !== 0x0001) throw new Error("四角必须保持为壳");
    if (boundary && !corner && code !== 0) throw new Error("普通器官不能直接写入非角边界");
    const index = localY * cluster.rect.width + localX;
    cluster.organelles[index] = code;
    if (code === 0) delete cluster.organelleRuntime[index];
    else cluster.organelleRuntime[index] = { ...runtime };
    validateClusterBoundary(cluster);
  }

  registerDeclarativeRule(rule: DeclarativeRule): void {
    validateDeclarativeRule(rule);
    this.declarativeRules.set(rule.id, structuredClone(rule));
  }

  registerTrustedRuleSource(script: TrustedRuleSource): void {
    validateTrustedRuleSource(script);
    this.trustedRuleSources.set(script.id, { ...script });
  }

  step(externalIntents: readonly AttributedTrustedIntent[] = []): void {
    const rollback = this.captureRollback();
    this.lastWarning = undefined;
    try {
      this.#reproductionIntents = [];
      this.advanceSignalBuses();
      this.applyTrustedIntents(externalIntents);
      this.material.diffuseEnergyAndDrag(1n);
      this.recomputeDerivedStats();
      this.applyUpkeepAndOverload();
      this.runExistingOrganelleRules();
      this.advanceSeedsBeforeMovement();
      const { bodies, intents } = this.collectBodiesAndIntents();
      const resolution = resolveMovements(bodies, intents);
      this.commitMovement(resolution.displacementByBody, resolution.impulseByBody);
      for (const event of resolution.damageEvents) {
        const cluster = this.clusters.get(event.clusterId);
        if (cluster) cluster.hp -= this.applyImpactArmor(cluster, event.rawDamage, event.normalX, event.normalY);
      }
      this.rebuildChunkIndex();
      this.absorbCoveredMaterial();
      this.applyOverflowDamage();
      this.processReproductionIntents();
      this.advanceDevelopmentAfterMovement();
      this.expandSeedsAfterMovement();
      this.runAlgaeLifecycle();
      this.updateAutomaticGroups();
      this.removeDeadClusters();
      this.assertNoOverlap();
      this.tick += 1n;
    } catch (error) {
      this.restoreRollback(rollback);
      this.lastWarning = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  snapshot(running = false): WorldSnapshot {
    return {
      tick: this.tick.toString(),
      running,
      clusters: [...this.clusters.values()].sort(stableClusterSort).map((cluster) => ({
        id: cluster.id,
        x: cluster.rect.x,
        y: cluster.rect.y,
        width: cluster.rect.width,
        height: cluster.rect.height,
        hp: cluster.hp.toString(),
        maxHp: cluster.maxHp.toString(),
        amount: cluster.resources.amount.toString(),
        energy: cluster.resources.energy.toString(),
        px: cluster.motion.px.toString(),
        py: cluster.motion.py.toString(),
        organelles: [...cluster.organelles],
        organelleRuntime: cluster.organelleRuntime,
        geneHex: cluster.geneHex,
        note: cluster.note,
      })),
      seeds: [...this.seeds.values()].sort((a, b) => a.id - b.id).map((seed) => ({
        id: seed.id,
        motherId: seed.motherId,
        x: seed.x,
        y: seed.y,
        dormantTicks: seed.dormantTicks,
      })),
      materialCells: this.material.entries().slice(0, 20_000).map((cell) => ({
        ...cell,
        amount: cell.amount.toString(),
        energy: cell.energy.toString(),
      })),
      customOrganelles: this.organelleRegistry.listCustom().map(({ code, name, color, ruleId }) => ({ code, name, color, ruleId })),
      warning: this.lastWarning,
    };
  }

  stateDigest(): string {
    return JSON.stringify(this.exportState());
  }

  exportState(): SerializedWorldState {
    return {
      tick: this.tick.toString(),
      seed: this.seed.toString(),
      lightConfig: this.light.config,
      nextClusterId: this.#nextClusterId,
      nextGroupId: this.#nextGroupId,
      nextSeedId: this.#nextSeedId,
      clusters: [...this.clusters.values()].sort(stableClusterSort).map((cluster) => ({
        id: cluster.id,
        rect: cluster.rect,
        hp: cluster.hp.toString(),
        maxHp: cluster.maxHp.toString(),
        resources: {
          amount: cluster.resources.amount.toString(),
          energy: cluster.resources.energy.toString(),
          amountCapacityBonus: cluster.resources.amountCapacityBonus.toString(),
          energyCapacityBonus: cluster.resources.energyCapacityBonus.toString(),
        },
        motion: {
          px: cluster.motion.px.toString(),
          py: cluster.motion.py.toString(),
          density: cluster.motion.density.toString(),
        },
        armor: {
          up: cluster.armor.up.toString(),
          right: cluster.armor.right.toString(),
          down: cluster.armor.down.toString(),
          left: cluster.armor.left.toString(),
        },
        organelles: [...cluster.organelles],
        organelleRuntime: cluster.organelleRuntime,
        lifecycle: cluster.lifecycle,
        geneHex: cluster.geneHex,
        note: cluster.note,
        normalGroupId: cluster.normalGroupId,
        algaeState: cluster.algaeState,
      })),
      material: this.material.entries().map((cell) => ({
        x: cell.x,
        y: cell.y,
        amount: cell.amount.toString(),
        energy: cell.energy.toString(),
      })),
      normalGroups: [...this.normalGroups.values()].sort((a, b) => a.id - b.id).map((group) => ({
        id: group.id,
        code: group.code,
        memberIds: [...group.memberIds],
        px: group.px.toString(),
        py: group.py.toString(),
      })),
      seeds: [...this.seeds.values()].sort((a, b) => a.id - b.id).map((seed) => ({
        ...seed,
        hp: seed.hp.toString(),
        amount: seed.amount.toString(),
        energy: seed.energy.toString(),
        initialPx: seed.initialPx.toString(),
        initialPy: seed.initialPy.toString(),
        driveQueue: seed.driveQueue.map((move) => ({ ...move })),
      })),
      customOrganelleDefinitions: this.organelleRegistry.listCustom().map((definition) => ({
        ...definition,
        buildAmount: definition.buildAmount.toString(),
        buildEnergy: definition.buildEnergy.toString(),
        recycleNumerator: definition.recycleNumerator.toString(),
        recycleDenominator: definition.recycleDenominator.toString(),
      })),
      declarativeRules: [...this.declarativeRules.values()].sort((a, b) => a.id.localeCompare(b.id)).map((rule) => structuredClone(rule)),
      trustedRuleSources: [...this.trustedRuleSources.values()].sort((a, b) => a.id.localeCompare(b.id)).map((script) => ({ ...script })),
      signalBuses: [...this.signalBuses.entries()].sort(([a], [b]) => a - b).map(([clusterId, bus]) => ({
        clusterId,
        state: bus.exportState(),
      })),
    };
  }

  static fromState(state: SerializedWorldState): World {
    if (!Number.isInteger(state.nextClusterId) || state.nextClusterId < 1) throw new Error("存档中的 nextClusterId 非法");
    if (!Number.isInteger(state.nextGroupId) || state.nextGroupId < 1) throw new Error("存档中的 nextGroupId 非法");
    if (!Number.isInteger(state.nextSeedId) || state.nextSeedId < 1) throw new Error("存档中的 nextSeedId 非法");
    const world = new World(BigInt(state.seed), state.lightConfig);
    world.tick = BigInt(state.tick);
    world.#nextClusterId = state.nextClusterId;
    world.#nextGroupId = state.nextGroupId;
    world.#nextSeedId = state.nextSeedId;
    for (const definition of state.customOrganelleDefinitions) {
      world.organelleRegistry.registerCustom({
        ...definition,
        buildAmount: BigInt(definition.buildAmount),
        buildEnergy: BigInt(definition.buildEnergy),
        recycleNumerator: BigInt(definition.recycleNumerator),
        recycleDenominator: BigInt(definition.recycleDenominator),
      });
    }
    for (const rule of state.declarativeRules) world.registerDeclarativeRule(rule);
    for (const script of state.trustedRuleSources) world.registerTrustedRuleSource(script);
    for (const item of [...state.clusters].sort((a, b) => a.id - b.id)) {
      if (!Number.isInteger(item.id) || world.clusters.has(item.id)) throw new Error(`非法或重复胞团 ID: ${item.id}`);
      const cluster: Cluster = {
        id: item.id,
        rect: { ...item.rect },
        hp: BigInt(item.hp),
        maxHp: BigInt(item.maxHp),
        resources: {
          amount: BigInt(item.resources.amount),
          energy: BigInt(item.resources.energy),
          amountCapacityBonus: BigInt(item.resources.amountCapacityBonus),
          energyCapacityBonus: BigInt(item.resources.energyCapacityBonus),
        },
        motion: {
          px: BigInt(item.motion.px),
          py: BigInt(item.motion.py),
          density: BigInt(item.motion.density),
        },
        armor: {
          up: BigInt(item.armor.up),
          right: BigInt(item.armor.right),
          down: BigInt(item.armor.down),
          left: BigInt(item.armor.left),
        },
        organelles: Uint16Array.from(item.organelles),
        organelleRuntime: item.organelleRuntime ?? {},
        lifecycle: item.lifecycle,
        geneHex: item.geneHex,
        note: item.note,
        normalGroupId: item.normalGroupId,
        algaeState: item.algaeState,
      };
      validateClusterBoundary(cluster);
      world.assertRectFree(cluster.rect);
      world.clusters.set(cluster.id, cluster);
      world.signalBuses.set(cluster.id, new SignalBus());
    }
    for (const cell of state.material) {
      world.material.set(cell.x, cell.y, { amount: BigInt(cell.amount), energy: BigInt(cell.energy) });
    }
    for (const item of state.normalGroups) {
      if (world.normalGroups.has(item.id)) throw new Error(`重复普通群组 ID: ${item.id}`);
      const memberIds = [...item.memberIds].sort((a, b) => a - b);
      for (const memberId of memberIds) {
        const member = world.clusters.get(memberId);
        if (!member || member.normalGroupId !== item.id) throw new Error(`普通群组 ${item.id} 的成员引用不一致`);
      }
      world.normalGroups.set(item.id, {
        id: item.id,
        code: item.code,
        memberIds,
        px: BigInt(item.px),
        py: BigInt(item.py),
      });
    }
    for (const item of state.seeds) {
      if (world.seeds.has(item.id) || (item.motherId !== null && !world.clusters.has(item.motherId))) throw new Error(`种子 ${item.id} 的 ID 或母体无效`);
      const seed: Seed = {
        id: item.id,
        motherId: item.motherId,
        x: wrap(item.x, WORLD_WIDTH),
        y: wrap(item.y, WORLD_HEIGHT),
        hp: BigInt(item.hp),
        amount: BigInt(item.amount),
        energy: BigInt(item.energy),
        geneHex: decodeGenome(item.geneHex).normalizedHex,
        dormantTicks: item.dormantTicks,
        familyPort: item.familyPort,
        initialPx: BigInt(item.initialPx),
        initialPy: BigInt(item.initialPy),
        driveQueue: item.driveQueue.map((move) => ({ ...move })),
      };
      world.assertRectFree({ x: seed.x, y: seed.y, width: 1, height: 1 });
      if (world.seedAt(seed.x, seed.y)) throw new Error(`种子 ${item.id} 与其他种子重叠`);
      world.seeds.set(seed.id, seed);
    }
    for (const item of state.signalBuses) {
      if (!world.clusters.has(item.clusterId)) throw new Error(`信号总线引用不存在的胞团 ${item.clusterId}`);
      world.signalBuses.set(item.clusterId, SignalBus.fromState(item.state));
    }
    world.assertNoOverlap();
    return world;
  }

  private applyUpkeepAndOverload(): void {
    for (const cluster of [...this.clusters.values()].sort(stableClusterSort)) {
      const area = clusterArea(cluster);
      const upkeep = ceilDiv(area, 16n);
      if (cluster.resources.energy >= upkeep) cluster.resources.energy -= upkeep;
      else {
        const availablePositive = cluster.resources.energy > 0n ? cluster.resources.energy : 0n;
        cluster.resources.energy = 0n;
        cluster.hp -= upkeep - availablePositive;
      }

      const threshold = this.motionThresholdFor(cluster);
      const magnitudeSquared = cluster.motion.px ** 2n + cluster.motion.py ** 2n;
      if (magnitudeSquared > 4n * threshold * threshold) {
        const magnitude = bigintSqrt(magnitudeSquared);
        const excess = magnitude - 2n * threshold;
        cluster.hp -= (area * excess * excess) / (4n * threshold * threshold);
      }
    }
    for (const group of [...this.normalGroups.values()].sort((a, b) => a.id - b.id)) {
      const members = group.memberIds.map((id) => this.clusters.get(id)).filter((value): value is Cluster => value !== undefined);
      const area = members.reduce((sum, member) => sum + clusterArea(member), 0n);
      const threshold = members.reduce((sum, member) => sum + this.motionThresholdFor(member), 0n);
      if (threshold === 0n) continue;
      const magnitudeSquared = group.px ** 2n + group.py ** 2n;
      if (magnitudeSquared <= 4n * threshold * threshold) continue;
      const magnitude = bigintSqrt(magnitudeSquared);
      const excess = magnitude - 2n * threshold;
      const totalDamage = (area * excess * excess) / (4n * threshold * threshold);
      const each = members.length > 0 ? ceilDiv(totalDamage, BigInt(members.length)) : 0n;
      for (const member of members) member.hp -= each;
    }
  }

  private applyTrustedIntents(intents: readonly AttributedTrustedIntent[]): void {
    const sorted = [...intents].sort((a, b) => a.moduleId.localeCompare(b.moduleId) || a.intentIndex - b.intentIndex);
    for (const attributed of sorted) {
      const source = this.trustedRuleSources.get(attributed.moduleId);
      if (!source?.enabled) throw new Error(`脚本 ${attributed.moduleId} 未注册或未启用`);
      const intent = attributed.intent;
      const cluster = this.clusters.get(intent.clusterId);
      if (!cluster) throw new Error(`脚本 ${attributed.moduleId} 引用了不存在的胞团 ${intent.clusterId}`);
      if (intent.type === "add-momentum") {
        if (!/^-?\d+$/.test(intent.px) || !/^-?\d+$/.test(intent.py)) throw new Error("脚本动量意图必须使用整数字符串");
        this.addMomentumFromCluster(cluster, BigInt(intent.px), BigInt(intent.py));
      } else if (intent.type === "change-resource") {
        if (!/^-?\d+$/.test(intent.amount) || !/^-?\d+$/.test(intent.energy)) throw new Error("脚本资源意图必须使用整数字符串");
        const nextAmount = cluster.resources.amount + BigInt(intent.amount);
        if (nextAmount < 0n) throw new Error(`脚本 ${attributed.moduleId} 使物质量为负`);
        cluster.resources.amount = nextAmount;
        cluster.resources.energy += BigInt(intent.energy);
      } else {
        throw new Error(`脚本 ${attributed.moduleId} 返回未知意图`);
      }
    }
  }

  private recomputeDerivedStats(): void {
    for (const cluster of [...this.clusters.values()].sort(stableClusterSort)) {
      const armor = { up: 0n, right: 0n, down: 0n, left: 0n };
      for (let index = 0; index < cluster.organelles.length; index += 1) {
        if (cluster.organelles[index] === 0x0010) {
          const runtime = cluster.organelleRuntime[index];
          const direction = runtime?.direction ?? this.nearestSide(cluster, index);
          armor[direction] += 4n;
        }
      }
      cluster.resources.amountCapacityBonus = 0n;
      cluster.resources.energyCapacityBonus = 0n;
      cluster.armor = armor;
      const agePenalty = isAlgaeStructure(cluster) ? BigInt(Math.floor((cluster.algaeState?.age ?? 0) / 60)) : 0n;
      const calculated = clusterArea(cluster) * 4n - agePenalty;
      cluster.maxHp = calculated > 8n ? calculated : 8n;
      if (cluster.hp > cluster.maxHp) cluster.hp = cluster.maxHp;
    }
  }

  private collectBodiesAndIntents(): { bodies: BodySnapshot[]; intents: MoveIntent[] } {
    const bodies: BodySnapshot[] = [];
    const intents: MoveIntent[] = [];
    const grouped = new Set<ClusterId>();
    const groupsHandledByFamily = new Set<number>();
    for (const [motherId, children] of this.developingChildrenByMother()) {
      const mother = this.clusters.get(motherId);
      if (!mother) continue;
      const normalGroup = mother.normalGroupId === undefined ? undefined : this.normalGroups.get(mother.normalGroupId);
      const baseMembers = normalGroup
        ? normalGroup.memberIds.map((id) => this.clusters.get(id)).filter((value): value is Cluster => value !== undefined)
        : [mother];
      const members = [...baseMembers, ...children].sort(stableClusterSort);
      const threshold = members.reduce((sum, member) => sum + this.motionThresholdFor(member), 0n);
      const px = normalGroup?.px ?? mother.motion.px;
      const py = normalGroup?.py ?? mother.motion.py;
      const bodyId = `family:${motherId.toString().padStart(10, "0")}`;
      bodies.push({
        id: bodyId,
        clusterIds: members.map((member) => member.id),
        rects: members.map((member) => member.rect),
        mass: members.reduce((sum, member) => sum + clusterArea(member) * member.motion.density, 0n),
        px,
        py,
        thresholdX: threshold,
        thresholdY: threshold,
      });
      intents.push({
        bodyId,
        clusterIds: members.map((member) => member.id),
        dx: directionForCounter(px, threshold),
        dy: directionForCounter(py, threshold),
        thresholdX: threshold,
        thresholdY: threshold,
        px,
        py,
      });
      for (const member of members) grouped.add(member.id);
      if (normalGroup) groupsHandledByFamily.add(normalGroup.id);
    }
    for (const group of [...this.normalGroups.values()].sort((a, b) => a.id - b.id)) {
      if (groupsHandledByFamily.has(group.id)) continue;
      const members = group.memberIds.map((id) => this.clusters.get(id)).filter((value): value is Cluster => value !== undefined);
      if (members.length !== group.memberIds.length) throw new Error(`普通群组 ${group.id} 包含失效成员`);
      const threshold = members.reduce((sum, member) => sum + this.motionThresholdFor(member), 0n);
      const bodyId = `group:${group.id.toString().padStart(10, "0")}`;
      const dx = directionForCounter(group.px, threshold);
      const dy = directionForCounter(group.py, threshold);
      bodies.push({
        id: bodyId,
        clusterIds: [...group.memberIds],
        rects: members.map((member) => member.rect),
        mass: members.reduce((sum, member) => sum + clusterArea(member) * member.motion.density, 0n),
        px: group.px,
        py: group.py,
        thresholdX: threshold,
        thresholdY: threshold,
      });
      intents.push({
        bodyId,
        clusterIds: [...group.memberIds],
        dx,
        dy,
        thresholdX: threshold,
        thresholdY: threshold,
        px: group.px,
        py: group.py,
      });
      for (const member of members) grouped.add(member.id);
    }
    for (const cluster of [...this.clusters.values()].sort(stableClusterSort)) {
      if (grouped.has(cluster.id)) continue;
      const threshold = this.motionThresholdFor(cluster);
      const bodyId = `cluster:${cluster.id.toString().padStart(10, "0")}`;
      const dx = directionForCounter(cluster.motion.px, threshold);
      const dy = directionForCounter(cluster.motion.py, threshold);
      bodies.push({
        id: bodyId,
        clusterIds: [cluster.id],
        rects: [cluster.rect],
        mass: clusterArea(cluster) * cluster.motion.density,
        px: cluster.motion.px,
        py: cluster.motion.py,
        thresholdX: threshold,
        thresholdY: threshold,
      });
      intents.push({
        bodyId,
        clusterIds: [cluster.id],
        dx,
        dy,
        thresholdX: threshold,
        thresholdY: threshold,
        px: cluster.motion.px,
        py: cluster.motion.py,
      });
    }
    for (const seed of [...this.seeds.values()].sort((a, b) => a.id - b.id)) {
      bodies.push({
        id: `seed:${seed.id.toString().padStart(10, "0")}`,
        clusterIds: [],
        rects: [{ x: seed.x, y: seed.y, width: 1, height: 1 }],
        mass: 1n,
        px: 0n,
        py: 0n,
        thresholdX: 1n,
        thresholdY: 1n,
        immovable: true,
      });
    }
    return { bodies, intents };
  }

  private seedAt(x: number, y: number, ignoredId?: number): Seed | undefined {
    const wrappedX = wrap(x, WORLD_WIDTH);
    const wrappedY = wrap(y, WORLD_HEIGHT);
    return [...this.seeds.values()].find((seed) => seed.id !== ignoredId && seed.x === wrappedX && seed.y === wrappedY);
  }

  private pointFreeForSeed(x: number, y: number, ignoredId?: number): boolean {
    const rect = { x: wrap(x, WORLD_WIDTH), y: wrap(y, WORLD_HEIGHT), width: 1, height: 1 };
    try {
      this.assertRectFree(rect);
    } catch {
      return false;
    }
    return this.seedAt(rect.x, rect.y, ignoredId) === undefined;
  }

  private advanceSeedsBeforeMovement(): void {
    for (const seed of [...this.seeds.values()].sort((a, b) => a.id - b.id)) {
      if (seed.motherId !== null && !this.clusters.has(seed.motherId)) {
        this.seeds.delete(seed.id);
        continue;
      }
      if (seed.dormantTicks > 0) {
        seed.dormantTicks -= 1;
        continue;
      }
      if (seed.energy > 0n) seed.energy -= 1n;
      else seed.hp -= 1n;
      if (seed.hp <= 0n) {
        this.seeds.delete(seed.id);
        continue;
      }
      const move = seed.driveQueue[0];
      if (!move || seed.energy < 1n) continue;
      const targetX = wrap(seed.x + move.x, WORLD_WIDTH);
      const targetY = wrap(seed.y + move.y, WORLD_HEIGHT);
      if (!this.pointFreeForSeed(targetX, targetY, seed.id)) continue;
      seed.x = targetX;
      seed.y = targetY;
      seed.energy -= 1n;
      seed.driveQueue.shift();
    }
  }

  private expandSeedsAfterMovement(): void {
    for (const seed of [...this.seeds.values()].sort((a, b) => a.id - b.id)) {
      if (seed.dormantTicks > 0 || seed.amount < 4n || seed.energy < 4n) continue;
      const mother = seed.motherId === null ? undefined : this.clusters.get(seed.motherId);
      if (seed.motherId !== null && !mother) {
        this.seeds.delete(seed.id);
        continue;
      }
      const rect: ToroidalRect = {
        x: wrap(seed.x - 1, WORLD_WIDTH),
        y: wrap(seed.y - 1, WORLD_HEIGHT),
        width: 3,
        height: 3,
      };
      if (!this.growRectFree(rect)) continue;
      const blockedBySeed = [...this.seeds.values()].some((other) =>
        other.id !== seed.id && toroidalRectsOverlap(rect, { x: other.x, y: other.y, width: 1, height: 1 }),
      );
      if (blockedBySeed) continue;
      const genome = decodeGenome(seed.geneHex);
      const child = createCluster(this.#nextClusterId, rect);
      child.organelles[4] = 0x0002;
      child.resources.amount = seed.amount - 4n;
      child.resources.energy = seed.energy - 4n;
      child.motion.px = 0n;
      child.motion.py = 0n;
      child.lifecycle = {
        kind: "developing",
        geneHex: seed.geneHex,
        genePointer: 0,
        motherId: seed.motherId ?? child.id,
        familyPort: seed.familyPort,
        ant: { x: 1, y: 1, direction: 0 },
      };
      child.geneHex = seed.geneHex;
      if (mother && mother.normalGroupId !== undefined) {
        const group = this.normalGroups.get(mother.normalGroupId);
        if (!group) throw new Error(`母体 ${mother.id} 引用了不存在的普通群组`);
        group.px += seed.initialPx;
        group.py += seed.initialPy;
      } else if (mother) {
        mother.motion.px += seed.initialPx;
        mother.motion.py += seed.initialPy;
      }
      this.clusters.set(child.id, child);
      this.signalBuses.set(child.id, new SignalBus());
      this.#nextClusterId += 1;
      this.seeds.delete(seed.id);
      this.indexCluster(child);
      validateClusterBoundary(child);
      if (genome.header.familyPort !== seed.familyPort) throw new Error("种子家庭端口与基因头不一致");
    }
  }

  private advanceDevelopmentAfterMovement(): void {
    const developingAtPhaseStart = [...this.clusters.values()]
      .filter((cluster) => cluster.lifecycle.kind === "developing")
      .sort(stableClusterSort);
    for (const cluster of developingAtPhaseStart) {
      if (cluster.lifecycle.kind !== "developing") continue;
      const lifecycle = cluster.lifecycle;
      if (!this.clusters.has(lifecycle.motherId)) {
        cluster.lifecycle = { kind: "failed", reason: "母体已死亡" };
        continue;
      }
      try {
        const genome = decodeGenome(lifecycle.geneHex);
        const instruction = genome.instructions[lifecycle.genePointer];
        if (!instruction) {
          cluster.lifecycle = { kind: "failed", reason: "基因在 END 前耗尽" };
          continue;
        }
        const action = executeGenomeInstruction(lifecycle.ant, instruction);
        if (action.kind === "grow") {
          if (this.tryGrowDevelopingCluster(cluster, action.side)) lifecycle.genePointer += 1;
          continue;
        }
        if (action.kind === "end") {
          validateClusterBoundary(cluster);
          cluster.lifecycle = { kind: "active" };
          continue;
        }
        const { x, y } = action.state;
        const interior = x > 0 && y > 0 && x < cluster.rect.width - 1 && y < cluster.rect.height - 1;
        if (!interior) continue;
        if (action.kind === "move-only") {
          lifecycle.ant = action.state;
          lifecycle.genePointer += 1;
          continue;
        }
        if (!this.tryWriteDevelopingOrganelle(cluster, x, y, action.code)) continue;
        lifecycle.ant = action.state;
        lifecycle.genePointer += 1;
      } catch (error) {
        cluster.lifecycle = { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
      }
    }
  }

  private tryGrowDevelopingCluster(cluster: Cluster, side: "up" | "right" | "down" | "left"): boolean {
    if (cluster.lifecycle.kind !== "developing") return false;
    const oldRect = cluster.rect;
    const targetRect = grownAlgaeRect(oldRect, side);
    if (targetRect.width > WORLD_WIDTH || targetRect.height > WORLD_HEIGHT) return false;
    if (!this.growRectFree(targetRect, cluster.id)) return false;
    const amountCost = 4n;
    const energyCost = 2n;
    if (cluster.resources.amount < amountCost || cluster.resources.energy < energyCost) return false;
    const nextGrid = new Uint16Array(targetRect.width * targetRect.height);
    const setTarget = (worldX: number, worldY: number, code: number): void => {
      const localX = wrap(worldX - targetRect.x, WORLD_WIDTH);
      const localY = wrap(worldY - targetRect.y, WORLD_HEIGHT);
      if (localX < targetRect.width && localY < targetRect.height) nextGrid[localY * targetRect.width + localX] = code;
    };
    for (let y = 0; y < oldRect.height; y += 1) {
      for (let x = 0; x < oldRect.width; x += 1) {
        const isOldCorner = (x === 0 || x === oldRect.width - 1) && (y === 0 || y === oldRect.height - 1);
        const code = cluster.organelles[y * oldRect.width + x];
        if (code !== 0 && !isOldCorner) setTarget(oldRect.x + x, oldRect.y + y, code);
      }
    }
    const corner = (x: number, y: number): void => { nextGrid[y * targetRect.width + x] = 0x0001; };
    corner(0, 0);
    corner(targetRect.width - 1, 0);
    corner(0, targetRect.height - 1);
    corner(targetRect.width - 1, targetRect.height - 1);
    cluster.resources.amount -= amountCost;
    cluster.resources.energy -= energyCost;
    const oldMaxHp = cluster.maxHp;
    cluster.rect = targetRect;
    cluster.organelles = nextGrid;
    cluster.maxHp = clusterArea(cluster) * 4n;
    cluster.hp += cluster.maxHp - oldMaxHp;
    if (side === "left") cluster.lifecycle.ant.x += 1;
    if (side === "up") cluster.lifecycle.ant.y += 1;
    this.indexCluster(cluster);
    validateClusterBoundary(cluster);
    return true;
  }

  private tryWriteDevelopingOrganelle(cluster: Cluster, x: number, y: number, code: number): boolean {
    const index = y * cluster.rect.width + x;
    const oldCode = cluster.organelles[index];
    if (oldCode === code) return true;
    const oldDefinition = this.organelleRegistry.get(oldCode);
    const recycled = oldDefinition
      ? (oldDefinition.buildAmount * oldDefinition.recycleNumerator) / oldDefinition.recycleDenominator
      : 0n;
    if (code === 0) {
      cluster.resources.amount += recycled;
      cluster.organelles[index] = 0;
      return true;
    }
    const definition = this.organelleRegistry.get(code);
    if (!definition) throw new Error(`未注册器官代码 ${code.toString(16).toUpperCase().padStart(4, "0")}`);
    const availableAmount = cluster.resources.amount + recycled;
    if (availableAmount < definition.buildAmount || cluster.resources.energy < definition.buildEnergy) return false;
    cluster.resources.amount = availableAmount - definition.buildAmount;
    cluster.resources.energy -= definition.buildEnergy;
    cluster.organelles[index] = code;
    return true;
  }

  private runExistingOrganelleRules(): void {
    const customIntents: Array<DeclarativeIntent & { clusterId: number; organelleIndex: number }> = [];
    for (const cluster of [...this.clusters.values()].sort(stableClusterSort)) {
      if (cluster.lifecycle.kind !== "active") continue;
      for (let index = 0; index < cluster.organelles.length; index += 1) {
        if (cluster.organelleRuntime[index]?.enabled === false) continue;
        const definition = this.organelleRegistry.get(cluster.organelles[index]);
        const rule = definition ? this.declarativeRules.get(definition.ruleId) : undefined;
        if (!rule) continue;
        const localX = index % cluster.rect.width;
        const localY = Math.floor(index / cluster.rect.width);
        const intents = evaluateDeclarativeRule(rule, {
          hp: cluster.hp,
          maxHp: cluster.maxHp,
          amount: cluster.resources.amount,
          energy: cluster.resources.energy,
          px: cluster.motion.px,
          py: cluster.motion.py,
          light: BigInt(this.light.sample(cluster.rect.x + localX, cluster.rect.y + localY)),
          tick: this.tick,
        });
        for (const intent of intents) customIntents.push({ ...intent, clusterId: cluster.id, organelleIndex: index });
      }
    }
    for (const cluster of [...this.clusters.values()].sort(stableClusterSort)) {
      if (cluster.lifecycle.kind !== "active") continue;
      const width = cluster.rect.width;
      for (let index = 0; index < cluster.organelles.length; index += 1) {
        const code = cluster.organelles[index];
        const runtime = cluster.organelleRuntime[index];
        if (runtime?.enabled === false) continue;
        const localX = index % width;
        const localY = Math.floor(index / width);
        if (code === 0x0003) {
          const light = this.light.sample(cluster.rect.x + localX, cluster.rect.y + localY);
          const produced = Math.min(16, Math.floor(light / 16));
          cluster.resources.energy += BigInt(produced);
        } else if (code === 0x0009) {
          if (!this.hasAdjacentPort(cluster, localX, localY, 0x0007)) continue;
          const portIndex = this.firstAdjacentPortIndex(cluster, index, 0x0007)!;
          const portChannel = cluster.organelleRuntime[portIndex]?.channel ?? 0;
          const outChannel = runtime?.channel ?? portChannel;
          const inputChannel = runtime?.inputChannel ?? outChannel;
          const input = this.readDigitalChannel(cluster.id, index, inputChannel);
          const value = runtime?.value ?? 0;
          const op = runtime?.operation ?? "constant";
          let out = 0;
          if (op === "constant") out = value;
          else if (op === "add") out = input + value;
          else if (op === "sub") out = input - value;
          else if (op === "compare") out = input > value ? 1 : 0;
          else if (op === "and") out = input !== 0 && value !== 0 ? 1 : 0;
          else if (op === "or") out = input !== 0 || value !== 0 ? 1 : 0;
          else if (op === "not") out = input === 0 ? 1 : 0;
          else if (op === "delay") out = input;
          else if (op === "pulse") {
            const last = runtime?.lastInput ?? 0;
            if (runtime) runtime.lastInput = input;
            out = input !== 0 && last === 0 ? value : 0;
          } else if (op === "latch") {
            if (input !== 0) {
              if (runtime) runtime.latchValue = value;
              out = value;
            } else out = runtime?.latchValue ?? 0;
          }
          this.emitDigitalChannel(cluster.id, index, outChannel, clamp16(out));
        } else if (code === 0x000c) {
          const compilePort = this.firstAdjacentPortIndex(cluster, index, 0x0008);
          if (compilePort === undefined) continue;
          const state = cluster.organelleRuntime[index] ??= { enabled: true };
          const fragments = this.signalBuses.get(cluster.id)!.readCompile(cluster.organelleRuntime[compilePort]?.channel ?? 0);
          let bufferChanged = false;
          for (const message of fragments) {
            const senderIndex = message.localY * width + message.localX;
            if (senderIndex >= 0 && senderIndex < cluster.organelles.length && cluster.organelles[senderIndex] === 0x000c) continue;
            if (message.payload === "!CLEAR" || message.payload === "!RESET") {
              state.compileBuffer = "";
              state.compileEmitted = undefined;
              this.emitCompileSignal(cluster.id, index, message.payload);
              bufferChanged = true;
            } else if (!message.payload.startsWith("!")) {
              state.compileBuffer = (state.compileBuffer ?? "") + message.payload;
              bufferChanged = true;
            }
          }
          if (!bufferChanged) continue;
          const buffered = state.compileBuffer ?? "";
          if (buffered.length < 26 || (buffered.length - 20) % 6 !== 0) continue;
          try {
            const genome = decodeGenome(buffered);
            if (genome.instructions.at(-1)?.control !== "end") continue;
            state.compileBuffer = genome.normalizedHex;
            this.saveCompileTemplate(cluster, genome.normalizedHex);
            if (state.compileEmitted !== genome.normalizedHex) {
              this.emitCompileSignal(cluster.id, index, genome.normalizedHex);
              state.compileEmitted = genome.normalizedHex;
            }
          } catch {
            // 非法或尚未完整的片段继续保留，等待清空或后续片段。
          }
        } else if (code === 0x000a) {
          if (!this.hasAdjacentPort(cluster, localX, localY, 0x0007)) continue;
          const op = runtime?.operation ?? "light";
          const direction = runtime?.direction ?? this.nearestSide(cluster, index);
          let out = 0;
          if (op === "light") {
            out = Math.min(32767, this.light.sample(cluster.rect.x + localX, cluster.rect.y + localY));
          } else if (op === "light-gradient") {
            const front = this.outsideCoordinate(cluster, localX, localY, direction);
            const back = this.outsideCoordinate(cluster, localX, localY, oppositeDirection(direction));
            out = clamp16(this.light.sample(front.x, front.y) - this.light.sample(back.x, back.y));
          } else if (op === "energy") {
            out = bigintClamp16(cluster.resources.energy);
          } else if (op === "amount") {
            out = bigintClamp16(cluster.resources.amount);
          } else if (op === "proximity") {
            const outside = this.outsideCoordinate(cluster, localX, localY, direction);
            out = this.material.get(outside.x, outside.y).amount > 0n || this.cellOccupiedByWorld(outside.x, outside.y) ? 1 : 0;
          }
          this.emitDigitalSignal(cluster.id, index, out);
        } else if (code === 0x000f && this.portAllowsResource(cluster, localX, localY, "energy")) {
          if (!this.digitalGateAllows(cluster, index)) continue;
          if (cluster.resources.energy < 1n) continue;
          const direction = runtime?.direction ?? this.nearestSide(cluster, index);
          const vector = directionVector(direction);
          const force = Number.isInteger(runtime?.force) ? Math.max(1, Math.min(1024, runtime!.force!)) : 1;
          cluster.resources.energy -= 1n;
          this.addMomentumFromCluster(cluster, BigInt(vector.x * force), BigInt(vector.y * force));
        } else if (code === 0x0011 && this.portAllowsResource(cluster, localX, localY, "amount")) {
          if (!this.digitalGateAllows(cluster, index)) continue;
          if (cluster.resources.amount < 1n) continue;
          const direction = runtime?.direction ?? this.nearestSide(cluster, index);
          if (!this.canProjectToSide(cluster, localX, localY, direction)) continue;
          const vector = directionVector(direction);
          const outputX = wrap(cluster.rect.x + (direction === "left" ? -1 : direction === "right" ? cluster.rect.width : localX), WORLD_WIDTH);
          const outputY = wrap(cluster.rect.y + (direction === "up" ? -1 : direction === "down" ? cluster.rect.height : localY), WORLD_HEIGHT);
          cluster.resources.amount -= 1n;
          this.material.add(outputX, outputY, { amount: 1n, energy: 0n });
          this.addMomentumFromCluster(cluster, BigInt(-vector.x), BigInt(-vector.y));
        } else if (code === 0x0012) {
          const compilePort = this.firstAdjacentPortIndex(cluster, index, 0x0008);
          if (compilePort === undefined) continue;
          const state = cluster.organelleRuntime[index] ??= { enabled: true };
          const fragments = this.signalBuses.get(cluster.id)!.readCompile(cluster.organelleRuntime[compilePort]?.channel ?? 0);
          for (const message of fragments) {
            const senderIndex = message.localY * width + message.localX;
            if (senderIndex < 0 || senderIndex >= cluster.organelles.length || cluster.organelles[senderIndex] !== 0x000c) continue;
            if (message.payload === "!CLEAR" || message.payload === "!RESET") {
              state.compileBuffer = "";
              continue;
            }
            if (message.payload.startsWith("!")) continue;
            try {
              const genome = decodeGenome(message.payload);
              if (genome.instructions.at(-1)?.control === "end") state.compileBuffer = genome.normalizedHex;
            } catch {
              // 生殖端口只接受处理器输出的完整合法基因。
            }
          }
          const buffered = state.compileBuffer ?? "";
          if (buffered.length >= 26 && (buffered.length - 20) % 6 === 0) {
            try {
              const genome = decodeGenome(buffered);
              if (genome.instructions.at(-1)?.control === "end") {
                if (state.cooldown && state.cooldown > 0 && state.lastProducedTick !== undefined
                  && this.tick - BigInt(state.lastProducedTick) < BigInt(state.cooldown)) continue;
                const costAmount = BigInt(state.reproduceCostAmount ?? 0);
                const costEnergy = BigInt(state.reproduceCostEnergy ?? 0);
                this.#reproductionIntents.push({
                  clusterId: cluster.id,
                  organelleIndex: index,
                  geneHex: genome.normalizedHex,
                  direction: state.direction ?? this.nearestSide(cluster, index),
                  costAmount,
                  costEnergy,
                });
                this.saveCompileTemplate(cluster, genome.normalizedHex);
              }
            } catch {
              // 片段可能尚未完整；缓存保留，供下一 Tick 继续拼接或由编辑器检查。
            }
          }
        }
      }
      if (isAlgaeStructure(cluster)) {
        cluster.algaeState ??= { age: 0 };
        const brightest = uniqueBrightestDirection(sampleAlgaeSides(cluster, this.light));
        const allowed = brightest && (
          cluster.algaeState.lockedDirection === undefined || cluster.algaeState.lockedDirection === brightest.direction
        );
        if (allowed) {
          const force = Math.floor((brightest.highest - brightest.secondHighest) / 16);
          const vector = directionVector(brightest.direction);
          cluster.motion.px += BigInt(vector.x * force);
          cluster.motion.py += BigInt(vector.y * force);
        }
      }
    }
    customIntents.sort((a, b) => a.clusterId - b.clusterId || a.organelleIndex - b.organelleIndex || a.actionIndex - b.actionIndex);
    for (const intent of customIntents) {
      const cluster = this.clusters.get(intent.clusterId);
      if (!cluster) continue;
      if (intent.action.type === "add-momentum") {
        this.addMomentumFromCluster(cluster, intent.action.px, intent.action.py);
      } else {
        const nextAmount = cluster.resources.amount + intent.action.amount;
        if (nextAmount < 0n) throw new Error(`自定义规则使胞团 ${cluster.id} 的物质量为负`);
        cluster.resources.amount = nextAmount;
        cluster.resources.energy += intent.action.energy;
      }
    }
  }

  private hasAdjacentPort(cluster: Cluster, x: number, y: number, portCode: number): boolean {
    const points = [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]];
    return points.some(([px, py]) =>
      px >= 0 && py >= 0 && px < cluster.rect.width && py < cluster.rect.height
      && cluster.organelles[py * cluster.rect.width + px] === portCode,
    );
  }

  private portAllowsResource(cluster: Cluster, x: number, y: number, resource: "amount" | "energy"): boolean {
    const points = [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]];
    return points.some(([px, py]) => {
      if (px < 0 || py < 0 || px >= cluster.rect.width || py >= cluster.rect.height) return false;
      const index = py * cluster.rect.width + px;
      if (cluster.organelles[index] !== 0x0005) return false;
      const mode = cluster.organelleRuntime[index]?.mode;
      return mode === undefined || mode === "both" || mode === resource;
    });
  }

  private digitalGateAllows(cluster: Cluster, consumerIndex: number): boolean {
    const inputChannel = cluster.organelleRuntime[consumerIndex]?.inputChannel;
    if (inputChannel === undefined) return true;
    const localX = consumerIndex % cluster.rect.width;
    const localY = Math.floor(consumerIndex / cluster.rect.width);
    if (!this.hasAdjacentPort(cluster, localX, localY, 0x0007)) return false;
    return this.readDigitalChannel(cluster.id, consumerIndex, inputChannel) !== 0;
  }

  private nearestSide(cluster: Cluster, index: number): AlgaeDirection {
    const x = index % cluster.rect.width;
    const y = Math.floor(index / cluster.rect.width);
    const distances: Array<[AlgaeDirection, number]> = [
      ["up", y],
      ["right", cluster.rect.width - 1 - x],
      ["down", cluster.rect.height - 1 - y],
      ["left", x],
    ];
    distances.sort((a, b) => a[1] - b[1]);
    return distances[0][0];
  }

  private canProjectToSide(cluster: Cluster, x: number, y: number, direction: AlgaeDirection): boolean {
    if (direction === "up") return y === 1;
    if (direction === "right") return x === cluster.rect.width - 2;
    if (direction === "down") return y === cluster.rect.height - 2;
    return x === 1;
  }

  private addMomentumFromCluster(cluster: Cluster, px: bigint, py: bigint): void {
    if (cluster.normalGroupId !== undefined) {
      const group = this.normalGroups.get(cluster.normalGroupId);
      if (!group) throw new Error(`胞团 ${cluster.id} 的普通群组不存在`);
      group.px += px;
      group.py += py;
    } else {
      cluster.motion.px += px;
      cluster.motion.py += py;
    }
  }

  private commitMovement(
    displacementByBody: ReadonlyMap<string, Point>,
    impulseByBody: ReadonlyMap<string, { x: bigint; y: bigint }>,
  ): void {
    const movedInGroup = new Set<ClusterId>();
    const groupsHandledByFamily = new Set<number>();
    for (const [motherId, children] of this.developingChildrenByMother()) {
      const mother = this.clusters.get(motherId);
      if (!mother) continue;
      const normalGroup = mother.normalGroupId === undefined ? undefined : this.normalGroups.get(mother.normalGroupId);
      const baseMembers = normalGroup
        ? normalGroup.memberIds.map((id) => this.clusters.get(id)).filter((value): value is Cluster => value !== undefined)
        : [mother];
      const members = [...baseMembers, ...children].sort(stableClusterSort);
      const threshold = members.reduce((sum, member) => sum + this.motionThresholdFor(member), 0n);
      const bodyId = `family:${motherId.toString().padStart(10, "0")}`;
      const move = displacementByBody.get(bodyId) ?? { x: 0, y: 0 };
      for (const member of members) {
        member.rect = translateRect(member.rect, move.x, move.y);
        movedInGroup.add(member.id);
      }
      const impulse = impulseByBody.get(bodyId);
      if (normalGroup) {
        if (move.x !== 0) normalGroup.px -= BigInt(move.x) * threshold;
        if (move.y !== 0) normalGroup.py -= BigInt(move.y) * threshold;
        if (impulse) {
          normalGroup.px += impulse.x;
          normalGroup.py += impulse.y;
        }
        groupsHandledByFamily.add(normalGroup.id);
      } else {
        if (move.x !== 0) mother.motion.px -= BigInt(move.x) * threshold;
        if (move.y !== 0) mother.motion.py -= BigInt(move.y) * threshold;
        if (impulse) {
          mother.motion.px += impulse.x;
          mother.motion.py += impulse.y;
        }
      }
    }
    for (const group of [...this.normalGroups.values()].sort((a, b) => a.id - b.id)) {
      if (groupsHandledByFamily.has(group.id)) continue;
      const bodyId = `group:${group.id.toString().padStart(10, "0")}`;
      const move = displacementByBody.get(bodyId) ?? { x: 0, y: 0 };
      const members = group.memberIds.map((id) => this.clusters.get(id)).filter((value): value is Cluster => value !== undefined);
      const threshold = members.reduce((sum, member) => sum + this.motionThresholdFor(member), 0n);
      for (const member of members) {
        member.rect = translateRect(member.rect, move.x, move.y);
        movedInGroup.add(member.id);
      }
      if (move.x !== 0) group.px -= BigInt(move.x) * threshold;
      if (move.y !== 0) group.py -= BigInt(move.y) * threshold;
      const impulse = impulseByBody.get(bodyId);
      if (impulse) {
        group.px += impulse.x;
        group.py += impulse.y;
      }
    }
    for (const cluster of [...this.clusters.values()].sort(stableClusterSort)) {
      if (movedInGroup.has(cluster.id)) continue;
      const bodyId = `cluster:${cluster.id.toString().padStart(10, "0")}`;
      const move = displacementByBody.get(bodyId) ?? { x: 0, y: 0 };
      const threshold = this.motionThresholdFor(cluster);
      cluster.rect = translateRect(cluster.rect, move.x, move.y);
      if (move.x !== 0) cluster.motion.px -= BigInt(move.x) * threshold;
      if (move.y !== 0) cluster.motion.py -= BigInt(move.y) * threshold;
      const impulse = impulseByBody.get(bodyId);
      if (impulse) {
        cluster.motion.px += impulse.x;
        cluster.motion.py += impulse.y;
      }
    }
  }

  private absorbCoveredMaterial(): void {
    for (const cluster of [...this.clusters.values()].sort(stableClusterSort)) {
      for (let localY = 0; localY < cluster.rect.height; localY += 1) {
        for (let localX = 0; localX < cluster.rect.width; localX += 1) {
          const x = wrap(cluster.rect.x + localX, WORLD_WIDTH);
          const y = wrap(cluster.rect.y + localY, WORLD_HEIGHT);
          const cell = this.material.get(x, y);
          const movedAmount = cell.amount > 0n ? 1n : 0n;
          const movedEnergy = cell.energy > 0n ? 1n : cell.energy < 0n ? -1n : 0n;
          if (movedAmount !== 0n || movedEnergy !== 0n) {
            cluster.resources.amount += movedAmount;
            cluster.resources.energy += movedEnergy;
            this.material.set(x, y, { amount: cell.amount - movedAmount, energy: cell.energy - movedEnergy });
          }
        }
      }
      for (const port of this.exchangePorts(cluster, "absorb")) {
        for (let dy = -port.range; dy <= port.range; dy += 1) {
          for (let dx = -port.range; dx <= port.range; dx += 1) {
            const x = wrap(port.x + dx, WORLD_WIDTH);
            const y = wrap(port.y + dy, WORLD_HEIGHT);
            if (this.cellOccupiedByWorld(x, y)) continue;
            const cell = this.material.get(x, y);
            let movedAmount = cell.amount > 0n ? 1n : 0n;
            let movedEnergy = cell.energy > 0n ? 1n : cell.energy < 0n ? -1n : 0n;
            if (movedAmount !== 0n && !this.portAllowsResource(cluster, port.localX, port.localY, "amount")) movedAmount = 0n;
            if (movedEnergy !== 0n && !this.portAllowsResource(cluster, port.localX, port.localY, "energy")) movedEnergy = 0n;
            if (movedAmount !== 0n || movedEnergy !== 0n) {
              cluster.resources.amount += movedAmount;
              cluster.resources.energy += movedEnergy;
              this.material.set(x, y, { amount: cell.amount - movedAmount, energy: cell.energy - movedEnergy });
            }
          }
        }
      }
    }
  }

  private applyOverflowDamage(): void {
    for (const cluster of this.clusters.values()) {
      let excessAmount = cluster.resources.amount > amountCapacity(cluster)
        ? cluster.resources.amount - amountCapacity(cluster)
        : 0n;
      let excessEnergy = absBigInt(cluster.resources.energy) > energyCapacity(cluster)
        ? absBigInt(cluster.resources.energy) - energyCapacity(cluster)
        : 0n;
      const ports = this.exchangePorts(cluster, "eject");
      if (ports.length > 0) {
        const energySign = cluster.resources.energy < 0n ? -1n : 1n;
        for (const port of ports) {
          if (excessAmount > 0n && this.portAllowsResource(cluster, port.localX, port.localY, "amount")) {
            this.material.add(port.x, port.y, { amount: 1n, energy: 0n });
            cluster.resources.amount -= 1n;
            excessAmount -= 1n;
          }
          if (excessEnergy > 0n && this.portAllowsResource(cluster, port.localX, port.localY, "energy")) {
            this.material.add(port.x, port.y, { amount: 0n, energy: 1n * energySign });
            cluster.resources.energy -= 1n * energySign;
            excessEnergy -= 1n;
          }
        }
      }
      if (excessAmount > 0n || excessEnergy > 0n) {
        const area = clusterArea(cluster);
        cluster.hp -= ceilDiv(excessAmount, area) + ceilDiv(excessEnergy, 2n * area);
      }
    }
  }

  private exchangePorts(cluster: Cluster, mode: "absorb" | "eject"): Array<{ index: number; localX: number; localY: number; x: number; y: number; range: number }> {
    const ports: Array<{ index: number; localX: number; localY: number; x: number; y: number; range: number }> = [];
    for (let index = 0; index < cluster.organelles.length; index += 1) {
      if (cluster.organelles[index] !== 0x0006 || cluster.organelleRuntime[index]?.enabled === false) continue;
      const runtime = cluster.organelleRuntime[index];
      if (!this.digitalGateAllows(cluster, index)) continue;
      const modeName = runtime?.mode ?? "both";
      if (mode === "absorb" && modeName === "eject") continue;
      if (mode === "eject" && modeName === "absorb") continue;
      const localX = index % cluster.rect.width;
      const localY = Math.floor(index / cluster.rect.width);
      if (!this.hasAdjacentPort(cluster, localX, localY, 0x0005)) continue;
      if (mode === "eject") {
        const direction = runtime?.direction ?? this.nearestSide(cluster, index);
        if (!this.canProjectToSide(cluster, localX, localY, direction)) continue;
        const outside = this.outsideCoordinate(cluster, localX, localY, direction);
        ports.push({ index, localX, localY, x: outside.x, y: outside.y, range: 1 });
      } else {
        const direction = runtime?.direction ?? this.nearestSide(cluster, index);
        const range = Number.isInteger(runtime?.range) ? Math.max(1, Math.min(32, runtime!.range!)) : 1;
        const outside = this.outsideCoordinate(cluster, localX, localY, direction);
        ports.push({ index, localX, localY, x: outside.x, y: outside.y, range });
      }
    }
    return ports.sort((a, b) => a.index - b.index);
  }

  private processReproductionIntents(): void {
    this.#reproductionIntents.sort((a, b) => a.clusterId - b.clusterId || a.organelleIndex - b.organelleIndex);
    for (const intent of this.#reproductionIntents) {
      const cluster = this.clusters.get(intent.clusterId);
      if (!cluster || cluster.hp <= 0n) continue;
      if (cluster.resources.amount < intent.costAmount || cluster.resources.energy < intent.costEnergy) continue;
      const localX = intent.organelleIndex % cluster.rect.width;
      const localY = Math.floor(intent.organelleIndex / cluster.rect.width);
      if (!this.canProjectToSide(cluster, localX, localY, intent.direction)) continue;
      const target = this.outsideCoordinate(cluster, localX, localY, intent.direction);
      try {
        this.createSeed(cluster.id, intent.geneHex, target.x, target.y);
        cluster.resources.amount -= intent.costAmount;
        cluster.resources.energy -= intent.costEnergy;
        const runtime = cluster.organelleRuntime[intent.organelleIndex];
        if (runtime) {
          runtime.compileBuffer = "";
          runtime.lastProducedTick = Number(this.tick);
        }
      } catch {
        // 目标格被占用时保留完整基因，并在后续 Tick 继续尝试。
      }
    }
    this.#reproductionIntents = [];
  }

  private outsideCoordinate(cluster: Cluster, localX: number, localY: number, direction: AlgaeDirection): { x: number; y: number } {
    return {
      x: wrap(cluster.rect.x + (direction === "left" ? -1 : direction === "right" ? cluster.rect.width : localX), WORLD_WIDTH),
      y: wrap(cluster.rect.y + (direction === "up" ? -1 : direction === "down" ? cluster.rect.height : localY), WORLD_HEIGHT),
    };
  }

  private cellOccupiedByWorld(x: number, y: number): boolean {
    const rect = { x: wrap(x, WORLD_WIDTH), y: wrap(y, WORLD_HEIGHT), width: 1, height: 1 };
    for (const cluster of this.clusters.values()) {
      if (toroidalRectsOverlap(rect, cluster.rect)) return true;
    }
    return false;
  }

  private saveCompileTemplate(cluster: Cluster, geneHex: string): void {
    for (let index = 0; index < cluster.organelles.length; index += 1) {
      if (cluster.organelles[index] === 0x000b) {
        const storage = cluster.organelleRuntime[index] ??= { enabled: true };
        storage.compileBuffer = geneHex;
      }
    }
  }

  private motionThresholdFor(cluster: Cluster): bigint {
    return isAlgaeStructure(cluster) ? clusterArea(cluster) * 4n : motionThreshold(cluster);
  }

  private runAlgaeLifecycle(): void {
    const algaeAtPhaseStart = [...this.clusters.values()].filter(isAlgaeStructure).sort(stableClusterSort);
    for (const cluster of algaeAtPhaseStart) {
      if (!this.clusters.has(cluster.id) || cluster.hp <= 0n) continue;
      cluster.algaeState ??= { age: 0 };
      cluster.algaeState.age += 1;
      if (cluster.algaeState.age % 60 === 0) {
        cluster.maxHp = cluster.maxHp > 8n ? cluster.maxHp - 1n : 8n;
        cluster.hp = cluster.hp > 0n ? cluster.hp - 1n : 0n;
        if (cluster.hp > cluster.maxHp) cluster.hp = cluster.maxHp;
      }
      const brightest = uniqueBrightestDirection(sampleAlgaeSides(cluster, this.light));
      if (!brightest) continue;
      if (cluster.algaeState.lockedDirection !== undefined && cluster.algaeState.lockedDirection !== brightest.direction) continue;
      if (isAlgaeAtMaximum(cluster)) this.trySplitAlgae(cluster, brightest.direction);
      else this.tryGrowAlgae(cluster, brightest.direction);
    }
  }

  private tryGrowAlgae(cluster: Cluster, direction: AlgaeDirection): void {
    if (cluster.algaeState?.lockedDirection === undefined) {
      cluster.algaeState = { age: cluster.algaeState?.age ?? 0, lockedDirection: direction };
    }
    if (cluster.algaeState.lockedDirection !== direction) return;
    const targetRect = grownAlgaeRect(cluster.rect, direction);
    if (targetRect.width > 6 || targetRect.height > 6) return;
    if (!this.growRectFree(targetRect, cluster.id)) return;
    const targetGrid = createAlgaeOrganelleGrid(targetRect.width, targetRect.height);
    const oldCodes = new Map<number, number>();
    for (let y = 0; y < cluster.rect.height; y += 1) {
      for (let x = 0; x < cluster.rect.width; x += 1) {
        const worldX = wrap(cluster.rect.x + x, WORLD_WIDTH);
        const worldY = wrap(cluster.rect.y + y, WORLD_HEIGHT);
        oldCodes.set(worldY * WORLD_WIDTH + worldX, cluster.organelles[y * cluster.rect.width + x]);
      }
    }
    let changed = 0n;
    for (let y = 0; y < targetRect.height; y += 1) {
      for (let x = 0; x < targetRect.width; x += 1) {
        const worldX = wrap(targetRect.x + x, WORLD_WIDTH);
        const worldY = wrap(targetRect.y + y, WORLD_HEIGHT);
        if (oldCodes.get(worldY * WORLD_WIDTH + worldX) !== targetGrid[y * targetRect.width + x]) changed += 1n;
      }
    }
    const amountCost = changed;
    const energyCost = ceilDiv(changed, 2n);
    if (cluster.resources.amount < amountCost || cluster.resources.energy < energyCost) return;
    const oldMax = cluster.maxHp;
    cluster.resources.amount -= amountCost;
    cluster.resources.energy -= energyCost;
    cluster.rect = targetRect;
    cluster.organelles = targetGrid;
    cluster.maxHp = clusterArea(cluster) * 4n;
    cluster.hp += cluster.maxHp - oldMax;
    this.indexCluster(cluster);
    validateClusterBoundary(cluster);
  }

  private trySplitAlgae(cluster: Cluster, direction: AlgaeDirection): void {
    const splitAmountCost = 4n;
    const splitEnergyCost = 2n;
    if (cluster.resources.amount < splitAmountCost || cluster.resources.energy < splitEnergyCost) return;
    const vertical = cluster.rect.height === 6;
    if ((vertical && direction !== "up" && direction !== "down") || (!vertical && direction !== "left" && direction !== "right")) return;
    const firstRect: ToroidalRect = { x: cluster.rect.x, y: cluster.rect.y, width: 3, height: 3 };
    const secondRect: ToroidalRect = vertical
      ? { x: cluster.rect.x, y: wrap(cluster.rect.y + 3, WORLD_HEIGHT), width: 3, height: 3 }
      : { x: wrap(cluster.rect.x + 3, WORLD_WIDTH), y: cluster.rect.y, width: 3, height: 3 };
    const totalAmount = cluster.resources.amount - splitAmountCost;
    const totalEnergy = cluster.resources.energy - splitEnergyCost;
    const totalPx = cluster.motion.px;
    const totalPy = cluster.motion.py;
    const brightIsFirst = direction === "up" || direction === "left";
    const firstAmount = totalAmount / 2n + (brightIsFirst ? totalAmount % 2n : 0n);
    const firstEnergy = totalEnergy / 2n + (brightIsFirst ? totalEnergy % 2n : 0n);
    const firstPx = totalPx / 2n + (brightIsFirst ? totalPx % 2n : 0n);
    const firstPy = totalPy / 2n + (brightIsFirst ? totalPy % 2n : 0n);

    cluster.rect = firstRect;
    cluster.organelles = createAlgaeOrganelleGrid(3, 3);
    cluster.maxHp = 36n;
    cluster.hp = cluster.hp > 36n ? 36n : cluster.hp;
    cluster.resources.amount = firstAmount;
    cluster.resources.energy = firstEnergy;
    cluster.motion.px = firstPx;
    cluster.motion.py = firstPy;
    cluster.algaeState = { age: 0 };

    const child = createCluster(this.#nextClusterId, secondRect);
    child.organelles = createAlgaeOrganelleGrid(3, 3);
    child.resources.amount = totalAmount - firstAmount;
    child.resources.energy = totalEnergy - firstEnergy;
    child.motion.px = totalPx - firstPx;
    child.motion.py = totalPy - firstPy;
    child.algaeState = { age: 0 };
    if (!this.growRectFree(child.rect)) return;
    validateClusterBoundary(child);
    this.clusters.set(child.id, child);
    this.signalBuses.set(child.id, new SignalBus());
    this.#nextClusterId += 1;
    this.indexCluster(cluster);
    this.indexCluster(child);
  }

  private applyImpactArmor(cluster: Cluster, rawDamage: bigint, normalX: number, normalY: number): bigint {
    const sides: bigint[] = [];
    if (normalX > 0) sides.push(cluster.armor.right);
    if (normalX < 0) sides.push(cluster.armor.left);
    if (normalY > 0) sides.push(cluster.armor.down);
    if (normalY < 0) sides.push(cluster.armor.up);
    const armor = sides.length === 0 ? 0n : sides.reduce((sum, value) => sum + value, 0n) / BigInt(sides.length);
    return (rawDamage * 16n) / (16n + armor);
  }

  private removeDeadClusters(): void {
    const deadMothers = new Set(
      [...this.clusters.values()].filter((cluster) => cluster.hp <= 0n).map((cluster) => cluster.id),
    );
    for (const seed of [...this.seeds.values()]) {
      if (seed.motherId !== null && deadMothers.has(seed.motherId)) this.seeds.delete(seed.id);
    }
    for (const cluster of this.clusters.values()) {
      if (cluster.lifecycle.kind === "developing" && deadMothers.has(cluster.lifecycle.motherId)) cluster.hp = 0n;
    }
    for (const cluster of [...this.clusters.values()].sort(stableClusterSort)) {
      if (cluster.hp > 0n) continue;
      const centerX = wrap(cluster.rect.x + Math.floor((cluster.rect.width - 1) / 2), WORLD_WIDTH);
      const centerY = wrap(cluster.rect.y + Math.floor((cluster.rect.height - 1) / 2), WORLD_HEIGHT);
      this.material.add(centerX, centerY, {
        amount: cluster.resources.amount,
        energy: cluster.resources.energy,
      });
      this.removeCluster(cluster.id);
    }
  }

  private assertNoOverlap(): void {
    const clusters = [...this.clusters.values()].sort(stableClusterSort);
    const bucketKey = (chunkX: number, chunkY: number): number => {
      const cx = ((chunkX % CHUNKS_X) + CHUNKS_X) % CHUNKS_X;
      const cy = ((chunkY % CHUNKS_Y) + CHUNKS_Y) % CHUNKS_Y;
      return cy * CHUNKS_X + cx;
    };
    const buckets = new Map<number, Cluster[]>();
    const touchedKeys = (cluster: Cluster): number[] => {
      const keys: number[] = [];
      for (const piece of splitToroidalRect(cluster.rect)) {
        const minX = Math.floor(piece.x / CHUNK_SIZE);
        const maxX = Math.floor((piece.x + piece.width - 1) / CHUNK_SIZE);
        const minY = Math.floor(piece.y / CHUNK_SIZE);
        const maxY = Math.floor((piece.y + piece.height - 1) / CHUNK_SIZE);
        for (let cy = minY; cy <= maxY; cy += 1) {
          for (let cx = minX; cx <= maxX; cx += 1) keys.push(bucketKey(cx, cy));
        }
      }
      return keys;
    };
    for (const cluster of clusters) {
      validateClusterBoundary(cluster);
      for (const key of touchedKeys(cluster)) {
        const bucket = buckets.get(key) ?? [];
        bucket.push(cluster);
        buckets.set(key, bucket);
      }
    }
    const checked = new Set<string>();
    const pairKey = (a: number, b: number): string => a < b ? `${a}-${b}` : `${b}-${a}`;
    for (const cluster of clusters) {
      for (const key of touchedKeys(cluster)) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const neighbor = buckets.get((key + dy * CHUNKS_X + dx + CHUNKS_X * CHUNKS_Y) % (CHUNKS_X * CHUNKS_Y)) ?? [];
            for (const other of neighbor) {
              if (other.id === cluster.id) continue;
              const pair = pairKey(cluster.id, other.id);
              if (checked.has(pair)) continue;
              checked.add(pair);
              if (toroidalRectsOverlap(cluster.rect, other.rect)) {
                throw new Error(`Tick ${this.tick}: 胞团 ${cluster.id} 与 ${other.id} 重叠`);
              }
            }
          }
        }
      }
    }
    const seeds = [...this.seeds.values()].sort((a, b) => a.id - b.id);
    for (let i = 0; i < seeds.length; i += 1) {
      const rect = { x: seeds[i].x, y: seeds[i].y, width: 1, height: 1 };
      for (const cluster of clusters) {
        if (toroidalRectsOverlap(rect, cluster.rect)) throw new Error(`种子 ${seeds[i].id} 与胞团 ${cluster.id} 重叠`);
      }
      for (let j = i + 1; j < seeds.length; j += 1) {
        if (seeds[i].x === seeds[j].x && seeds[i].y === seeds[j].y) throw new Error(`种子 ${seeds[i].id} 与 ${seeds[j].id} 重叠`);
      }
    }
  }

  private captureRollback(): string {
    return JSON.stringify(this.exportState());
  }

  private restoreRollback(serialized: string): void {
    const data = JSON.parse(serialized) as SerializedWorldState;
    const restored = World.fromState(data);
    this.tick = restored.tick;
    this.seed = restored.seed;
    this.light = restored.light;
    this.#nextClusterId = restored.#nextClusterId;
    this.#nextGroupId = restored.#nextGroupId;
    this.#nextSeedId = restored.#nextSeedId;
    this.clusters.clear();
    for (const [id, cluster] of restored.clusters) this.clusters.set(id, cluster);
    this.normalGroups.clear();
    for (const [id, group] of restored.normalGroups) this.normalGroups.set(id, group);
    this.seeds.clear();
    for (const [id, seed] of restored.seeds) this.seeds.set(id, seed);
    this.signalBuses.clear();
    for (const [id, bus] of restored.signalBuses) this.signalBuses.set(id, bus);
    this.material.clear();
    for (const cell of restored.material.entries()) this.material.set(cell.x, cell.y, cell);
  }

  private removeMemberFromGroup(groupId: number, clusterId: ClusterId): void {
    const group = this.normalGroups.get(groupId);
    if (!group) return;
    const index = group.memberIds.indexOf(clusterId);
    if (index < 0) return;
    group.memberIds.splice(index, 1);
    const cluster = this.clusters.get(clusterId);
    if (cluster) cluster.normalGroupId = undefined;
    if (group.memberIds.length < 2) {
      for (const remainingId of group.memberIds) {
        const remaining = this.clusters.get(remainingId);
        if (remaining) {
          remaining.normalGroupId = undefined;
          remaining.motion.px += group.px;
          remaining.motion.py += group.py;
        }
      }
      this.normalGroups.delete(groupId);
    }
  }

  private grouperCodes(cluster: Cluster): number[] {
    const codes: number[] = [];
    for (let index = 0; index < cluster.organelles.length; index += 1) {
      if (cluster.organelles[index] !== 0x000e || cluster.organelleRuntime[index]?.enabled === false) continue;
      const value = cluster.organelleRuntime[index]?.value ?? cluster.organelleRuntime[index]?.channel ?? 0;
      if (Number.isInteger(value) && value >= 0 && value <= 0xffff) codes.push(value);
    }
    return [...new Set(codes)].sort((a, b) => a - b);
  }

  private updateAutomaticGroups(): void {
    for (const group of [...this.normalGroups.values()].sort((a, b) => a.id - b.id)) {
      for (const memberId of [...group.memberIds]) {
        const member = this.clusters.get(memberId);
        if (!member || !this.grouperCodes(member).includes(group.code)) this.removeMemberFromGroup(group.id, memberId);
      }
    }
    const candidates = [...this.clusters.values()]
      .filter((cluster) => cluster.lifecycle.kind === "active" && cluster.normalGroupId === undefined && !isAlgaeStructure(cluster))
      .sort(stableClusterSort);
    for (let i = 0; i < candidates.length; i += 1) {
      const left = candidates[i];
      if (left.normalGroupId !== undefined) continue;
      const leftCodes = this.grouperCodes(left);
      if (leftCodes.length === 0) continue;
      for (let j = i + 1; j < candidates.length; j += 1) {
        const right = candidates[j];
        if (right.normalGroupId !== undefined || toroidalRectChebyshevDistance(left.rect, right.rect) > 1) continue;
        const rightCodes = this.grouperCodes(right);
        const code = leftCodes.find((value) => rightCodes.includes(value));
        if (code === undefined) continue;
        this.createNormalGroup(left.id, right.id, code);
        break;
      }
    }
  }

  private developingChildrenByMother(): Map<ClusterId, Cluster[]> {
    const result = new Map<ClusterId, Cluster[]>();
    for (const cluster of [...this.clusters.values()].sort(stableClusterSort)) {
      if (cluster.lifecycle.kind !== "developing") continue;
      const children = result.get(cluster.lifecycle.motherId) ?? [];
      children.push(cluster);
      result.set(cluster.lifecycle.motherId, children);
    }
    return result;
  }

  private advanceSignalBuses(): void {
    for (const [, bus] of [...this.signalBuses.entries()].sort(([a], [b]) => a - b)) bus.advanceTick();
  }

  private requireCluster(clusterId: ClusterId): Cluster {
    const cluster = this.clusters.get(clusterId);
    if (!cluster) throw new Error(`胞团 ${clusterId} 不存在`);
    if (!this.signalBuses.has(clusterId)) this.signalBuses.set(clusterId, new SignalBus());
    return cluster;
  }

  private firstAdjacentPortIndex(cluster: Cluster, sourceIndex: number, portCode: number): number | undefined {
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= cluster.organelles.length) throw new RangeError("器官索引越界");
    const x = sourceIndex % cluster.rect.width;
    const y = Math.floor(sourceIndex / cluster.rect.width);
    const candidates = [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]]
      .filter(([px, py]) => px >= 0 && py >= 0 && px < cluster.rect.width && py < cluster.rect.height)
      .map(([px, py]) => py * cluster.rect.width + px)
      .filter((index) => cluster.organelles[index] === portCode)
      .sort((a, b) => a - b);
    return candidates[0];
  }

  private matchingTransceivers(cluster: Cluster, busKind: "digital" | "compile"): Array<{ index: number; channel: number; range?: number }> {
    const portCode = busKind === "digital" ? 0x0007 : 0x0008;
    const result: Array<{ index: number; channel: number; range?: number }> = [];
    for (let index = 0; index < cluster.organelles.length; index += 1) {
      if (cluster.organelles[index] !== 0x000d || cluster.organelleRuntime[index]?.enabled === false) continue;
      const portIndex = this.firstAdjacentPortIndex(cluster, index, portCode);
      if (portIndex === undefined) continue;
      const channel = cluster.organelleRuntime[index]?.channel ?? 0;
      if ((cluster.organelleRuntime[portIndex]?.channel ?? 0) !== channel) continue;
      const range = cluster.organelleRuntime[index]?.range;
      result.push({ index, channel, range: Number.isInteger(range) ? Math.max(0, Math.min(Math.max(WORLD_WIDTH, WORLD_HEIGHT), range!)) : undefined });
    }
    return result.sort((a, b) => a.index - b.index);
  }

  private broadcastGroupSignal(senderClusterId: ClusterId, kind: "digital" | "compile", payload: number | string): void {
    const sender = this.requireCluster(senderClusterId);
    if (sender.normalGroupId === undefined) throw new Error("未编组胞团不能进行外部通信");
    const group = this.normalGroups.get(sender.normalGroupId);
    if (!group) throw new Error("发送者的普通群组不存在");
    const senderTransceivers = this.matchingTransceivers(sender, kind);
    if (senderTransceivers.length === 0) throw new Error("发送者缺少匹配且已接端口的外部收发器");
    for (const source of senderTransceivers) {
      const localX = source.index % sender.rect.width;
      const localY = Math.floor(source.index / sender.rect.width);
      for (const receiverId of [...group.memberIds].sort((a, b) => a - b)) {
        if (receiverId === senderClusterId) continue;
        const receiver = this.clusters.get(receiverId);
        if (!receiver || !this.matchingTransceivers(receiver, kind).some((item) => item.channel === source.channel)) continue;
        if (source.range !== undefined && toroidalRectChebyshevDistance(sender.rect, receiver.rect) > source.range) continue;
        if (kind === "digital") {
          this.signalBuses.get(receiverId)!.sendDigital({
            clusterId: senderClusterId,
            localX,
            localY,
            channel: source.channel,
            value: payload as number,
          });
        } else {
          this.signalBuses.get(receiverId)!.sendCompile({
            clusterId: senderClusterId,
            localX,
            localY,
            channel: source.channel,
            payload: payload as string,
          });
        }
      }
    }
  }
}

export interface SerializedWorldState {
  tick: string;
  seed: string;
  lightConfig: LightConfig;
  nextClusterId: number;
  nextGroupId: number;
  nextSeedId: number;
  clusters: Array<{
    id: number;
    rect: ToroidalRect;
    hp: string;
    maxHp: string;
    resources: {
      amount: string;
      energy: string;
      amountCapacityBonus: string;
      energyCapacityBonus: string;
    };
    motion: { px: string; py: string; density: string };
    armor: { up: string; right: string; down: string; left: string };
    organelles: number[];
    organelleRuntime: Cluster["organelleRuntime"];
    lifecycle: Cluster["lifecycle"];
    geneHex?: string;
    note?: string;
    normalGroupId?: number;
    algaeState?: Cluster["algaeState"];
  }>;
  material: Array<{ x: number; y: number; amount: string; energy: string }>;
  normalGroups: Array<{ id: number; code: number; memberIds: number[]; px: string; py: string }>;
  seeds: Array<{
    id: number;
    motherId: number | null;
    x: number;
    y: number;
    hp: string;
    amount: string;
    energy: string;
    geneHex: string;
    dormantTicks: number;
    familyPort: number;
    initialPx: string;
    initialPy: string;
    driveQueue: Point[];
  }>;
  customOrganelleDefinitions: Array<{
    code: number;
    kind: OrganelleKind;
    name: string;
    color: string;
    buildAmount: string;
    buildEnergy: string;
    recycleNumerator: string;
    recycleDenominator: string;
    ruleId: string;
  }>;
  declarativeRules: DeclarativeRule[];
  trustedRuleSources: TrustedRuleSource[];
  signalBuses: Array<{ clusterId: number; state: SerializedSignalBus }>;
}
