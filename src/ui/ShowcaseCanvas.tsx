import { useEffect, useRef } from "preact/hooks";
import type { FunctionComponent } from "preact";
import { WebGLWorldRenderer } from "../renderer/WebGLWorldRenderer";
import { buildShowcaseWorld, SHOWCASE_CAMERA } from "../templates/showcase";
import { wrap, toroidalRectsOverlap } from "../geometry/torus";

const FRAME_INTERVAL_MS = 140;
const LAYERS = { clusters: true, material: true, light: false } as const;

export const ShowcaseCanvas: FunctionComponent = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGLWorldRenderer>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: WebGLWorldRenderer;
    try {
      renderer = new WebGLWorldRenderer(canvas);
    } catch {
      return;
    }
    rendererRef.current = renderer;
    let world = buildShowcaseWorld(1n);
    let ticks = 0;
    const centerX = SHOWCASE_CAMERA.x;
    const centerY = SHOWCASE_CAMERA.y;
    renderer.render(world.snapshot(true), SHOWCASE_CAMERA, LAYERS, undefined, { showOrganelles: true });
    const timer = window.setInterval(() => {
      ticks += 1;
      if (ticks > 600) {
        world = buildShowcaseWorld(1n);
        ticks = 0;
      }
      // 每 2 帧移动一次：单纯位移，关闭运动阈值与碰撞判定，仅保证不重叠。
      if (ticks % 2 === 0) {
        for (const cluster of world.clusters.values()) {
          const cx = cluster.rect.x + cluster.rect.width / 2;
          const cy = cluster.rect.y + cluster.rect.height / 2;
          let dx = ((Math.random() * 3) | 0) - 1;
          let dy = ((Math.random() * 3) | 0) - 1;
          if (Math.abs(cx - centerX) > 22) dx = Math.sign(centerX - cx);
          if (Math.abs(cy - centerY) > 18) dy = Math.sign(centerY - cy);
          if (dx === 0 && dy === 0) continue;
          const target = {
            x: wrap(cluster.rect.x + dx, world.width),
            y: wrap(cluster.rect.y + dy, world.height),
            width: cluster.rect.width,
            height: cluster.rect.height,
          };
          let free = true;
          for (const other of world.clusters.values()) {
            if (other.id !== cluster.id && toroidalRectsOverlap(target, other.rect)) {
              free = false;
              break;
            }
          }
          if (free) cluster.rect = target;
        }
      }
      try {
        world.step();
      } catch {
        // 展示世界若出现异常则保持当前画面，不中断弹窗。
      }
      // 仅展示界面：不死亡，回满血量与健康值并补足能量。
      for (const cluster of world.clusters.values()) {
        cluster.hp = cluster.maxHp;
        cluster.health = 64;
        if (cluster.resources.energy < 120n) cluster.resources.energy = 120n;
      }
      renderer.render(world.snapshot(true), SHOWCASE_CAMERA, LAYERS, undefined, { showOrganelles: true });
    }, FRAME_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div class="showcase">
      <span class="showcase-label">复杂团簇实时演示 · 自动运转</span>
      <canvas ref={canvasRef} class="showcase-canvas" />
    </div>
  );
};
