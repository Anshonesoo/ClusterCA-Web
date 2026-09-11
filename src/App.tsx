import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ClusterView, WorldSnapshot } from "./model/types";
import { WebGLWorldRenderer, type Camera, type LayerVisibility } from "./renderer/WebGLWorldRenderer";
import type { WorkerCommand, WorkerEvent } from "./worker/protocol";
import { loadLatestAutosave, saveAutosaveRevision } from "./persistence/AutosaveStore";
import {
  loadSettings,
  saveSettings,
  applySettings,
  pickExportDirectory,
  getExportDirectory,
  resolveBackground,
  AUTHOR,
  VERSION,
  type AppSettings,
} from "./settings/settings";
import { translate, formatText, type TranslationKey } from "./settings/i18n";
import { SettingsModal } from "./ui/SettingsModal";
import { TourGuide } from "./ui/TourGuide";
import { TeachingPanel } from "./ui/TeachingPanel";
import { ShowcaseCanvas } from "./ui/ShowcaseCanvas";
import { TEACHING_SPOTS, TEACHING_REGION, type TeachingSpot } from "./templates/teachingMap";
import { WORLD_WIDTH, WORLD_HEIGHT, CHUNK_SIZE } from "./model/constants";
import "./styles.css";

type Tool = "select" | "cluster" | "organelle" | "material" | "pan" | "gene";
type EditMode = "place" | "erase";
type Direction = "up" | "right" | "down" | "left";

interface GeneTemplate {
  id: number;
  name: string;
  geneHex: string;
}

interface CustomOrganelleDocument {
  definition: {
    code: number | string;
    kind: "controller";
    name: string;
    color: string;
    buildAmount: string;
    buildEnergy: string;
    recycleNumerator: string;
    recycleDenominator: string;
    ruleId: string;
  };
  rule: {
    id: string;
    conditions: Array<{ field: "hp" | "maxHp" | "amount" | "energy" | "px" | "py" | "light" | "tick"; operator: "eq" | "ne" | "lt" | "lte" | "gt" | "gte"; value: string }>;
    actions: Array<{ type: "add-momentum"; px: string; py: string } | { type: "change-resource"; amount: string; energy: string }>;
  };
}

const GENE_TEMPLATES_KEY = "clusterca.genes.v1";

const DEFAULT_CUSTOM_ORGANELLE = JSON.stringify({
  definition: {
    code: "0100",
    kind: "controller",
    name: "右向推进模块",
    color: "#7DD3FC",
    buildAmount: "1",
    buildEnergy: "1",
    recycleNumerator: "1",
    recycleDenominator: "2",
    ruleId: "custom:right-drive",
  },
  rule: {
    id: "custom:right-drive",
    conditions: [{ field: "energy", operator: "gte", value: "1" }],
    actions: [
      { type: "change-resource", amount: "0", energy: "-1" },
      { type: "add-momentum", px: "30", py: "0" },
    ],
  },
}, null, 2);

const loadGeneTemplates = (): GeneTemplate[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(GENE_TEMPLATES_KEY) ?? "[]") as GeneTemplate[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
};

const isValidGeneHex = (value: string): boolean => {
  const hex = value.replace(/\s+/g, "").toUpperCase();
  return /^[0-9A-F]+$/.test(hex) && hex.length >= 20 && (hex.length - 20) % 6 === 0;
};

interface GestureState {
  button: number;
  startClientX: number;
  startClientY: number;
  startTime: number;
  moved: boolean;
  ctrl: boolean;
  worldX: number;
  worldY: number;
  lastCell: { x: number; y: number } | undefined;
  started: boolean;
}

interface SelectBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const ORGANELLES: Array<[number, string, string, string]> = [
  [0x0000, "空 / 擦除", "#9aa5a0", "🗑️"],
  [0x0002, "基因核心", "#f5cf63", "🧬"],
  [0x0003, "能量转换器", "#82d173", "☀️"],
  [0x0005, "储存访问端口", "#f0b77b", "🚪"],
  [0x0006, "物质交换器", "#55c1a7", "🔄"],
  [0x0007, "数字信号端口", "#57a6ff", "🔢"],
  [0x0008, "编译信号端口", "#8a7dff", "⚙️"],
  [0x0009, "控制器", "#c783e8", "🧠"],
  [0x000a, "传感器", "#52d7e8", "📡"],
  [0x000b, "编译存储器", "#9e7ced", "💾"],
  [0x000c, "编译处理器", "#c05ee0", "🛠️"],
  [0x000d, "外部收发器", "#4ebbe8", "📻"],
  [0x000e, "编组器", "#ff8e72", "🤝"],
  [0x000f, "推进器", "#ff645f", "🚀"],
  [0x0011, "喷射器", "#ff9d47", "💨"],
  [0x0012, "生殖端口", "#f06aab", "🐣"],
] as const;

const initialSnapshot: WorldSnapshot = { tick: "0", running: false, clusters: [], seeds: [], materialCells: [], customOrganelles: [] };

const HOME_ZOOM = 8;
const FOCUS_ZOOM = 16;
const CAMERA_ANIM_MS = 420;
const DEVELOPER_REGION = { x0: 64, y0: 64, x1: 256, y1: 256 };
const TOUR_SEEN_KEY = "clusterca.tour.seen";

const shouldShowTour = (): boolean => {
  try { return localStorage.getItem(TOUR_SEEN_KEY) !== "1"; } catch { return true; }
};

const hexToRgb01 = (hex: string): [number, number, number] => {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
};

const send = (worker: Worker | undefined, command: WorkerCommand): void => worker?.postMessage(command);

