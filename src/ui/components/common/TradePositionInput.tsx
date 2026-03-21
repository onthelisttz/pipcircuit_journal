"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface TradePositionInputProps {
  current: number;
  total: number;
  onChangePosition: (position: number) => void;
  separator?: "/" | "of";
  wrapperClassName?: string;
  inputClassName?: string;
  textClassName?: string;
  ariaLabel?: string;
}

export function TradePositionInput({
  current,
  total,
  onChangePosition,
  separator = "/",
  wrapperClassName = "",
  inputClassName = "",
  textClassName = "",
  ariaLabel = "Current trade position",
}: TradePositionInputProps) {
  const [draft, setDraft] = useState(() => String(Math.max(1, current)));

  useEffect(() => {
    setDraft(String(Math.max(1, current)));
  }, [current]);

  const applyPosition = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setDraft(String(Math.max(1, current)));
      return;
    }

    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed)) {
      setDraft(String(Math.max(1, current)));
      return;
    }

    const nextPosition = Math.min(total, Math.max(1, parsed));
    setDraft(String(nextPosition));
    if (nextPosition !== current) {
      onChangePosition(nextPosition);
    }
  }, [current, onChangePosition, total]);

  useEffect(() => {
    const trimmed = draft.trim();
    if (!trimmed) return;

    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed)) return;

    const nextPosition = Math.min(total, Math.max(1, parsed));
    if (nextPosition === current) return;

    const timeoutId = window.setTimeout(() => {
      onChangePosition(nextPosition);
    }, 450);

    return () => window.clearTimeout(timeoutId);
  }, [current, draft, onChangePosition, total]);

  const inputWidth = useMemo(() => {
    const digitCount = Math.max(
      2,
      String(total).length,
      String(current).length,
      draft.trim().length || 0
    );
    return `${digitCount + 2.5}ch`;
  }, [current, draft, total]);

  return (
    <span className={`inline-flex items-center gap-1 tabular-nums text-foreground ${wrapperClassName}`}>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={draft}
        onChange={(event) => {
          const nextValue = event.target.value.replace(/[^\d]/g, "");
          setDraft(nextValue);
        }}
        onBlur={() => applyPosition(draft)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            applyPosition(draft);
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(String(Math.max(1, current)));
            event.currentTarget.blur();
          }
        }}
        aria-label={ariaLabel}
        className={`rounded-md border border-border/90 bg-muted/80 px-1.5 py-0.5 text-center font-medium text-foreground shadow-sm outline-none transition focus:border-ring focus:bg-background focus:ring-1 focus:ring-ring ${inputClassName}`}
        style={{ width: inputWidth, minWidth: inputWidth }}
      />
      <span className={`font-medium ${textClassName}`}>
        {separator} {total}
      </span>
    </span>
  );
}
