import { toroidalRectsOverlap, translateRect } from "../geometry/torus";
import { ChunkSpatialIndex } from "../geometry/ChunkSpatialIndex";
import type {
  BodySnapshot,
  CollisionContact,
  DamageEvent,
  MovementResolution,
  MoveIntent,
  Point,
  PointBigInt,
  ToroidalRect,
} from "../model/types";

const ZERO_MOVE: Point = Object.freeze({ x: 0, y: 0 });
const ZERO_IMPULSE: PointBigInt = Object.freeze({ x: 0n, y: 0n });
const abs = (value: bigint): bigint => (value < 0n ? -value : value);
const sign = (value: number): -1 | 0 | 1 => (value < 0 ? -1 : value > 0 ? 1 : 0);

const anyOverlap = (left: readonly ToroidalRect[], right: readonly ToroidalRect[]): boolean =>
  left.some((a) => right.some((b) => toroidalRectsOverlap(a, b)));

const movedRects = (body: BodySnapshot, move: Point): ToroidalRect[] =>
  body.rects.map((rect) => translateRect(rect, move.x, move.y));

const deriveContact = (a: BodySnapshot, b: BodySnapshot, aMove: Point, bMove: Point): CollisionContact => {
  const relativeX = aMove.x - bMove.x;
  const relativeY = aMove.y - bMove.y;
  let normalX = sign(relativeX);
  let normalY = sign(relativeY);
  if (normalX === 0 && normalY === 0) {
    const ar = a.rects[0];
    const br = b.rects[0];
    normalX = sign(br.x - ar.x);
    normalY = sign(br.y - ar.y);
    if (abs(BigInt(br.x - ar.x)) > abs(BigInt(br.y - ar.y))) normalY = 0;
    else if (abs(BigInt(br.y - ar.y)) > abs(BigInt(br.x - ar.x))) normalX = 0;
  }
  return { a: a.id, b: b.id, normalX, normalY };
};

const validatePlacement = (
  bodies: readonly BodySnapshot[],
  displacement: ReadonlyMap<string, Point>,
): boolean => {
  const index = new ChunkSpatialIndex<string>();
  for (const body of bodies) {
    index.insert(body.id, movedRects(body, displacement.get(body.id) ?? ZERO_MOVE));
  }
  const pairs = index.candidatePairs((a, b) => a.localeCompare(b));
  if (pairs.length === 0) return true;
  const bodyById = new Map(bodies.map((body) => [body.id, body]));
  for (const [aId, bId] of pairs) {
    const a = bodyById.get(aId)!;
    const b = bodyById.get(bId)!;
    if (
      anyOverlap(
        movedRects(a, displacement.get(a.id) ?? ZERO_MOVE),
        movedRects(b, displacement.get(b.id) ?? ZERO_MOVE),
      )
    ) return false;
  }
  return true;
};

const contactComponents = (ids: readonly string[], contacts: readonly CollisionContact[]): string[][] => {
  const adjacency = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const contact of contacts) {
    adjacency.get(contact.a)?.add(contact.b);
    adjacency.get(contact.b)?.add(contact.a);
  }
  const visited = new Set<string>();
  const components: string[][] = [];
  for (const start of [...ids].sort()) {
    if (visited.has(start)) continue;
    const stack = [start];
    const component: string[] = [];
    visited.add(start);
    while (stack.length > 0) {
      const id = stack.pop()!;
      component.push(id);
      for (const neighbor of [...(adjacency.get(id) ?? [])].sort().reverse()) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
    }
    components.push(component.sort());
  }
  return components;
};

const directionalMomentum = (body: BodySnapshot, direction: Point): bigint => {
  const projected = body.px * BigInt(direction.x) + body.py * BigInt(direction.y);
  return projected > 0n ? projected : 0n;
};

const directionalThreshold = (body: BodySnapshot, direction: Point): bigint =>
  direction.x !== 0 ? body.thresholdX : body.thresholdY;

