import { useEffect, useState } from "preact/hooks";
import type { FunctionComponent } from "preact";
import type { TranslationKey } from "../settings/i18n";

export interface TourStep {
  target: string;
  title: string;
  body: string;
}

interface TourGuideProps {
  steps: readonly TourStep[];
  t: (key: TranslationKey) => string;
  onFinish: () => void;
  onDontShowAgain: () => void;
}

interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const measure = (selector: string): ElementRect | undefined => {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) return undefined;
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
};

export const TourGuide: FunctionComponent<TourGuideProps> = ({ steps, t, onFinish, onDontShowAgain }) => {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<ElementRect>();
  const current = steps[Math.min(index, steps.length - 1)];
  const isLast = index >= steps.length - 1;

  useEffect(() => {
    const update = (): void => setRect(measure(current.target));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [current.target]);

  const next = (): void => {
    if (isLast) onFinish();
    else setIndex((value) => value + 1);
  };

  const bubbleWidth = 272;
  const bubbleHeight = 150;
  let bubbleX = 0;
  let bubbleY = 0;
  if (rect) {
    bubbleX = rect.x + rect.width + 14;
    if (bubbleX + bubbleWidth > window.innerWidth - 12) bubbleX = Math.max(12, rect.x - bubbleWidth - 14);
    bubbleY = rect.y + rect.height + 14;
    if (bubbleY + bubbleHeight > window.innerHeight - 12) bubbleY = Math.max(12, rect.y - bubbleHeight - 14);
  }

  return (
    <div class="tour-backdrop" onClick={next}>
      {rect && (
        <div class="tour-spotlight" style={{
          left: `${rect.x}px`,
          top: `${rect.y}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        }} />
      )}
      {rect && (
        <section class="tour-bubble" style={{ left: `${bubbleX}px`, top: `${bubbleY}px` }} role="dialog" onClick={(event) => event.stopPropagation()}>
          <span class="tour-step">{index + 1} / {steps.length}</span>
          <h3>{current.title}</h3>
          <p>{current.body}</p>
          <div class="tour-actions">
            <button class="tour-skip" onClick={onFinish}>{t("tourSkip")}</button>
            <button class="tour-skip" onClick={onDontShowAgain}>{t("tourNoMore")}</button>
            <span class="tour-spacer" />
            {index > 0 && <button class="tour-nav" onClick={() => setIndex((value) => value - 1)}>{t("tourBack")}</button>}
            {isLast
              ? <button class="tour-primary" onClick={onFinish}>{t("tourFinish")}</button>
              : <button class="tour-primary" onClick={next}>{t("tourNext")}</button>}
          </div>
        </section>
      )}
    </div>
  );
};
