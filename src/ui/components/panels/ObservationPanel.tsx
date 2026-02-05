"use client";

import { useEffect } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { useObservationPanel } from "@ui/providers";
import { ObservationPanelContent } from "./ObservationPanelContent";

export function ObservationPanel() {
  const { isOpen, observationId, observationIds, closePanel, goToNext, goToPrev } = useObservationPanel();

  const currentIdx = observationId != null ? observationIds.indexOf(observationId) : -1;
  const canGoPrev = currentIdx > 0;
  const canGoNext = currentIdx >= 0 && currentIdx < observationIds.length - 1;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    if (isOpen) document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closePanel]);

  if (!isOpen || !observationId) return null;

  return (
    <div
      className="flex h-screen w-full shrink-0 flex-col overflow-hidden border-l border-border bg-background md:w-[min(50%,28rem)]"
      role="complementary"
      aria-labelledby="observation-panel-title"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-1">
          <button
            onClick={goToPrev}
            disabled={!canGoPrev}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Previous observation"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={goToNext}
            disabled={!canGoNext}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Next observation"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        <h2 id="observation-panel-title" className="text-lg font-semibold text-foreground flex-1 text-center">
          Observation {observationIds.length > 0 ? `${currentIdx + 1} / ${observationIds.length}` : ""}
        </h2>
        <button
          onClick={closePanel}
          className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Close panel"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <ObservationPanelContent observationId={observationId} onClose={closePanel} />
    </div>
  );
}
