import { wrap } from "../geometry/torus";
import type { LightField } from "../light/LightField";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../model/constants";
import type { Cluster, ToroidalRect } from "../model/types";

export type AlgaeDirection = "up" | "right" | "down" | "left";

const DIRECTIONS: readonly AlgaeDirection[] = ["up", "right", "down", "left"];

export const sampleAlgaeSides = (cluster: Cluster, light: LightField): Record<AlgaeDirection, number> => {
  const { x, y, width, height } = cluster.rect;
  const result = { up: 0, right: 0, down: 0, left: 0 };
  for (let localX = 0; localX < width; localX += 1) {
    result.up += light.sample(x + localX, y - 1);
    result.down += light.sample(x + localX, y + height);
  }
  for (let localY = 0; localY < height; localY += 1) {
    result.left += light.sample(x - 1, y + localY);
    result.right += light.sample(x + width, y + localY);
  }
  result.up = Math.floor(result.up / width);
  result.down = Math.floor(result.down / width);
  result.left = Math.floor(result.left / height);
  result.right = Math.floor(result.right / height);
  return result;
};

export const uniqueBrightestDirection = (
  samples: Record<AlgaeDirection, number>,
): { direction: AlgaeDirection; highest: number; secondHighest: number } | undefined => {
  const ranked = DIRECTIONS.map((direction) => ({ direction, value: samples[direction] })).sort(
    (a, b) => b.value - a.value || DIRECTIONS.indexOf(a.direction) - DIRECTIONS.indexOf(b.direction),
  );
  if (ranked[0].value === ranked[1].value) return undefined;
  return { direction: ranked[0].direction, highest: ranked[0].value, secondHighest: ranked[1].value };
};

export const grownAlgaeRect = (rect: ToroidalRect, direction: AlgaeDirection): ToroidalRect => {
  switch (direction) {
    case "up": return { x: rect.x, y: wrap(rect.y - 1, WORLD_HEIGHT), width: rect.width, height: rect.height + 1 };
    case "right": return { ...rect, width: rect.width + 1 };
    case "down": return { ...rect, height: rect.height + 1 };
    case "left": return { x: wrap(rect.x - 1, WORLD_WIDTH), y: rect.y, width: rect.width + 1, height: rect.height };
  }
};

export const isAlgaeAtMaximum = (cluster: Cluster): boolean => Math.max(cluster.rect.width, cluster.rect.height) >= 6;

export const directionVector = (direction: AlgaeDirection): { x: -1 | 0 | 1; y: -1 | 0 | 1 } => {
  switch (direction) {
    case "up": return { x: 0, y: -1 };
    case "right": return { x: 1, y: 0 };
    case "down": return { x: 0, y: 1 };
    case "left": return { x: -1, y: 0 };
  }
};
