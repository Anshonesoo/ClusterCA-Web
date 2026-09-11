export const VERSION = "v0.2.0";
export const AUTHOR = "Anshonesoo";

export type BackgroundTheme = "dark" | "light" | "mint" | "sky" | "custom";
export type Language = "zh" | "en";
export type ExportMode = "download" | "directory";

export interface AppSettings {
  background: BackgroundTheme;
  customColor: string;
  brightness: number;
  fontScale: number;
  language: Language;
  autosaveInterval: number;
  exportMode: ExportMode;
}

export const BACKGROUND_PRESETS: Record<Exclude<BackgroundTheme, "custom">, string> = {
  dark: "#07100e",
  light: "#f6f8f7",
  mint: "#e8f5f0",
  sky: "#eaf3fc",
};

export const DEFAULT_SETTINGS: AppSettings = {
  background: "light",
  customColor: "#f6f8f7",
  brightness: 1,
  fontScale: 1,
  language: "zh",
  autosaveInterval: 60,
  exportMode: "download",
};

const SETTINGS_KEY = "clusterca.settings.v1";

export const loadSettings = (): AppSettings => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      background: parsed.background ?? DEFAULT_SETTINGS.background,
      customColor: typeof parsed.customColor === "string" ? parsed.customColor : DEFAULT_SETTINGS.customColor,
      brightness: clampNumber(parsed.brightness, 0.8, 1.3, DEFAULT_SETTINGS.brightness),
      fontScale: clampNumber(parsed.fontScale, 0.85, 1.3, DEFAULT_SETTINGS.fontScale),
      language: parsed.language === "en" ? "en" : "zh",
      autosaveInterval: clampNumber(parsed.autosaveInterval, 10, 600, DEFAULT_SETTINGS.autosaveInterval),
      exportMode: parsed.exportMode === "directory" ? "directory" : "download",
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

export const saveSettings = (settings: AppSettings): void => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 存储不可用时静默忽略，不影响运行。
  }
};

export const resolveBackground = (settings: AppSettings): string =>
  settings.background === "custom" ? settings.customColor : BACKGROUND_PRESETS[settings.background];

interface ThemeGroup {
  bg: string;
  bg2: string;
  panel: string;
  panel2: string;
  line: string;
  muted: string;
  text: string;
  input: string;
  bright: string;
  soft: string;
  accent: string;
}

const DARK_THEME: ThemeGroup = {
  bg: "#07100e",
  bg2: "#0b1613",
  panel: "#0d1916",
  panel2: "#12231e",
  line: "#263a34",
  muted: "#829c94",
  text: "#dcebe6",
  input: "#10201b",
  bright: "#b8e9d9",
  soft: "#17362d",
  accent: "#59d6ae",
};

const THEME_GROUPS: Record<Exclude<BackgroundTheme, "custom">, ThemeGroup> = {
  dark: DARK_THEME,
  light: {
    bg: "#f6f8f7", bg2: "#ffffff", panel: "#ffffff", panel2: "#f2f6f4",
    line: "#e3e9e6", muted: "#5b6b66", text: "#1f2933", input: "#ffffff",
    bright: "#123f34", soft: "#d9f5ee", accent: "#2fae8d",
  },
  mint: {
    bg: "#e8f5f0", bg2: "#ffffff", panel: "#ffffff", panel2: "#eef7f3",
    line: "#d3e6de", muted: "#4f6b62", text: "#17332b", input: "#ffffff",
    bright: "#0f4a3a", soft: "#d6f1e8", accent: "#31a985",
  },
  sky: {
    bg: "#eaf3fc", bg2: "#ffffff", panel: "#ffffff", panel2: "#eef5fb",
    line: "#d5e3f1", muted: "#4f6376", text: "#1c2a38", input: "#ffffff",
    bright: "#12395e", soft: "#dbeaf8", accent: "#4a8fd8",
  },
};

export const applySettings = (settings: AppSettings): void => {
  const root = document.documentElement;
  const group = settings.background === "custom" ? DARK_THEME : THEME_GROUPS[settings.background];
  root.style.setProperty("--theme-bg", resolveBackground(settings));
  root.style.setProperty("--ui-bg-2", group.bg2);
  root.style.setProperty("--ui-panel", group.panel);
  root.style.setProperty("--ui-panel-2", group.panel2);
  root.style.setProperty("--ui-line", group.line);
  root.style.setProperty("--ui-muted", group.muted);
  root.style.setProperty("--ui-text", group.text);
  root.style.setProperty("--ui-input", group.input);
  root.style.setProperty("--ui-bright", group.bright);
  root.style.setProperty("--ui-soft", group.soft);
  root.style.setProperty("--ui-accent", group.accent);
  root.style.setProperty("--theme-brightness", settings.brightness.toFixed(2));
  root.style.setProperty("--theme-font-scale", settings.fontScale.toFixed(2));
};

let exportDirectoryHandle: FileSystemDirectoryHandle | undefined;

export const setExportDirectory = (handle: FileSystemDirectoryHandle): void => {
  exportDirectoryHandle = handle;
};

export const getExportDirectory = (): FileSystemDirectoryHandle | undefined => exportDirectoryHandle;

export const pickExportDirectory = async (): Promise<boolean> => {
  if (typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker !== "function") return false;
  try {
    const handle = await (window as unknown as {
      showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker();
    exportDirectoryHandle = handle;
    return true;
  } catch {
    return false;
  }
};

const clampNumber = (value: number | undefined, min: number, max: number, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
};
