import { useState } from "preact/hooks";
import type { FunctionComponent } from "preact";
import type { TeachingSpot } from "../templates/teachingMap";
import type { TranslationKey } from "../settings/i18n";

interface TeachingPanelProps {
  spots: readonly TeachingSpot[];
  t: (key: TranslationKey) => string;
  organelleIcon: (code: number) => string;
  onFocus: (spot: TeachingSpot) => void;
  onClose: () => void;
}

export const TeachingPanel: FunctionComponent<TeachingPanelProps> = ({ spots, t, organelleIcon, onFocus, onClose }) => {
  const [selected, setSelected] = useState<TeachingSpot | undefined>(spots[0]);

  return (
    <div class="modal-backdrop" onClick={onClose}>
      <section class="teaching-panel" role="dialog" aria-label={t("teaching")} onClick={(event) => event.stopPropagation()}>
        <header class="settings-header">
          <h2>{t("teaching")}</h2>
          <button class="settings-close" onClick={onClose} aria-label="×">×</button>
        </header>
        <div class="teaching-body">
          <div class="teaching-grid">
            {spots.map((spot) => (
              <button
                key={spot.id}
                class={selected?.id === spot.id ? "teaching-card active" : "teaching-card"}
                onClick={() => {
                  setSelected(spot);
                  onFocus(spot);
                }}
                title = {spot.title}
              >
                <span class="teaching-icon">{organelleIcon(spot.organelleCode)}</span>
                <span class="teaching-name">{spot.title}</span>
              </button>
            ))}
          </div>
          <div class="teaching-detail">
            <h3>{selected?.title}</h3>
            <p>{selected?.detail}</p>
            <p class="teaching-hint">{t("teachingHint")}</p>
          </div>
        </div>
      </section>
    </div>
  );
};