const tryChainPush = (
  component: readonly BodySnapshot[],
  allBodies: readonly BodySnapshot[],
  committed: ReadonlyMap<string, Point>,
  intended: ReadonlyMap<string, Point>,
): Point | undefined => {
  if (component.some((body) => body.immovable)) return undefined;
  const candidates: Point[] = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  for (const direction of candidates) {
    const hasInitiator = component.some((body) => {
      const move = intended.get(body.id) ?? ZERO_MOVE;
      return move.x === direction.x && move.y === direction.y;
    });
    if (!hasInitiator) continue;
    const momentum = component.reduce((sum, body) => sum + directionalMomentum(body, direction), 0n);
    const threshold = component.reduce((sum, body) => sum + directionalThreshold(body, direction), 0n);
    if (momentum < threshold) continue;
    const trial = new Map(committed);
    for (const body of component) trial.set(body.id, direction);
    if (validatePlacement(allBodies, trial)) return direction;
  }
  return undefined;
};

const rawCollisionDamage = (a: BodySnapshot, b: BodySnapshot, contact: CollisionContact): bigint => {
  const denominator = a.thresholdX * b.thresholdX;
  if (denominator === 0n) return 0n;
  const relativeNumerator =
    (a.px * b.thresholdX - b.px * a.thresholdX) * BigInt(contact.normalX) +
    (a.py * b.thresholdY - b.py * a.thresholdY) * BigInt(contact.normalY);
  const relative = abs(relativeNumerator);
  if (relative === 0n) return 0n;
  const reducedMassNumerator = a.mass * b.mass;
  const reducedMassDenominator = a.mass + b.mass;
  const numerator = reducedMassNumerator * relative * relative;
  const divisor = 2n * reducedMassDenominator * denominator * denominator;
  return (numerator + divisor - 1n) / divisor;
};

const accumulateImpulse = (
  target: Map<string, PointBigInt>,
  id: string,
  x: bigint,
  y: bigint,
): void => {
  const current = target.get(id) ?? ZERO_IMPULSE;
  target.set(id, { x: current.x + x, y: current.y + y });
};

