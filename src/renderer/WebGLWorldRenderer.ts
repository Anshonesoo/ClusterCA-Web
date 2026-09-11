import { WORLD_HEIGHT, WORLD_WIDTH } from "../model/constants";
import type { WorldSnapshot } from "../model/types";

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface LayerVisibility {
  clusters: boolean;
  material: boolean;
  light: boolean;
}

export interface ViewOptions {
  showGrid?: boolean;
  backgroundColor?: [number, number, number];
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const splitSegment = (start: number, span: number, size: number): Array<[number, number]> => {
  if (span >= size) return [[0, size]];
  const lo = ((start % size) + size) % size;
  const hi = lo + span;
  if (hi <= size) return [[lo, hi]];
  return [[lo, size], [0, hi - size]];
};

const rectSpanParts = (start: number, length: number, size: number): Array<[number, number]> => {
  const lo = ((start % size) + size) % size;
  const parts: Array<[number, number]> = [];
  let cursor = lo;
  let remaining = length;
  while (remaining > 0) {
    const take = Math.min(remaining, size - cursor);
    parts.push([cursor, cursor + take]);
    cursor = 0;
    remaining -= take;
  }
  return parts;
};

const segmentOverlaps = (parts: Array<[number, number]>, segments: Array<[number, number]>): boolean =>
  parts.some(([p0, p1]) => segments.some(([s0, s1]) => p0 < s1 && p1 > s0));

export class WebGLWorldRenderer {
  readonly #canvas: HTMLCanvasElement;
  readonly #gl: WebGL2RenderingContext;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false });
    if (!gl) throw new Error("当前浏览器不支持 WebGL2");
    this.#canvas = canvas;
    this.#gl = gl;
    gl.enable(gl.SCISSOR_TEST);
  }

