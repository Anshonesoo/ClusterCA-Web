import type { FunctionComponent } from "preact";
import type { TranslationKey } from "../settings/i18n";
import { formatText } from "../settings/i18n";

interface AboutModalProps {
  t: (key: TranslationKey) => string;
  version: string;
  onClose: () => void;
}

export const AboutModal: FunctionComponent<AboutModalProps> = ({ t, version, onClose }) => (
  <div class="modal-backdrop about-backdrop" onClick={onClose}>
    <section class="about-modal" role="dialog" aria-label={t("aboutTitle")} onClick={(event) => event.stopPropagation()}>
      <header class="settings-header">
        <h2>{t("aboutTitle")}</h2>
        <button class="settings-close" onClick={onClose} aria-label={t("aboutClose")}>×</button>
      </header>
      <div class="about-body">
        <dl class="about-list">
          <dt>QQ</dt><dd>2067144047</dd>
          <dt>Email</dt><dd>anshonesoo@gmail.com</dd>
        </dl>
        <p class="about-hint">{t("aboutContactNote")}</p>
        <hr />
        <p>{formatText(t("aboutVersion"), { version })}</p>
        <p>{t("aboutAuthor")}</p>
        <p>{t("aboutStage")}</p>
        <p>{t("aboutContact")}</p>
        <button class="settings-done about-done" onClick={onClose}>{t("aboutClose")}</button>
      </div>
    </section>
  </div>
);