const writeToDirectory = async (bytes: Uint8Array, fileName: string, mimeType: string): Promise<boolean> => {
  const directory = getExportDirectory();
  if (!directory) return false;
  try {
    const fileHandle = await directory.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(new Blob([bytes.slice().buffer], { type: mimeType }));
    await writable.close();
    return true;
  } catch {
    return false;
  }
};

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const geneFileInputRef = useRef<HTMLInputElement>(null);
  const rendererRef = useRef<WebGLWorldRenderer>();
  const workerRef = useRef<Worker>();
  const dragRef = useRef<{ x: number; y: number; cameraX: number; cameraY: number }>();
  const gestureRef = useRef<GestureState>();
  const lastClickRef = useRef<{ clientX: number; clientY: number; time: number }>();
  const cameraRef = useRef<Camera>();
  const cameraAnimRef = useRef<number>();
  const pendingSelectRef = useRef<Set<number>>();
  const [activeRegion, setActiveRegion] = useState<typeof DEVELOPER_REGION>();
  const activeRegionRef = useRef(activeRegion);
  const [editMode, setEditMode] = useState<EditMode>("place");
  const [dragSelect, setDragSelect] = useState<SelectBox>();
  const [dragPreview, setDragPreview] = useState<SelectBox>();
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const t = useMemo(() => translate(settings.language), [settings.language]);
  const settingsRef = useRef(settings);
  const translationRef = useRef(t);
  settingsRef.current = settings;
  translationRef.current = t;
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [camera, setCamera] = useState<Camera>({ x: 1024, y: 1024, zoom: 12 });
  const [tool, setTool] = useState<Tool>("select");
  const [selectedId, setSelectedId] = useState<number>();
  const [selectedOrganelle, setSelectedOrganelle] = useState<{ clusterId: number; localX: number; localY: number; code: number }>();
  const [rate, setRate] = useState(5);
  const [organelleCode, setOrganelleCode] = useState(0x0003);
  const [organelleDirection, setOrganelleDirection] = useState<Direction>("right");
  const [organelleChannel, setOrganelleChannel] = useState(1);
  const [organelleInputChannel, setOrganelleInputChannel] = useState(0);
  const [organelleGateEnabled, setOrganelleGateEnabled] = useState(false);
  const [organelleValue, setOrganelleValue] = useState(0);
  const [organelleForce, setOrganelleForce] = useState(30);
  const [organelleOperation, setOrganelleOperation] = useState("constant");
  const [organelleMode, setOrganelleMode] = useState("both");
  const [organelleRange, setOrganelleRange] = useState(1);
  const [layers, setLayers] = useState<LayerVisibility>({ clusters: true, material: true, light: true });
  const [logs, setLogs] = useState<string[]>(["ClusterCA Web 核心正在初始化…"]);
  const [geneTemplates, setGeneTemplates] = useState<GeneTemplate[]>(() => loadGeneTemplates());
  const [activeGeneId, setActiveGeneId] = useState<number>();
  const [pasteGene, setPasteGene] = useState("");
  const [showNewProject, setShowNewProject] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [showTeaching, setShowTeaching] = useState(false);
  const [gridEnabled, setGridEnabled] = useState(true);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [resizeTick, setResizeTick] = useState(0);
  const [projectSeed, setProjectSeed] = useState(() => String(Math.floor(Math.random() * 0x7fffffff) + 1));
  const [untrustedScripts, setUntrustedScripts] = useState<string[]>([]);
  const [showCustomEditor, setShowCustomEditor] = useState(false);
  const [customOrganelleJson, setCustomOrganelleJson] = useState(DEFAULT_CUSTOM_ORGANELLE);

  const pushLog = (message: string): void => setLogs((current) => [message, ...current].slice(0, 50));

  useEffect(() => {
    try { localStorage.setItem(GENE_TEMPLATES_KEY, JSON.stringify(geneTemplates)); } catch { /* ignore */ }
  }, [geneTemplates]);

  const activeGene = geneTemplates.find((template) => template.id === activeGeneId);
  const paletteOrganelles = useMemo<Array<[number, string, string, string]>>(
    () => [
      ...ORGANELLES,
      ...snapshot.customOrganelles.map((definition) => [definition.code, definition.name, definition.color, "🧪"] as [number, string, string, string]),
    ],
    [snapshot.customOrganelles],
  );

  const importGene = (raw: string, name?: string): void => {
    const hex = raw.replace(/\s+/g, "").toUpperCase();
    if (!isValidGeneHex(hex)) {
      pushLog(t("geneBad"));
      return;
    }
    const template: GeneTemplate = { id: Date.now(), name: name ?? `${t("genePrefix")}-${geneTemplates.length + 1}`, geneHex: hex };
    setGeneTemplates((current) => [...current, template]);
    setActiveGeneId(template.id);
    setTool("gene");
    setPasteGene("");
    pushLog(`${t("geneExported")} → ${template.name}`);
  };

  const registerCustomOrganelle = (): void => {
    try {
      const document = JSON.parse(customOrganelleJson) as CustomOrganelleDocument;
      if (!document?.definition || !document?.rule) throw new Error(t("customMissingParts"));
      const rawCode = document.definition.code;
      const code = typeof rawCode === "number" ? rawCode : Number.parseInt(rawCode.replace(/^0x/i, ""), 16);
      if (!Number.isInteger(code)) throw new Error(t("customBadCode"));
      send(workerRef.current, {
        type: "register-custom-organelle",
        definition: {
          ...document.definition,
          code,
          kind: "controller",
          buildAmount: String(document.definition.buildAmount),
          buildEnergy: String(document.definition.buildEnergy),
          recycleNumerator: String(document.definition.recycleNumerator),
          recycleDenominator: String(document.definition.recycleDenominator),
        },
        rule: document.rule,
      });
      send(workerRef.current, { type: "export-project", purpose: "autosave" });
      setOrganelleCode(code);
      setTool("organelle");
      pushLog(formatText(t("customSubmitted"), { code: code.toString(16).toUpperCase().padStart(4, "0") }));
    } catch (error) {
      pushLog(formatText(t("customInvalid"), { message: error instanceof Error ? error.message : String(error) }));
    }
  };

  const exportGeneFile = (geneHex: string, name: string): void => {
    const bytes = new TextEncoder().encode(geneHex);
    downloadBytes(bytes, `${name}.gene`, "text/plain");
    pushLog(formatText(t("geneExported"), {}));
  };

  const tourSteps = useMemo(() => [
    { target: ".viewport", title: t("tourCanvasTitle"), body: t("tourCanvasBody") },
    { target: ".run-controls", title: t("tourRunTitle"), body: t("tourRunBody") },
    { target: ".tool-grid", title: t("tourToolsTitle"), body: t("tourToolsBody") },
    { target: ".brush-mode", title: t("tourBrushTitle"), body: t("tourBrushBody") },
    { target: ".layer-row", title: t("tourLayersTitle"), body: t("tourLayersBody") },
    { target: ".grid-toggle", title: t("tourGridTitle"), body: t("tourGridBody") },
    { target: ".gene-panel", title: t("tourGenesTitle"), body: t("tourGenesBody") },
    { target: ".settings-open", title: t("tourSettingsTitle"), body: t("tourSettingsBody") },
    { target: ".right-panel", title: t("tourInspectorTitle"), body: t("tourInspectorBody") },
    { target: ".brand", title: t("tourDoneTitle"), body: t("tourDoneBody") },
  ], [t]);

  const finishTour = (): void => {
    setShowTour(false);
  };

  const dismissTourForever = (): void => {
    try { localStorage.setItem(TOUR_SEEN_KEY, "1"); } catch { /* ignore */ }
    setShowTour(false);
  };

  const restartTour = (): void => {
    try { localStorage.removeItem(TOUR_SEEN_KEY); } catch { /* ignore */ }
    setShowSettings(false);
    setShowTour(true);
  };

  const organelleIcon = (code: number): string => ORGANELLES.find(([c]) => c === code)?.[3] ?? "❔";

  const startTeaching = (): void => {
    send(workerRef.current, { type: "new-project", template: "teach", seed: projectSeed === "" || projectSeed === "-" ? "1" : projectSeed });
    setActiveRegion(TEACHING_REGION);
    setCamera({ x: 128, y: 128, zoom: 8 });
    setShowNewProject(false);
    setShowTour(false);
    setShowTeaching(true);
  };

  const focusTeachingSpot = (spot: TeachingSpot): void => {
    const x = 16 + spot.col * 64 + 2;
    const y = 16 + spot.row * 64 + 2;
    animateCameraTo({ x, y, zoom: 16 });
  };

  useEffect(() => { cameraRef.current = camera; }, [camera]);
  useEffect(() => { activeRegionRef.current = activeRegion; }, [activeRegion]);

  useEffect(() => {
    const onResize = (): void => setResizeTick((value) => value + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const clampCamera = (target: Camera): Camera => {
    const region = activeRegionRef.current;
    if (!region) return target;
    const width = canvasRef.current?.clientWidth ?? 800;
    const height = canvasRef.current?.clientHeight ?? 600;
    const regionWidth = region.x1 - region.x0;
    const regionHeight = region.y1 - region.y0;
    const minZoom = Math.min(width / regionWidth, height / regionHeight);
    const halfW = width / target.zoom / 2;
    const halfH = height / target.zoom / 2;
    const clampAxis = (center: number, half: number, min: number, max: number): number =>
      half * 2 >= max - min ? (min + max) / 2 : Math.max(min + half, Math.min(max - half, center));
    return {
      x: clampAxis(target.x, halfW, region.x0, region.x1),
      y: clampAxis(target.y, halfH, region.y0, region.y1),
      zoom: Math.max(minZoom, target.zoom),
    };
  };

  const cancelCameraAnim = (): void => {
    if (cameraAnimRef.current !== undefined) {
      cancelAnimationFrame(cameraAnimRef.current);
      cameraAnimRef.current = undefined;
    }
  };

  const animateCameraTo = (target: Camera): void => {
    cancelCameraAnim();
    const from = cameraRef.current ?? { x: 0, y: 0, zoom: 1 };
    const startTime = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - startTime) / CAMERA_ANIM_MS);
      const c1 = 1.70158;
      const c3 = c1 + 1;
      const eased = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
      setCamera(clampCamera({
        x: from.x + (target.x - from.x) * eased,
        y: from.y + (target.y - from.y) * eased,
        zoom: from.zoom + (target.zoom - from.zoom) * eased,
      }));
      if (t < 1) cameraAnimRef.current = requestAnimationFrame(step);
      else cameraAnimRef.current = undefined;
    };
    cameraAnimRef.current = requestAnimationFrame(step);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) return;
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === "s") {
          event.preventDefault();
          send(workerRef.current, { type: "export-project", purpose: "download" });
          return;
        }
        if (key === "z" && !event.shiftKey) {
          event.preventDefault();
          send(workerRef.current, { type: "undo-edit" });
          return;
        }
        if (key === "y" || (key === "z" && event.shiftKey)) {
          event.preventDefault();
          send(workerRef.current, { type: "redo-edit" });
          return;
        }
      }
      if (event.code !== "Space") return;
      const homeTarget = { x: 0, y: 0, zoom: HOME_ZOOM };
      const region = activeRegionRef.current;
      if (region) {
        homeTarget.x = (region.x0 + region.x1) / 2;
        homeTarget.y = (region.y0 + region.y1) / 2;
      }
      event.preventDefault();
      animateCameraTo(homeTarget);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    applySettings(settings);
    saveSettings(settings);
  }, [settings]);

  const selected = useMemo(
    () => snapshot.clusters.find((cluster) => cluster.id === selectedId),
    [snapshot.clusters, selectedId],
  );

  useEffect(() => {
    const worker = new Worker(new URL("./worker/simulation.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = ({ data }: MessageEvent<WorkerEvent>) => {
      const currentT = translationRef.current;
      const currentSettings = settingsRef.current;
      setSnapshot(data.snapshot);
      if (pendingSelectRef.current) {
        const before = pendingSelectRef.current;
        pendingSelectRef.current = undefined;
        const created = data.snapshot.clusters.find((cluster) => !before.has(cluster.id));
        if (created) setSelectedId(created.id);
      }
      if (data.type === "ready") pushLog(currentT("worldInit"));
      if (data.type === "error") pushLog(`${currentT("error")}：${data.message}`);
      if (data.type === "project-data") {
        if (data.purpose === "autosave") {
          void saveAutosaveRevision("default", data.bytes)
            .then(() => pushLog(formatText(currentT("autosaved"), { tick: data.snapshot.tick })))
            .catch((error) => pushLog(formatText(currentT("autosaveFailed"), { message: String(error) })));
          return;
        }
        void (async () => {
          const written = currentSettings.exportMode === "directory" && await writeToDirectory(data.bytes, data.fileName, "application/zip");
          if (!written) downloadBytes(data.bytes, data.fileName, "application/zip");
        })();
        pushLog(formatText(currentT("exported"), { file: data.fileName }));
      }
      if (data.type === "export-data") {
        void (async () => {
          const written = currentSettings.exportMode === "directory" && await writeToDirectory(data.bytes, data.fileName, data.mimeType);
          if (!written) downloadBytes(data.bytes, data.fileName, data.mimeType);
        })();
        pushLog(formatText(currentT("exported"), { file: data.fileName }));
      }
      if (data.type === "trust-required") {
        setUntrustedScripts(data.scriptIds);
        pushLog(formatText(currentT("untrustedScripts"), { count: data.scriptIds.length }));
      }
      if (data.type === "scripts-trusted") {
        setUntrustedScripts([]);
        pushLog(formatText(currentT("scriptsEnabled"), { ids: data.scriptIds.join(", ") }));
      }
    };
    send(worker, { type: "initialize", seed: "1" });
    return () => worker.terminate();
    // Worker 是唯一权威运行态，界面语言和导出设置不得触发重建。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => send(workerRef.current, { type: "export-project", purpose: "autosave" }), settings.autosaveInterval * 1000);
    return () => window.clearInterval(timer);
  }, [settings.autosaveInterval]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    rendererRef.current ??= new WebGLWorldRenderer(canvas);
    rendererRef.current.render(snapshot, camera, layers, selectedId, {
      showGrid: gridEnabled,
      backgroundColor: hexToRgb01(resolveBackground(settings)),
    });
  }, [snapshot, camera, layers, selectedId, gridEnabled, settings, leftOpen, rightOpen, resizeTick]);

  const downloadBytes = (bytes: Uint8Array, fileName: string, mimeType: string): void => {
    const copy = bytes.slice();
    const url = URL.createObjectURL(new Blob([copy.buffer], { type: mimeType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const pauseBeforeEdit = (): void => send(workerRef.current, { type: "pause" });
  const autosave = (): void => send(workerRef.current, { type: "export-project", purpose: "autosave" });

  const setClusterNote = (clusterId: number, note: string): void => {
    pauseBeforeEdit();
    send(workerRef.current, { type: "set-cluster-note", clusterId, note });
    autosave();
  };

  const hitClusterAt = (x: number, y: number): ClusterView | undefined =>
    [...snapshot.clusters].reverse().find((cluster) => contains(cluster, x, y));

  const worldCell = (clientX: number, clientY: number): { x: number; y: number } => {
    const point = rendererRef.current?.screenToWorld(clientX, clientY, camera);
    if (!point) return { x: -1, y: -1 };
    return point;
  };

  const placeAt = (x: number, y: number): void => {
    if (tool === "gene") {
      if (!activeGene) {
        pushLog(t("geneNeed"));
        return;
      }
      send(workerRef.current, { type: "add-template-seed", geneHex: activeGene.geneHex, x, y });
    } else if (tool === "cluster") {
      send(workerRef.current, { type: "add-cluster", rect: { x, y, width: 5, height: 5 } });
    } else if (tool === "material") {
      send(workerRef.current, { type: "set-material", x, y, amount: "20", energy: "50" });
    } else if (tool === "organelle") {
      if (!selected) {
        pushLog(t("needSelect"));
        return;
      }
      const localX = (x - selected.x + WORLD_WIDTH) % WORLD_WIDTH;
      const localY = (y - selected.y + WORLD_HEIGHT) % WORLD_HEIGHT;
      if (localX >= selected.width || localY >= selected.height) return;
      send(workerRef.current, {
        type: "set-organelle",
        clusterId: selected.id,
        localX,
        localY,
        code: organelleCode,
        direction: organelleDirection,
        channel: organelleChannel,
        inputChannel: organelleCode === 0x0009 || organelleGateEnabled ? organelleInputChannel : undefined,
        value: organelleValue,
        force: organelleForce,
        operation: organelleOperation,
        mode: organelleMode,
        range: organelleRange,
      });
    }
  };

  const eraseAt = (x: number, y: number): void => {
    const cluster = hitClusterAt(x, y);
    if (cluster) {
      send(workerRef.current, { type: "remove-cluster", clusterId: cluster.id });
      return;
    }
    if (tool === "organelle" && selected) {
      const localX = (x - selected.x + WORLD_WIDTH) % WORLD_WIDTH;
      const localY = (y - selected.y + WORLD_HEIGHT) % WORLD_HEIGHT;
      if (localX < selected.width && localY < selected.height) {
        send(workerRef.current, { type: "set-organelle", clusterId: selected.id, localX, localY, code: 0 });
        return;
      }
    }
    send(workerRef.current, { type: "set-material", x, y, amount: "0", energy: "0" });
  };

  const onSingleClick = (x: number, y: number, ctrl: boolean): void => {
    const cluster = hitClusterAt(x, y);
    if (ctrl || editMode === "erase") {
      pauseBeforeEdit();
      eraseAt(x, y);
      autosave();
      return;
    }
    if (cluster) {
      setSelectedId(cluster.id);
      setSelectedOrganelle(undefined);
      return;
    }
    if (tool === "select") {
      setSelectedId(undefined);
      return;
    }
    pendingSelectRef.current = new Set(snapshot.clusters.map((cluster) => cluster.id));
    pauseBeforeEdit();
    placeAt(x, y);
    autosave();
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (dragRef.current) {
      dragRef.current = undefined;
      return;
    }
    const gesture = gestureRef.current;
    if (!gesture) return;
    gestureRef.current = undefined;
    if (gesture.moved) {
      if (tool === "select" && dragSelect) {
        const hit = [...snapshot.clusters]
          .reverse()
          .find((cluster) => cluster.x + cluster.width > dragSelect.minX && cluster.x < dragSelect.maxX + 1
            && cluster.y + cluster.height > dragSelect.minY && cluster.y < dragSelect.maxY + 1);
        setSelectedId(hit?.id);
        setDragSelect(undefined);
        return;
      }
      if (tool === "cluster" && !(gesture.ctrl || editMode === "erase")) {
        const preview = dragPreview;
        setDragPreview(undefined);
        if (preview) {
          pendingSelectRef.current = new Set(snapshot.clusters.map((cluster) => cluster.id));
          pauseBeforeEdit();
          send(workerRef.current, {
            type: "add-cluster",
            rect: {
              x: preview.minX,
              y: preview.minY,
              width: Math.max(3, preview.maxX - preview.minX + 1),
              height: Math.max(3, preview.maxY - preview.minY + 1),
            },
          });
          autosave();
        }
        return;
      }
      autosave();
      return;
    }
    const cell = worldCell(event.clientX, event.clientY);
    if (cell.x < 0) return;
    const now = performance.now();
    const last = lastClickRef.current;
    const isDouble = last !== undefined && now - last.time < 350
      && Math.hypot(last.clientX - event.clientX, last.clientY - event.clientY) < 8;
    lastClickRef.current = { clientX: event.clientX, clientY: event.clientY, time: now };
    if (isDouble) {
      const cluster = hitClusterAt(cell.x, cell.y);
      if (cluster) {
        setSelectedId(cluster.id);
        const localX = (cell.x - cluster.x + WORLD_WIDTH) % WORLD_WIDTH;
        const localY = (cell.y - cluster.y + WORLD_HEIGHT) % WORLD_HEIGHT;
        if (localX < cluster.width && localY < cluster.height) {
          const code = cluster.organelles[localY * cluster.width + localX] ?? 0;
          setSelectedOrganelle(code !== 0 ? { clusterId: cluster.id, localX, localY, code } : undefined);
        } else {
          setSelectedOrganelle(undefined);
        }
        if ((cameraRef.current?.zoom ?? 0) < FOCUS_ZOOM) {
          animateCameraTo({
            x: cluster.x + cluster.width / 2,
            y: cluster.y + cluster.height / 2,
            zoom: FOCUS_ZOOM,
          });
        }
      }
      return;
    }
    onSingleClick(cell.x, cell.y, gesture.ctrl);
  };

  const onPointerDown = (event: PointerEvent): void => {
    canvasRef.current?.setPointerCapture(event.pointerId);
    if (event.button === 1 || (tool === "pan" && event.button === 0)) {
      cancelCameraAnim();
      dragRef.current = { x: event.clientX, y: event.clientY, cameraX: camera.x, cameraY: camera.y };
      return;
    }
    if (event.button !== 0) return;
    const cell = worldCell(event.clientX, event.clientY);
    gestureRef.current = {
      button: 0,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startTime: performance.now(),
      moved: false,
      ctrl: event.ctrlKey || event.metaKey,
      worldX: cell.x,
      worldY: cell.y,
      lastCell: undefined,
      started: false,
    };
  };

  const onPointerMove = (event: PointerEvent): void => {
    const pan = dragRef.current;
    if (pan) {
      setCamera(clampCamera({
        x: pan.cameraX - (event.clientX - pan.x) / camera.zoom,
        y: pan.cameraY - (event.clientY - pan.y) / camera.zoom,
        zoom: camera.zoom,
      }));
      return;
    }
    const gesture = gestureRef.current;
    if (!gesture) return;
    const dx = event.clientX - gesture.startClientX;
    const dy = event.clientY - gesture.startClientY;
    if (!gesture.moved && Math.hypot(dx, dy) < 4) return;
    gesture.moved = true;
    const cell = worldCell(event.clientX, event.clientY);
    if (cell.x < 0) return;
    if (tool === "select") {
      setDragSelect({
        minX: Math.min(gesture.worldX, cell.x),
        minY: Math.min(gesture.worldY, cell.y),
        maxX: Math.max(gesture.worldX, cell.x),
        maxY: Math.max(gesture.worldY, cell.y),
      });
      return;
    }
    if (tool === "cluster" && !(gesture.ctrl || editMode === "erase")) {
      setDragPreview({
        minX: Math.min(gesture.worldX, cell.x),
        minY: Math.min(gesture.worldY, cell.y),
        maxX: Math.max(gesture.worldX, cell.x),
        maxY: Math.max(gesture.worldY, cell.y),
      });
      return;
    }
    if (!gesture.started) {
      gesture.started = true;
      pauseBeforeEdit();
    }
    const last = gesture.lastCell;
    if (last && last.x === cell.x && last.y === cell.y) return;
    gesture.lastCell = cell;
    const erasing = gesture.ctrl || editMode === "erase";
    if (tool === "cluster" && !erasing) return;
    if (erasing) eraseAt(cell.x, cell.y);
    else placeAt(cell.x, cell.y);
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    cancelCameraAnim();
    const factor = event.deltaY > 0 ? 0.82 : 1.22;
    setCamera((current) => clampCamera({ ...current, zoom: Math.max(0.25, Math.min(128, current.zoom * factor)) }));
  };

  const exportScreenshot = (): void => {
    canvasRef.current?.toBlob(async (blob) => {
      if (!blob) return;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const fileName = `ClusterCA-view-tick-${snapshot.tick}.png`;
      const written = settings.exportMode === "directory" && await writeToDirectory(bytes, fileName, "image/png");
      if (!written) downloadBytes(bytes, fileName, "image/png");
      pushLog(formatText(t("exported"), { file: fileName }));
    }, "image/png");
  };

  const onSelectDirectory = async (): Promise<void> => {
    const ok = await pickExportDirectory();
    if (ok) {
      setSettings((current) => ({ ...current, exportMode: "directory" }));
      pushLog(t("settingsExportChosen"));
    } else {
      pushLog(t("settingsExportUnsupported"));
    }
  };

  return (
    <div class={`app-shell${leftOpen ? "" : " left-closed"}${rightOpen ? "" : " right-closed"}`}>
      <button
        class="fold-toggle fold-left"
        onClick={() => setLeftOpen((value) => !value)}
        title={leftOpen ? t("collapseLeft") : t("expandLeft")}
        style={{ left: leftOpen ? 260 : 0 }}
      >{leftOpen ? "◀" : "▶"}</button>
      <button
        class="fold-toggle fold-right"
        onClick={() => setRightOpen((value) => !value)}
        title={rightOpen ? t("collapseRight") : t("expandRight")}
        style={{ right: rightOpen ? 270 : 0 }}
      >{rightOpen ? "▶" : "◀"}</button>
      <header class="topbar">
        <div class="brand" onClick={() => setShowNewProject(true)} title={t("templates")}><span class="brand-mark" />ClusterCA <em>Web V2 · {VERSION} · {AUTHOR}</em></div>
        <div class="undo-redo">
          <button onClick={() => { send(workerRef.current, { type: "undo-edit" }); autosave(); }} title={`${t("undo")} (Ctrl+Z)`}>↩️ {t("undo")}</button>
          <button onClick={() => { send(workerRef.current, { type: "redo-edit" }); autosave(); }} title={`${t("redo")} (Ctrl+Y)`}>↪️ {t("redo")}</button>
        </div>
        <div class="run-controls">
          <button onClick={() => send(workerRef.current, { type: "step" })}>{t("step")}</button>
          <button onClick={() => send(workerRef.current, { type: "export-project", purpose: "download" })}>💾 {t("saveProject")}</button>
          <button onClick={() => setShowNewProject(true)}>🆕 {t("newProject")}</button>
          <button onClick={() => fileInputRef.current?.click()}>📂 {t("loadProject")}</button>
          <button onClick={async () => {
            const bytes = await loadLatestAutosave("default");
            if (bytes) {
              send(workerRef.current, { type: "import-project", bytes });
              setShowNewProject(false);
              if (shouldShowTour()) setShowTour(true);
            }
            else pushLog(t("noAutosave"));
          }}>♻️ {t("restoreAutosave")}</button>
          <input
            ref={fileInputRef}
            class="hidden-file"
            type="file"
            accept=".clusterca,application/zip"
            onChange={async (event) => {
              const input = event.target as HTMLInputElement;
              const file = input.files?.[0];
              if (!file) return;
              const bytes = new Uint8Array(await file.arrayBuffer());
              send(workerRef.current, { type: "import-project", bytes });
              setShowNewProject(false);
              autosave();
              input.value = "";
              pushLog(formatText(t("loading"), { file: file.name }));
            }}
          />
          <label>{t("tickRate")} <input type="range" min="1" max="30" value={rate} onInput={(event) => {
            const next = Number((event.target as HTMLInputElement).value);
            setRate(next);
            send(workerRef.current, { type: "set-rate", ticksPerSecond: next });
          }} /> {rate} Tick/s</label>
          <label class="grid-toggle"><input type="checkbox" checked={gridEnabled} onChange={(event) => setGridEnabled((event.target as HTMLInputElement).checked)} />{t("grid")}</label>
          <button class="settings-open" onClick={() => setShowNewProject(true)}>🗂 {t("templates")}</button>
          <button class="settings-open" onClick={startTeaching}>🎓 {t("teaching")}</button>
          <a class="settings-open github-link" href="https://github.com/Anshonesoo/ClusterCA-Web" target="_blank" rel="noreferrer">🐙 GitHub</a>
          <button class="settings-open" onClick={() => setShowSettings(true)}>⚙ {t("settings")}</button>
        </div>
        <button
          class="run-toggle"
          onClick={() => {
            if (snapshot.running) {
              send(workerRef.current, { type: "pause" });
              autosave();
            } else send(workerRef.current, { type: "run" });
          }}
        >{snapshot.running ? "⏸️ " : "▶️ "}{snapshot.running ? t("pause") : t("run")}</button>
        <div class="tick-readout">
          <span class={snapshot.running ? "run-dot running" : "run-dot"} />
          {snapshot.running ? t("running") : t("paused")} · {t("tick")} <strong>{snapshot.tick}</strong>
        </div>
      </header>

      <aside class={`left-panel panel${leftOpen ? "" : " closed"}`}>
        <h2>{t("tools")}</h2>
        <div class="tool-grid">
          <ToolButton id="select" current={tool} set={setTool} label={t("select")} icon="🔍" />
          <ToolButton id="pan" current={tool} set={setTool} label={t("pan")} icon="✋" />
          <ToolButton id="cluster" current={tool} set={setTool} label={t("cluster")} icon="🟩" />
          <ToolButton id="organelle" current={tool} set={setTool} label={t("organelle")} icon="🧩" />
          <ToolButton id="material" current={tool} set={setTool} label={t("material")} icon="💧" />
          <ToolButton id="gene" current={tool} set={setTool} label={t("gene")} icon="🧬" />
        </div>
        <div class="brush-mode segmented">
          <button class={editMode === "place" ? "segment active" : "segment"} onClick={() => setEditMode("place")}>{t("place")}</button>
          <button class={editMode === "erase" ? "segment active" : "segment"} onClick={() => setEditMode("erase")}>{t("erase")}</button>
        </div>
        <div class="palette-controls">
          <span class="palette-title">{t("organelleType")}</span>
          <div class="org-backpack">
            {paletteOrganelles.map(([code, name, color, emoji]) => (
              <button
                key={code}
                class={organelleCode === code ? "org-slot active" : "org-slot"}
                onClick={() => {
                  setOrganelleCode(code);
                  if (code === 0x0009) setOrganelleOperation("constant");
                  if (code === 0x000a) setOrganelleOperation("light");
                }}
                title={`${code.toString(16).toUpperCase().padStart(4, "0")} · ${name}`}
              >
                <i style={{ background: color }} />
                <span class="org-emoji">{emoji}</span>
              </button>
            ))}
          </div>
          {(organelleCode === 0x0006 || organelleCode === 0x000a || organelleCode === 0x000f || organelleCode === 0x0011 || organelleCode === 0x0012) && (
            <label>{t("direction")}
              <select value={organelleDirection} onChange={(event) => setOrganelleDirection((event.target as HTMLSelectElement).value as Direction)}>
                <option value="up">{t("up")}</option><option value="right">{t("right")}</option><option value="down">{t("down")}</option><option value="left">{t("left")}</option>
              </select>
            </label>
          )}
          {(organelleCode === 0x0007 || organelleCode === 0x0008 || organelleCode === 0x0009 || organelleCode === 0x000d) && (
            <label>channel
              <input type="number" min="0" max="255" value={organelleChannel} onInput={(event) => setOrganelleChannel(Number((event.target as HTMLInputElement).value))} />
            </label>
          )}
          {organelleCode === 0x0009 && (
            <label>inputChannel
              <input type="number" min="0" max="255" value={organelleInputChannel} onInput={(event) => setOrganelleInputChannel(Number((event.target as HTMLInputElement).value))} />
            </label>
          )}
          {(organelleCode === 0x0006 || organelleCode === 0x000f || organelleCode === 0x0011) && (
            <>
              <label>digital gate
                <input type="checkbox" checked={organelleGateEnabled} onChange={(event) => setOrganelleGateEnabled((event.target as HTMLInputElement).checked)} />
              </label>
              {organelleGateEnabled && <label>inputChannel
                <input type="number" min="0" max="255" value={organelleInputChannel} onInput={(event) => setOrganelleInputChannel(Number((event.target as HTMLInputElement).value))} />
              </label>}
            </>
          )}
          {(organelleCode === 0x0009 || organelleCode === 0x000e) && (
            <label>value
              <input type="number" value={organelleValue} onInput={(event) => setOrganelleValue(Number((event.target as HTMLInputElement).value))} />
            </label>
          )}
          {organelleCode === 0x000f && (
            <label>force
              <input type="number" min="1" max="1024" value={organelleForce} onInput={(event) => setOrganelleForce(Number((event.target as HTMLInputElement).value))} />
            </label>
          )}
          {organelleCode === 0x0009 && (
            <label>operation
              <select value={organelleOperation} onChange={(event) => setOrganelleOperation((event.target as HTMLSelectElement).value)}>
                <option value="constant">constant</option>
                <option value="add">add</option>
                <option value="sub">sub</option>
                <option value="compare">compare</option>
                <option value="and">and</option>
                <option value="or">or</option>
                <option value="not">not</option>
                <option value="delay">delay</option>
                <option value="pulse">pulse</option>
                <option value="latch">latch</option>
              </select>
            </label>
          )}
          {organelleCode === 0x000a && (
            <label>operation
              <select value={organelleOperation} onChange={(event) => setOrganelleOperation((event.target as HTMLSelectElement).value)}>
                <option value="light">light</option>
                <option value="light-gradient">light-gradient</option>
                <option value="energy">energy</option>
                <option value="amount">amount</option>
                <option value="proximity">proximity</option>
              </select>
            </label>
          )}
          {organelleCode === 0x0005 && (
            <label>mode
              <select value={organelleMode} onChange={(event) => setOrganelleMode((event.target as HTMLSelectElement).value)}>
                <option value="both">both</option>
                <option value="amount">amount</option>
                <option value="energy">energy</option>
              </select>
            </label>
          )}
          {organelleCode === 0x0006 && (
            <label>mode
              <select value={organelleMode} onChange={(event) => setOrganelleMode((event.target as HTMLSelectElement).value)}>
                <option value="both">both</option>
                <option value="absorb">absorb</option>
                <option value="eject">eject</option>
              </select>
            </label>
          )}
          {organelleCode === 0x0006 && (
            <label>range
              <input type="number" min="1" max="32" value={organelleRange} onInput={(event) => setOrganelleRange(Number((event.target as HTMLInputElement).value))} />
            </label>
          )}
          {organelleCode === 0x000d && (
            <label>range
              <input type="number" min="0" max={Math.max(WORLD_WIDTH, WORLD_HEIGHT)} value={organelleRange} onInput={(event) => setOrganelleRange(Number((event.target as HTMLInputElement).value))} />
            </label>
          )}
          <button class="custom-editor-toggle" onClick={() => setShowCustomEditor((visible) => !visible)}>
            🧪 {t("customEditor")}
          </button>
          {showCustomEditor && <section class="custom-editor">
            <p>{t("customEditorHint")}</p>
            <textarea value={customOrganelleJson} onInput={(event) => setCustomOrganelleJson((event.target as HTMLTextAreaElement).value)} />
            <button onClick={registerCustomOrganelle}>{t("customApply")}</button>
          </section>}
        </div>
        <h2>{t("layers")}</h2>
        <LayerToggle label={t("layerCluster")} color="#3ecfae" checked={layers.clusters} onChange={(value) => setLayers({ ...layers, clusters: value })} />
        <LayerToggle label={t("layerMaterial")} color="#5aa8f0" checked={layers.material} onChange={(value) => setLayers({ ...layers, material: value })} />
        <LayerToggle label={t("layerLight")} color="#e8c64f" checked={layers.light} onChange={(value) => setLayers({ ...layers, light: value })} />
        <h2>{t("geneTemplates")}</h2>
        <div class="gene-panel">
          <textarea class="gene-paste" value={pasteGene} placeholder={t("genePaste")} onInput={(event) => setPasteGene((event.target as HTMLTextAreaElement).value)} />
          <div class="gene-actions">
            <button onClick={() => importGene(pasteGene)}>{t("geneImportPaste")}</button>
            <button onClick={() => geneFileInputRef.current?.click()}>{t("geneImportFile")}</button>
            <input
              ref={geneFileInputRef}
              class="hidden-file"
              type="file"
              accept=".gene,text/plain"
              onChange={async (event) => {
                const input = event.target as HTMLInputElement;
                const file = input.files?.[0];
                if (!file) return;
                importGene(await file.text(), file.name.replace(/\.gene$/i, "") || undefined);
                input.value = "";
              }}
            />
          </div>
          <div class="gene-list">
            {geneTemplates.map((template) => (
              <button
                key={template.id}
                class={template.id === activeGeneId ? "gene-item active" : "gene-item"}
                onClick={() => { setActiveGeneId(template.id); setTool("gene"); }}
              >
                <strong>{template.name}</strong>
                <span>{template.geneHex.slice(0, 20)}…</span>
              </button>
            ))}
          </div>
          <div class="gene-actions">
            <button disabled={!activeGene} onClick={() => activeGene && exportGeneFile(activeGene.geneHex, activeGene.name)}>{t("geneExport")}</button>
          </div>
        </div>
        <div class="world-facts"><span>{WORLD_WIDTH} × {WORLD_HEIGHT}</span><span>环面</span><span>{WORLD_WIDTH / CHUNK_SIZE} × {WORLD_HEIGHT / CHUNK_SIZE} 区块</span></div>
      </aside>

      <main class="viewport">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
        />
        {dragSelect && <div
          class="select-box"
          style={{
            left: `${(dragSelect.minX - camera.x) * camera.zoom + (canvasRef.current?.clientWidth ?? 0) / 2}px`,
            top: `${(dragSelect.minY - camera.y) * camera.zoom + (canvasRef.current?.clientHeight ?? 0) / 2}px`,
            width: `${(dragSelect.maxX - dragSelect.minX + 1) * camera.zoom}px`,
            height: `${(dragSelect.maxY - dragSelect.minY + 1) * camera.zoom}px`,
          }}
        />}
        <div class="viewport-hud">中心 {camera.x.toFixed(1)}, {camera.y.toFixed(1)} · 缩放 {camera.zoom.toFixed(1)} px/格</div>
      </main>

      <aside class={`right-panel panel${rightOpen ? "" : " closed"}`}>
        <h2>{t("inspector")}</h2>
        {selected ? <ClusterInspector
          cluster={selected}
          t={t}
          onNoteChange={(note) => setClusterNote(selected.id, note)}
          onExportGene={(geneHex) => exportGeneFile(geneHex, `cluster-${selected.id}-gene`)}
        /> : <p class="muted">{t("inspectorHint")}</p>}
        {selected && selectedOrganelle && selectedOrganelle.clusterId === selected.id && (
          <OrganelleInspector cluster={selected} organelle={selectedOrganelle} t={t} />
        )}
        <h2>{t("currentSnapshot")}</h2>
        <dl class="stats">
          <dt>{t("clusterCount")}</dt><dd>{snapshot.clusters.length}</dd>
          <dt>{t("seedCount")}</dt><dd>{snapshot.seeds.length}</dd>
          <dt>{t("materialCells")}</dt><dd>{snapshot.materialCells.length}</dd>
          <dt>{t("simState")}</dt><dd>{snapshot.running ? t("running") : t("paused")}</dd>
        </dl>
        {untrustedScripts.length > 0 && <div class="trust-warning">
          <strong>{t("trustWarning")}</strong>
          <span>{untrustedScripts.join(", ")}</span>
          <button onClick={() => send(workerRef.current, { type: "trust-project-scripts" })}>{t("trustEnable")}</button>
        </div>}
        <h2>{t("export")}</h2>
        <div class="export-actions">
          <button onClick={() => send(workerRef.current, { type: "export-metrics" })}>📊 {t("metricsCsv")}</button>
          <button disabled={!selected} onClick={() => selected && send(workerRef.current, { type: "export-selection", clusterId: selected.id })}>📦 {t("selectionJson")}</button>
          <button onClick={exportScreenshot}>🖼️ {t("viewPng")}</button>
        </div>
      </aside>

      <footer class="log-panel">
        <strong>{t("eventLog")}</strong>
        <div>{snapshot.warning ? `${t("error")}：${snapshot.warning}` : logs[0] ?? t("ready")}</div>
      </footer>
      {showNewProject && <div class="modal-backdrop">
        <section class="new-project-modal" role="dialog" aria-label={t("newProject")}>
          <span class="eyebrow">ClusterCA / NEW WORLD</span>
          <h1>{t("newWorldTitle")}</h1>
          <p>{t("newWorldDesc")}</p>
          <label class="seed-field">{t("projectSeed")}
            <span class="seed-controls">
              <input value={projectSeed} onInput={(event) => {
                const value = (event.target as HTMLInputElement).value;
                if (/^-?\d*$/.test(value)) setProjectSeed(value);
              }} />
              <button class="seed-random" onClick={randomizeSeed} title={t("randomSeed")}>🎲</button>
            </span>
          </label>
          <div class="template-grid">
            <TemplateButton icon="🧱" title={t("templateBlank")} detail={t("templateBlankDesc")} locked lockLabel={t("notOpen")} onClick={() => createProject("blank")} />
            <TemplateButton icon="🌿" title={t("templateEcology")} detail={t("templateEcologyDesc")} onClick={() => createProject("ecology")} />
            <TemplateButton icon="🛠️" title={t("templateCustom")} detail={t("templateCustomDesc")} locked lockLabel={t("notOpen")} onClick={() => createProject("custom")} />
            <TemplateButton icon="🧪" title={t("templateDeveloper")} detail={t("templateDeveloperDesc")} locked lockLabel={t("notOpen")} onClick={() => createProject("developer")} />
          </div>
          <ShowcaseCanvas />
          {snapshot.clusters.length > 0 || snapshot.materialCells.length > 0
            ? <button class="modal-cancel" onClick={() => setShowNewProject(false)}>{t("cancel")}</button>
            : null}
        </section>
      </div>}
      {showSettings && <SettingsModal
        settings={settings}
        onChange={setSettings}
        t={t}
        onClose={() => setShowSettings(false)}
        onSelectDirectory={onSelectDirectory}
        onRestartTour={restartTour}
      />}
      {showTour && <TourGuide steps={tourSteps} t={t} onFinish={finishTour} onDontShowAgain={dismissTourForever} />}
      {showTeaching && <TeachingPanel
        spots={TEACHING_SPOTS}
        t={t}
        organelleIcon={organelleIcon}
        onFocus={focusTeachingSpot}
        onClose={() => setShowTeaching(false)}
      />}
    </div>
  );

  function randomizeSeed(): void {
    setProjectSeed(String(Math.floor(Math.random() * 0x7fffffff) + 1));
  }

  function createProject(template: "blank" | "ecology" | "custom" | "developer"): void {
    const seed = projectSeed === "" || projectSeed === "-" ? "1" : projectSeed;
    send(workerRef.current, { type: "new-project", template, seed });
    setUntrustedScripts([]);
    if (template === "developer") {
      setActiveRegion(DEVELOPER_REGION);
      setCamera({ x: (DEVELOPER_REGION.x0 + DEVELOPER_REGION.x1) / 2, y: (DEVELOPER_REGION.y0 + DEVELOPER_REGION.y1) / 2, zoom: HOME_ZOOM });
    } else {
      setActiveRegion(undefined);
    }
    if (template === "custom") setShowCustomEditor(true);
    setShowNewProject(false);
    if (shouldShowTour()) setShowTour(true);
    autosave();
  }
}

function ToolButton(props: { id: Tool; current: Tool; set: (tool: Tool) => void; label: string; icon: string }) {
  return <button class={props.current === props.id ? "tool active" : "tool"} onClick={() => props.set(props.id)}>
    <span>{props.icon}</span>{props.label}
  </button>;
}

function LayerToggle(props: { label: string; color: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label class="layer-row">
    <input type="checkbox" checked={props.checked} onChange={(event) => props.onChange((event.target as HTMLInputElement).checked)} />
    <i style={{ background: props.color }} />
    <span>{props.label}</span>
  </label>;
}

function ClusterInspector({
  cluster,
  t,
  onNoteChange,
  onExportGene,
}: {
  cluster: ClusterView;
  t: (key: TranslationKey) => string;
  onNoteChange: (note: string) => void;
  onExportGene: (geneHex: string) => void;
}) {
  const [note, setNote] = useState(cluster.note ?? "");
  useEffect(() => { setNote(cluster.note ?? ""); }, [cluster.id, cluster.note]);
  const health = cluster.health ?? 64;
  const healthStatus = health === 0 ? t("statusNecrotic")
    : health <= 16 ? t("statusDormant")
    : health >= 48 ? t("statusEnergetic")
    : t("statusNormal");
  return <dl class="stats inspector">
    <dt>ID</dt><dd>#{cluster.id}</dd>
    <dt>矩形</dt><dd>{cluster.width} × {cluster.height}</dd>
    <dt>位置</dt><dd>{cluster.x}, {cluster.y}</dd>
    <dt>HP</dt><dd>{cluster.hp} / {cluster.maxHp}</dd>
    <dt>{t("health")}</dt><dd>{health} / 64 · {healthStatus}</dd>
    <dt>物质</dt><dd>{cluster.amount}</dd>
    <dt>能量</dt><dd>{cluster.energy}</dd>
    <dt>计数器</dt><dd>({cluster.px}, {cluster.py})</dd>
    {cluster.geneHex && <>
      <dt>{t("gene")}</dt>
      <dd>
        <span class="gene-hex">{cluster.geneHex.slice(0, 26)}…</span>
        <button class="gene-export-small" onClick={() => onExportGene(cluster.geneHex!)}>{t("geneExport")}</button>
      </dd>
    </>}
    <dt>{t("note")}</dt>
    <dd><textarea class="note-input" rows={3} value={note} onInput={(event) => setNote((event.target as HTMLTextAreaElement).value)} onBlur={() => onNoteChange(note)} /></dd>
  </dl>;
}

function OrganelleInspector({
  cluster,
  organelle,
  t,
}: {
  cluster: ClusterView;
  organelle: { clusterId: number; localX: number; localY: number; code: number };
  t: (key: TranslationKey) => string;
}) {
  const name = ORGANELLES.find(([code]) => code === organelle.code)?.[1] ?? "?";
  const runtime = cluster.organelleRuntime?.[organelle.localY * cluster.width + organelle.localX];
  return <div class="organelle-inspector">
    <h2>{t("organelleInfo")}</h2>
    <dl class="stats inspector">
      <dt>{t("organelleType")}</dt><dd>{organelle.code.toString(16).toUpperCase().padStart(4, "0")} · {name}</dd>
      <dt>{t("localCoord")}</dt><dd>({organelle.localX}, {organelle.localY})</dd>
      {runtime?.direction ? <><dt>{t("direction")}</dt><dd>{runtime.direction}</dd></> : null}
      {runtime?.channel !== undefined ? <><dt>channel</dt><dd>{runtime.channel}</dd></> : null}
      {runtime?.inputChannel !== undefined ? <><dt>inputChannel</dt><dd>{runtime.inputChannel}</dd></> : null}
      {runtime?.value !== undefined ? <><dt>value</dt><dd>{runtime.value}</dd></> : null}
      {runtime?.force !== undefined ? <><dt>force</dt><dd>{runtime.force}</dd></> : null}
      {runtime?.operation ? <><dt>operation</dt><dd>{runtime.operation}</dd></> : null}
      {runtime?.mode ? <><dt>mode</dt><dd>{runtime.mode}</dd></> : null}
      {runtime?.range !== undefined ? <><dt>range</dt><dd>{runtime.range}</dd></> : null}
    </dl>
  </div>;
}

function TemplateButton(props: { icon: string; title: string; detail: string; onClick: () => void; locked?: boolean; lockLabel?: string }) {
  return <button class={props.locked ? "template-card locked" : "template-card"} onClick={props.locked ? undefined : props.onClick} title={props.locked ? props.lockLabel : undefined}>
    {props.locked && <span class="template-lock">🔒 {props.lockLabel}</span>}
    <span class="template-icon" aria-hidden="true">{props.icon}</span>
    <strong>{props.title}</strong><span>{props.detail}</span>
  </button>;
}

function contains(cluster: ClusterView, x: number, y: number): boolean {
  const dx = (x - cluster.x + WORLD_WIDTH) % WORLD_WIDTH;
  const dy = (y - cluster.y + WORLD_HEIGHT) % WORLD_HEIGHT;
  return dx < cluster.width && dy < cluster.height;
}
