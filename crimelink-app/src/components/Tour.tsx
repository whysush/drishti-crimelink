import React, { useEffect } from "react";

/**
 * Guided tour.
 *
 * A judge exploring alone will not necessarily find the thing that matters. This
 * walks the real interface — it opens actual groups, switches actual tabs — rather
 * than showing a slideshow, so what they see is the working product.
 */
export interface TourStep {
  title: string;
  body: React.ReactNode;
  /** run before the step renders — moves the app into the state the step describes */
  enter?: () => void;
  anchor?: "map" | "panel" | "top" | "centre";
}

export default function Tour({ steps, i, onNext, onBack, onClose }: {
  steps: TourStep[]; i: number;
  onNext: () => void; onBack: () => void; onClose: () => void;
}) {
  const step = steps[i];

  useEffect(() => { step?.enter?.(); }, [i]);            // eslint-disable-line

  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === "Enter") onNext();
      else if (e.key === "ArrowLeft") onBack();
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onNext, onBack, onClose]);

  if (!step) return null;
  const last = i === steps.length - 1;

  return (
    <>
      <div className="tour-scrim" onClick={onClose} />
      <div className={`tour tour-${step.anchor || "centre"}`} role="dialog" aria-label="Guided tour">
        <div className="tour-n">{i + 1} / {steps.length}</div>
        <div className="tour-t">{step.title}</div>
        <div className="tour-b">{step.body}</div>
        <div className="tour-actions">
          <button className="btn-ghost" onClick={onClose}>Exit tour</button>
          <div className="tour-nav">
            {i > 0 && <button className="btn-ghost" onClick={onBack}>Back</button>}
            <button className="btn-primary" onClick={last ? onClose : onNext}>
              {last ? "Finish" : "Next"}
            </button>
          </div>
        </div>
        <div className="tour-dots">
          {steps.map((_, k) => <i key={k} className={k === i ? "on" : ""} />)}
        </div>
      </div>
    </>
  );
}