export const resolveMovements = (
  bodiesInput: readonly BodySnapshot[],
  intents: readonly MoveIntent[],
): MovementResolution => {
  const bodies = [...bodiesInput].sort((a, b) => a.id.localeCompare(b.id));
  if (!validatePlacement(bodies, new Map())) throw new Error("Tick 开始时已经存在重叠");
  const bodyById = new Map(bodies.map((body) => [body.id, body]));
  const intentById = new Map(intents.map((intent) => [intent.bodyId, intent]));
  const intended = new Map<string, Point>();
  for (const body of bodies) {
    const intent = intentById.get(body.id);
    intended.set(body.id, intent ? { x: intent.dx, y: intent.dy } : ZERO_MOVE);
  }

  const broadphase = new ChunkSpatialIndex<string>();
  for (const body of bodies) {
    const move = intended.get(body.id) ?? ZERO_MOVE;
    broadphase.insert(body.id, [...body.rects, ...movedRects(body, move)]);
  }
  const contacts: CollisionContact[] = [];
  for (const [aId, bId] of broadphase.candidatePairs((a, b) => a.localeCompare(b))) {
      const a = bodyById.get(aId)!;
      const b = bodyById.get(bId)!;
      const aMove = intended.get(a.id) ?? ZERO_MOVE;
      const bMove = intended.get(b.id) ?? ZERO_MOVE;
      const aDesired = movedRects(a, aMove);
      const bDesired = movedRects(b, bMove);
      const sweptContact =
        anyOverlap(aDesired, bDesired) ||
        anyOverlap(aDesired, b.rects) ||
        anyOverlap(a.rects, bDesired);
      if (sweptContact && (aMove.x !== 0 || aMove.y !== 0 || bMove.x !== 0 || bMove.y !== 0)) {
        contacts.push(deriveContact(a, b, aMove, bMove));
      }
  }

  const displacement = new Map<string, Point>();
  const contactedIds = new Set(contacts.flatMap((contact) => [contact.a, contact.b]));
  for (const body of bodies) {
    if (!contactedIds.has(body.id)) displacement.set(body.id, intended.get(body.id) ?? ZERO_MOVE);
  }

  const components = contactComponents([...contactedIds], contacts);
  for (const ids of components) {
    const component = ids.map((id) => bodyById.get(id)!);
    const trial = new Map(displacement);
    for (const body of component) trial.set(body.id, intended.get(body.id) ?? ZERO_MOVE);
    if (validatePlacement(bodies, trial)) {
      for (const body of component) displacement.set(body.id, trial.get(body.id) ?? ZERO_MOVE);
      continue;
    }

    const chainDirection = tryChainPush(component, bodies, displacement, intended);
    if (chainDirection) {
      for (const body of component) displacement.set(body.id, chainDirection);
      continue;
    }

    for (const body of component) displacement.set(body.id, ZERO_MOVE);
    const xTrial = new Map(displacement);
    for (const body of component) {
      const move = intended.get(body.id) ?? ZERO_MOVE;
      xTrial.set(body.id, { x: move.x, y: 0 });
    }
    if (validatePlacement(bodies, xTrial)) {
      for (const body of component) displacement.set(body.id, xTrial.get(body.id) ?? ZERO_MOVE);
    }
    const yTrial = new Map(displacement);
    for (const body of component) {
      const move = intended.get(body.id) ?? ZERO_MOVE;
      const prior = yTrial.get(body.id) ?? ZERO_MOVE;
      yTrial.set(body.id, { x: prior.x, y: move.y });
    }
    if (validatePlacement(bodies, yTrial)) {
      for (const body of component) displacement.set(body.id, yTrial.get(body.id) ?? ZERO_MOVE);
    }
  }

  if (!validatePlacement(bodies, displacement)) throw new Error("移动求解器未能保证最终无重叠");

  const damageByCluster = new Map<number, bigint>();
  const damageEvents: DamageEvent[] = [];
  const impulseByBody = new Map<string, PointBigInt>();
  for (const contact of contacts) {
    const a = bodyById.get(contact.a)!;
    const b = bodyById.get(contact.b)!;
    const rawDamage = rawCollisionDamage(a, b, contact);
    if (rawDamage > 0n) {
      const aShare = (rawDamage + BigInt(a.clusterIds.length) - 1n) / BigInt(a.clusterIds.length);
      const bShare = (rawDamage + BigInt(b.clusterIds.length) - 1n) / BigInt(b.clusterIds.length);
      for (const id of a.clusterIds) {
        damageByCluster.set(id, (damageByCluster.get(id) ?? 0n) + aShare);
        damageEvents.push({ clusterId: id, rawDamage: aShare, normalX: contact.normalX, normalY: contact.normalY });
      }
      for (const id of b.clusterIds) {
        damageByCluster.set(id, (damageByCluster.get(id) ?? 0n) + bShare);
        damageEvents.push({
          clusterId: id,
          rawDamage: bShare,
          normalX: (-contact.normalX) as -1 | 0 | 1,
          normalY: (-contact.normalY) as -1 | 0 | 1,
        });
      }
    }

    const totalMass = a.mass + b.mass;
    if (contact.normalX !== 0) {
      const sharedPxNumerator = a.mass * a.px * b.thresholdX + b.mass * b.px * a.thresholdX;
      const sharedA = sharedPxNumerator / (totalMass * b.thresholdX);
      const sharedB = sharedPxNumerator / (totalMass * a.thresholdX);
      accumulateImpulse(impulseByBody, a.id, sharedA - a.px, 0n);
      accumulateImpulse(impulseByBody, b.id, sharedB - b.px, 0n);
    }
    if (contact.normalY !== 0) {
      const sharedPyNumerator = a.mass * a.py * b.thresholdY + b.mass * b.py * a.thresholdY;
      const sharedA = sharedPyNumerator / (totalMass * b.thresholdY);
      const sharedB = sharedPyNumerator / (totalMass * a.thresholdY);
      accumulateImpulse(impulseByBody, a.id, 0n, sharedA - a.py);
      accumulateImpulse(impulseByBody, b.id, 0n, sharedB - b.py);
    }
  }

  const acceptedBodies = new Set(
    [...displacement.entries()].filter(([, move]) => move.x !== 0 || move.y !== 0).map(([id]) => id),
  );
  return { acceptedBodies, displacementByBody: displacement, contacts, damageByCluster, damageEvents, impulseByBody };
};
