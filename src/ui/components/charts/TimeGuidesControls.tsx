"use client";

import { Clock3 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TimeGuideSettings } from "./timeGuides";
import {
  TIME_GUIDE_PRESET_OPTIONS,
  formatTargetMinute,
  getResolvedTargetMinutes,
} from "./timeGuides";

interface TimeGuidesControlsProps {
  value: TimeGuideSettings;
  onChange: (value: TimeGuideSettings) => void;
  compact?: boolean;
  disabled?: boolean;
}

export function TimeGuidesControls({
  value,
  onChange,
  compact = false,
  disabled = false,
}: TimeGuidesControlsProps) {
  const [open, setOpen] = useState(false);
  const [customTimesDraft, setCustomTimesDraft] = useState(value.customTimes);
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCustomTimesDraft(value.customTimes);
  }, [value.customTimes]);

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const popoverWidth = 280;
      const viewportPadding = 8;
      const left = Math.min(
        Math.max(viewportPadding, rect.right - popoverWidth),
        window.innerWidth - popoverWidth - viewportPadding
      );
      const top = Math.min(
        rect.bottom + 4,
        window.innerHeight - viewportPadding
      );
      setPopoverPosition({ top, left });
    };

    updatePosition();

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !popoverRef.current?.contains(target) &&
        !buttonRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const summary = useMemo(() => {
    const targets = getResolvedTargetMinutes(value)
      .slice(0, 3)
      .map(formatTargetMinute);
    if (targets.length === 0) return "No session times";
    return targets.join(", ");
  }, [value]);

  const showCustomTimesInput = value.sessionPreset === "custom";
  const commitCustomTimes = () => {
    const nextValue = customTimesDraft.trim();
    if (nextValue === value.customTimes) return;
    onChange({
      ...value,
      customTimes: nextValue,
    });
  };

  return (
    <div className={`relative ${compact ? "" : "shrink-0"}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        className={`flex h-7 w-7 items-center justify-center rounded border text-xs font-medium transition-colors ${
          open
            ? "border-primary/60 bg-primary/10 text-primary"
            : "border-border text-muted-foreground hover:bg-muted"
        } disabled:cursor-not-allowed disabled:opacity-50`}
        title="Time guides"
        aria-label="Time guides"
      >
        <Clock3 className="h-3.5 w-3.5" />
      </button>

      {open &&
        popoverPosition &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[120] w-[280px] rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-xl"
            style={{
              top: popoverPosition.top,
              left: popoverPosition.left,
            }}
          >
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold text-foreground">Time Guides</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{summary}</p>
              </div>

              <label className="flex flex-col gap-1 text-[11px]">
                <span className="font-medium text-muted-foreground">Session preset</span>
                <select
                  value={value.sessionPreset}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      sessionPreset: event.target.value as TimeGuideSettings["sessionPreset"],
                    })
                  }
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                >
                  {TIME_GUIDE_PRESET_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {showCustomTimesInput && (
                <label className="flex flex-col gap-1 text-[11px]">
                  <span className="font-medium text-muted-foreground">Custom times</span>
                  <input
                    type="text"
                    value={customTimesDraft}
                    onChange={(event) => setCustomTimesDraft(event.target.value)}
                    onBlur={commitCustomTimes}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitCustomTimes();
                        event.currentTarget.blur();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setCustomTimesDraft(value.customTimes);
                        event.currentTarget.blur();
                      }
                    }}
                    placeholder="08:00, 09:00"
                    className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                  />
                </label>
              )}

              <label className="flex items-start gap-2 text-[11px] text-foreground">
                <input
                  type="checkbox"
                  checked={value.showPeriodSeparators}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      showPeriodSeparators: event.target.checked,
                    })
                  }
                  className="mt-0.5 h-3.5 w-3.5 rounded border-border"
                />
                <span>Show period separators</span>
              </label>

              <label className="flex items-start gap-2 text-[11px] text-foreground">
                <input
                  type="checkbox"
                  checked={value.showSessionLines}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      showSessionLines: event.target.checked,
                    })
                  }
                  className="mt-0.5 h-3.5 w-3.5 rounded border-border"
                />
                <span>Show session preset lines</span>
              </label>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
