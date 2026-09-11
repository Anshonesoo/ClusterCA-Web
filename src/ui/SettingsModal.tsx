import type { FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import { BACKGROUND_PRESETS, type AppSettings, type BackgroundTheme, type Language } from "../settings/settings";
import type { TranslationKey } from "../settings/i18n";
import { AboutModal } from "./AboutModal";
import { VERSION } from "../settings/settings";

interface SettingsModalProps {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  t: (key: TranslationKey) => string;
  onClose: () => void;
  onSelectDirectory: () => Promise<void>;
  onRestartTour: () => void;
}

type PresetTheme = Exclude<BackgroundTheme, "custom">;

const BACKGROUND_OPTIONS: Array<{ id: PresetTheme; name: string }> = [
  { id: "dark", name: "Dark" },
  { id: "light", name: "Light" },
  { id: "mint", name: "Mint" },
  { id: "sky", name: "Sky" },
];

export const SettingsModal: FunctionComponent<SettingsModalProps> = ({ settings, onChange, t, onClose, onSelectDirectory, onRestartTour }) => {
  const [showAbout, setShowAbout] = useState(false);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]): void => {
    onChange({ ...settings, [key]: value });
  };

  const setLanguage = (language: Language): void => update("language", language);

  return (
    <div class="modal-backdrop" onClick={onClose}>
      <section class="settings-modal" role="dialog" aria-label={t("settingsTitle")} onClick={(event) => event.stopPropagation()}>
        <header class="settings-header">
          <h2>{t("settingsTitle")}</h2>
          <button class="settings-close" onClick={onClose} aria-label={t("settingsClose")}>×</button>
        </header>

        <div class="settings-body">
          <div class="settings-group">
            <span class="settings-label">{t("settingsBackground")}</span>
            <div class="swatch-row">
              {BACKGROUND_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  class={settings.background === option.id ? "swatch active" : "swatch"}
                  onClick={() => update("background", option.id)}
                  aria-label={option.name}
                >
                  <i style={{ background: BACKGROUND_PRESETS[option.id] }} />
                </button>
              ))}
              <label class="swatch custom">
                <i style={{ background: settings.customColor }} />
                <input
                  type="color"
                  value={settings.customColor}
                  onInput={(event) => {
                    const value = (event.target as HTMLInputElement).value;
                    update("customColor", value);
                    update("background", "custom");
                  }}
                />
              </label>
            </div>
          </div>

          <div class="settings-group">
            <span class="settings-label">
              {t("settingsBrightness")} <em>{Math.round(settings.brightness * 100)}%</em>
            </span>
            <input
              type="range"
              min="0.8"
              max="1.3"
              step="0.05"
              value={settings.brightness}
              onInput={(event) => update("brightness", Number((event.target as HTMLInputElement).value))}
            />
          </div>

          <div class="settings-group">
            <span class="settings-label">
              {t("settingsFontScale")} <em>{Math.round(settings.fontScale * 100)}%</em>
            </span>
            <input
              type="range"
              min="0.85"
              max="1.3"
              step="0.05"
              value={settings.fontScale}
              onInput={(event) => update("fontScale", Number((event.target as HTMLInputElement).value))}
            />
          </div>

          <div class="settings-group">
            <span class="settings-label">{t("settingsLanguage")}</span>
            <div class="segmented">
              <button class={settings.language === "zh" ? "segment active" : "segment"} onClick={() => setLanguage("zh")}>{t("languageZh")}</button>
              <button class={settings.language === "en" ? "segment active" : "segment"} onClick={() => setLanguage("en")}>{t("languageEn")}</button>
            </div>
          </div>

          <div class="settings-group">
            <span class="settings-label">
              {t("settingsAutosave")} <em>{settings.autosaveInterval}s</em>
            </span>
            <input
              type="range"
              min="10"
              max="600"
              step="10"
              value={settings.autosaveInterval}
              onInput={(event) => update("autosaveInterval", Number((event.target as HTMLInputElement).value))}
            />
          </div>

          <div class="settings-group">
            <span class="settings-label">{t("settingsExportMode")}</span>
            <div class="segmented">
              <button class={settings.exportMode === "download" ? "segment active" : "segment"} onClick={() => update("exportMode", "download")}>
                {t("settingsExportDownload")}
              </button>
              <button class={settings.exportMode === "directory" ? "segment active" : "segment"} onClick={onSelectDirectory}>
                {t("settingsExportDirectory")}
              </button>
            </div>
          </div>
        </div>

        <footer class="settings-footer">
          <span>{t("versionBy")}</span>
          <button class="settings-done" onClick={() => setShowAbout(true)}>{t("aboutTitle")}</button>
          <button class="settings-done" onClick={onRestartTour}>{t("tourRestart")}</button>
          <button class="settings-done" onClick={onClose}>{t("settingsClose")}</button>
        </footer>
      </section>
      {showAbout && <AboutModal t={t} version={VERSION} onClose={() => setShowAbout(false)} />}
    </div>
  );
};
