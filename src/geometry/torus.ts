import { WORLD_HEIGHT, WORLD_WIDTH } from "../model/constants";
import type { Point, ToroidalRect } from "../model/types";

export const wrap = (value: number, size: number): number => {
  const remainder = value % size;
  return remainder < 0 ? remainder + size : remainder;
};

export const wrapPoint = (point: Point): Point => ({
  x: wrap(point.x, WORLD_WIDTH),
  y: wrap(point.y, WORLD_HEIGHT),
});

export const translateRect = (rect: ToroidalRect, dx: number, dy: number): ToroidalRect => ({
  ...rect,
  x: wrap(rect.x + dx, WORLD_WIDTH),
  y: wrap(rect.y + dy, WORLD_HEIGHT),
});

interface PlainRect extends ToroidalRect {}

const splitAxis = (start: number, length: number, size: number): Array<[number, number]> => {
  if (!Number.isInteger(start) || !Number.isInteger(length) || length <= 0 || length > size) {
    throw new RangeError(`非法环面区间: start=${start}, length=${length}, size=${size}`);
  }
  const normalized = wrap(start, size);
  const end = normalized + length;
  if (end <= size) return [[normalized, length]];
  return [
    [normalized, size - normalized],
    [0, end - size],
  ];
};

export const splitToroidalRect = (rect: ToroidalRect): PlainRect[] => {
  const xs = splitAxis(rect.x, rect.width, WORLD_WIDTH);
  const ys = splitAxis(rect.y, rect.height, WORLD_HEIGHT);
  const pieces: PlainRect[] = [];
  for (const [x, width] of xs) {
    for (const [y, height] of ys) pieces.push({ x, y, width, height });
  }
  return pieces;
};

export const plainRectsOverlap = (a: PlainRect, b: PlainRect): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export const toroidalRectsOverlap = (a: ToroidalRect, b: ToroidalRect): boolean => {
  const aPieces = splitToroidalRect(a);
  const bPieces = splitToroidalRect(b);
  return aPieces.some((left) => bPieces.some((right) => plainRectsOverlap(left, right)));
};

export const assertValidRect = (rect: ToroidalRect): void => {
  if (
    !Number.isInteger(rect.x) ||
    !Number.isInteger(rect.y) ||
    !Number.isInteger(rect.width) ||
    !Number.isInteger(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.width > WORLD_WIDTH ||
    rect.height > WORLD_HEIGHT
  ) {
    throw new RangeError(`非法胞团矩形: ${JSON.stringify(rect)}`);
  }
};

export const toroidalDelta = (from: number, to: number, size: number): number => {
  const direct = wrap(to - from, size);
  return direct > size / 2 ? direct - size : direct;
};

const axisGap = (aStart: number, aLength: number, bStart: number, bLength: number): number => {
  const aEnd = aStart + aLength;
  const bEnd = bStart + bLength;
  if (aEnd < bStart) return bStart - aEnd;
  if (bEnd < aStart) return aStart - bEnd;
  return 0;
};

export const toroidalRectChebyshevDistance = (a: ToroidalRect, b: ToroidalRect): number => {
  let best = Number.POSITIVE_INFINITY;
  for (const offsetX of [-WORLD_WIDTH, 0, WORLD_WIDTH]) {
    for (const offsetY of [-WORLD_HEIGHT, 0, WORLD_HEIGHT]) {
      const gapX = axisGap(a.x, a.width, b.x + offsetX, b.width);
      const gapY = axisGap(a.y, a.height, b.y + offsetY, b.height);
      best = Math.min(best, Math.max(gapX, gapY));
    }
  }
  return best;
};