  resize(): void {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(this.#canvas.clientWidth * ratio));
    const height = Math.max(1, Math.floor(this.#canvas.clientHeight * ratio));
    if (this.#canvas.width !== width || this.#canvas.height !== height) {
      this.#canvas.width = width;
      this.#canvas.height = height;
    }
    this.#gl.viewport(0, 0, width, height);
  }

  render(snapshot: WorldSnapshot, camera: Camera, layers: LayerVisibility, selectedId?: number, options?: ViewOptions): void {
    this.resize();
    const gl = this.#gl;
    const lightBase = layers.light ? 0.055 : 0.025;
    const baseColor: [number, number, number] = options?.backgroundColor ?? [lightBase, lightBase * 1.35, lightBase * 1.2];
    const backgroundColor: [number, number, number] = layers.light
      ? [
          baseColor[0] + (0.45 - baseColor[0]) * 0.35,
          baseColor[1] + (0.38 - baseColor[1]) * 0.35,
          baseColor[2] + (0.18 - baseColor[2]) * 0.35,
        ]
      : baseColor;
    gl.scissor(0, 0, this.#canvas.width, this.#canvas.height);
    gl.clearColor(backgroundColor[0], backgroundColor[1], backgroundColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (options?.showGrid) this.drawGrid(camera, backgroundColor);

    const halfW = this.#canvas.clientWidth / camera.zoom / 2;
    const halfH = this.#canvas.clientHeight / camera.zoom / 2;
    const xSegments = splitSegment(camera.x - halfW, halfW * 2, WORLD_WIDTH);
    const ySegments = splitSegment(camera.y - halfH, halfH * 2, WORLD_HEIGHT);
    const inView = (x: number, y: number, w: number, h: number): boolean =>
      segmentOverlaps(rectSpanParts(x, w, WORLD_WIDTH), xSegments)
      && segmentOverlaps(rectSpanParts(y, h, WORLD_HEIGHT), ySegments);

    if (layers.material) {
      for (const cell of snapshot.materialCells) {
        if (!inView(cell.x, cell.y, 1, 1)) continue;
        const energy = Number(cell.energy);
        const amount = Number(cell.amount);
        const strength = clamp01(Math.log2(Math.abs(energy) + amount + 1) / 8);
        const color: [number, number, number] = energy < 0
          ? [0.42 * strength, 0.28 * strength, 0.15 * strength]
          : [0.62 * strength, 0.43 * strength, 0.24 * strength];
        this.drawToroidalRect(cell.x, cell.y, 1, 1, camera, color);
      }
    }

    if (layers.clusters) {
      for (const seed of snapshot.seeds) {
        if (!inView(seed.x, seed.y, 1, 1)) continue;
        this.drawToroidalRect(seed.x, seed.y, 1, 1, camera, [0.95, 0.42, 0.68]);
      }
      for (const cluster of snapshot.clusters) {
        if (!inView(cluster.x, cluster.y, cluster.width, cluster.height)) continue;
        const selected = cluster.id === selectedId;
        const gene = cluster.geneHex ? geneColorFor(cluster.geneHex) : undefined;
        const outline: [number, number, number] = selected
          ? [1, 0.76, 0.28]
          : gene ?? [0.35, 0.9, 0.72];
        if (camera.zoom >= 16) {
          this.drawToroidalOutline(
            cluster.x,
            cluster.y,
            cluster.width,
            cluster.height,
            camera,
            outline,
            selected ? 4 : 3,
          );
          this.drawToroidalRect(cluster.x, cluster.y, 1, 1, camera, [0.72, 0.9, 0.84]);
          this.drawToroidalRect(cluster.x + cluster.width - 1, cluster.y, 1, 1, camera, [0.72, 0.9, 0.84]);
          this.drawToroidalRect(cluster.x, cluster.y + cluster.height - 1, 1, 1, camera, [0.72, 0.9, 0.84]);
          this.drawToroidalRect(
            cluster.x + cluster.width - 1,
            cluster.y + cluster.height - 1,
            1,
            1,
            camera,
            [0.72, 0.9, 0.84],
          );
          for (let index = 0; index < cluster.organelles.length; index += 1) {
            const code = cluster.organelles[index];
            if (code === 0 || code === 1) continue;
            const localX = index % cluster.width;
            const localY = Math.floor(index / cluster.width);
            this.drawToroidalRect(
              cluster.x + localX + 0.16,
              cluster.y + localY + 0.16,
              0.68,
              0.68,
              camera,
              organelleColor(code),
            );
          }
        } else {
          const fill: [number, number, number] = selected
            ? [0.55, 0.4, 0.12]
            : gene ? geneColorFor(cluster.geneHex!, 0.3) : [0.2, 0.56, 0.46];
          this.drawToroidalRect(cluster.x, cluster.y, cluster.width, cluster.height, camera, fill);
          this.drawToroidalOutline(cluster.x, cluster.y, cluster.width, cluster.height, camera, outline, 2);
        }
      }
    }
  }

  screenToWorld(clientX: number, clientY: number, camera: Camera): { x: number; y: number } {
    const bounds = this.#canvas.getBoundingClientRect();
    const x = camera.x + (clientX - bounds.left - bounds.width / 2) / camera.zoom;
    const y = camera.y + (clientY - bounds.top - bounds.height / 2) / camera.zoom;
    return {
      x: ((Math.floor(x) % WORLD_WIDTH) + WORLD_WIDTH) % WORLD_WIDTH,
      y: ((Math.floor(y) % WORLD_HEIGHT) + WORLD_HEIGHT) % WORLD_HEIGHT,
    };
  }

  private drawToroidalOutline(
    x: number,
    y: number,
    width: number,
    height: number,
    camera: Camera,
    color: [number, number, number],
    thickness: number,
  ): void {
    const pixelThickness = Math.max(thickness, Math.floor(camera.zoom * 0.15));
    const worldThickness = pixelThickness / camera.zoom;
    for (const offsetX of [-WORLD_WIDTH, 0, WORLD_WIDTH]) {
      for (const offsetY of [-WORLD_HEIGHT, 0, WORLD_HEIGHT]) {
        const wx = x + offsetX;
        const wy = y + offsetY;
        this.drawWorldRect(wx, wy, width, worldThickness, camera, color);
        this.drawWorldRect(wx, wy + height - worldThickness, width, worldThickness, camera, color);
        this.drawWorldRect(wx, wy, worldThickness, height, camera, color);
        this.drawWorldRect(wx + width - worldThickness, wy, worldThickness, height, camera, color);
      }
    }
  }

  private drawToroidalRect(
    x: number,
    y: number,
    width: number,
    height: number,
    camera: Camera,
    color: [number, number, number],
  ): void {
    for (const offsetX of [-WORLD_WIDTH, 0, WORLD_WIDTH]) {
      for (const offsetY of [-WORLD_HEIGHT, 0, WORLD_HEIGHT]) {
        this.drawWorldRect(x + offsetX, y + offsetY, width, height, camera, color);
      }
    }
  }

  private drawWorldRect(
    x: number,
    y: number,
    width: number,
    height: number,
    camera: Camera,
    color: [number, number, number],
  ): void {
    const wx0 = Math.max(0, x);
    const wx1 = Math.min(WORLD_WIDTH, x + width);
    const wy0 = Math.max(0, y);
    const wy1 = Math.min(WORLD_HEIGHT, y + height);
    if (wx1 <= wx0 || wy1 <= wy0) return;
    const screen = this.worldToScreen(wx0, wy0, camera);
    this.clearRect(screen.x, screen.y, (wx1 - wx0) * camera.zoom, (wy1 - wy0) * camera.zoom, color);
  }

  private worldToScreen(x: number, y: number, camera: Camera): { x: number; y: number } {
    return {
      x: this.#canvas.width / 2 + (x - camera.x) * camera.zoom,
      y: this.#canvas.height / 2 + (y - camera.y) * camera.zoom,
    };
  }

  private drawGrid(camera: Camera, _background: [number, number, number]): void {
    const thinMode = camera.zoom >= 6;
    const majorColor: [number, number, number] = thinMode ? [0.82, 0.85, 0.84] : [0.74, 0.78, 0.76];
    const minorColor: [number, number, number] = [0.8, 0.84, 0.82];
    const majorWidth = thinMode ? 0.4 : 1;
    const canvasWidth = this.#canvas.width;
    const canvasHeight = this.#canvas.height;
    const halfW = canvasWidth / camera.zoom / 2;
    const halfH = canvasHeight / camera.zoom / 2;
    const x0 = Math.floor(camera.x - halfW);
    const x1 = Math.ceil(camera.x + halfW);
    const y0 = Math.floor(camera.y - halfH);
    const y1 = Math.ceil(camera.y + halfH);

    const drawLines = (
      step: number,
      vertical: boolean,
      from: number,
      to: number,
      axisLine: (coord: number) => void,
    ): void => {
      const limit = vertical ? WORLD_WIDTH : WORLD_HEIGHT;
      const first = Math.max(0, Math.ceil(from / step) * step);
      for (let coord = first; coord <= to && coord < limit; coord += step) axisLine(coord);
    };

    drawLines(64, true, x0, x1, (coord) => this.drawWorldRect(coord - majorWidth / 2, 0, majorWidth, WORLD_HEIGHT, camera, majorColor));
    drawLines(64, false, y0, y1, (coord) => this.drawWorldRect(0, coord - majorWidth / 2, WORLD_WIDTH, majorWidth, camera, majorColor));

    if (thinMode) {
      drawLines(1, true, x0, x1, (coord) => this.drawWorldRect(coord - 0.06, 0, 0.12, WORLD_HEIGHT, camera, minorColor));
      drawLines(1, false, y0, y1, (coord) => this.drawWorldRect(0, coord - 0.06, WORLD_WIDTH, 0.12, camera, minorColor));
    }
  }

  private clearRect(
    x: number,
    yFromTop: number,
    width: number,
    height: number,
    color: [number, number, number],
  ): void {
    const gl = this.#gl;
    const left = Math.floor(x);
    const bottom = Math.floor(this.#canvas.height - yFromTop - height);
    const w = Math.ceil(width);
    const h = Math.ceil(height);
    if (left + w < 0 || bottom + h < 0 || left > this.#canvas.width || bottom > this.#canvas.height) return;
    gl.scissor(left, bottom, Math.max(0, w), Math.max(0, h));
    gl.clearColor(color[0], color[1], color[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
}

const organelleColor = (code: number): [number, number, number] => {
  const colors: Record<number, [number, number, number]> = {
    2: [0.96, 0.8, 0.35], 3: [0.42, 0.82, 0.36], 4: [0.76, 0.55, 0.31],
    5: [0.93, 0.68, 0.42], 6: [0.26, 0.72, 0.59], 7: [0.28, 0.58, 0.94],
    8: [0.48, 0.42, 0.95], 9: [0.72, 0.4, 0.85], 10: [0.27, 0.77, 0.85],
    11: [0.57, 0.4, 0.84], 12: [0.7, 0.3, 0.81], 13: [0.25, 0.65, 0.86],
    14: [0.94, 0.46, 0.35], 15: [0.96, 0.29, 0.27], 16: [0.4, 0.55, 0.6],
    17: [0.96, 0.53, 0.23], 18: [0.9, 0.32, 0.62],
  };
  return colors[code] ?? [0.78, 0.78, 0.78];
};

const hueToRgb = (p: number, q: number, t: number): number => {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + (q - p) * 6 * value;
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
  return p;
};

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    hueToRgb(p, q, h + 1 / 3),
    hueToRgb(p, q, h),
    hueToRgb(p, q, h - 1 / 3),
  ];
};

const geneColorFor = (geneHex: string, lightness = 0.62): [number, number, number] => {
  const head = geneHex.slice(8, 16) || "0";
  const value = Number.parseInt(head, 16) || 0;
  const hue = ((value & 0xffff) % 360) / 360;
  return hslToRgb(hue, 0.6, lightness);
};
