"use client";

import type { ChartBar, ChartTimeframe } from "@domain/entities";

export type TimeGuideSessionPreset =
  | "custom"
  | "us_open"
  | "trading_hours"
  | "london_open"
  | "asian_session";

export interface TimeGuideSettings {
  sessionPreset: TimeGuideSessionPreset;
  customTimes: string;
  showPeriodSeparators: boolean;
  showSessionLines: boolean;
}

export interface TimeGuideVerticalLine {
  id: string;
  kind: "daily" | "session";
  timestamp: number;
}

export interface ComputedTimeGuides {
  verticalLines: TimeGuideVerticalLine[];
}

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const DAILY_SEPARATOR_MAX_MINUTES = 15;
const SESSION_LINE_MAX_MINUTES = 5;

export const TIME_GUIDE_DEFAULTS: TimeGuideSettings = {
  sessionPreset: "trading_hours",
  customTimes: "15:00,23:00",
  showPeriodSeparators: true,
  showSessionLines: true,
};

export const TIME_GUIDE_PRESET_OPTIONS: Array<{
  value: TimeGuideSessionPreset;
  label: string;
}> = [
  { value: "trading_hours", label: "Trading Hours" },
  { value: "us_open", label: "US Open" },
  { value: "london_open", label: "London Open" },
  { value: "asian_session", label: "Asian Session" },
  { value: "custom", label: "Custom" },
];

const PRESET_TIMES: Record<Exclude<TimeGuideSessionPreset, "custom">, string> = {
  us_open: "16:30,17:30",
  trading_hours: "15:00,23:00",
  london_open: "08:00,09:00",
  asian_session: "00:00,06:00",
};

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeTimeGuideSettings(value: unknown): TimeGuideSettings {
  const candidate =
    value && typeof value === "object" ? (value as Partial<TimeGuideSettings>) : {};
  const preset = candidate.sessionPreset;
  const customTimes =
    typeof candidate.customTimes === "string"
      ? candidate.customTimes
      : TIME_GUIDE_DEFAULTS.customTimes;

  return {
    sessionPreset:
      preset === "custom" ||
      preset === "us_open" ||
      preset === "trading_hours" ||
      preset === "london_open" ||
      preset === "asian_session"
        ? preset
        : TIME_GUIDE_DEFAULTS.sessionPreset,
    customTimes,
    showPeriodSeparators: normalizeBoolean(
      candidate.showPeriodSeparators ??
        (candidate as { showDailySeparators?: boolean }).showDailySeparators,
      TIME_GUIDE_DEFAULTS.showPeriodSeparators
    ),
    showSessionLines: normalizeBoolean(
      candidate.showSessionLines ??
        !(candidate as { hideSessionLinesAbove5Minutes?: boolean }).hideSessionLinesAbove5Minutes,
      TIME_GUIDE_DEFAULTS.showSessionLines
    ),
  };
}

export function readStoredTimeGuideSettings(storageKey: string): TimeGuideSettings {
  if (typeof window === "undefined") return TIME_GUIDE_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return TIME_GUIDE_DEFAULTS;
    return normalizeTimeGuideSettings(JSON.parse(raw));
  } catch {
    return TIME_GUIDE_DEFAULTS;
  }
}

export function resolveTargetTimesString(settings: TimeGuideSettings): string {
  if (settings.sessionPreset === "custom") {
    return settings.customTimes;
  }
  return PRESET_TIMES[settings.sessionPreset];
}

export function parseTargetTimes(raw: string): number[] {
  const values = new Set<number>();

  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(trimmed);
    if (!match) continue;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    values.add(hour * 60 + minute);
  }

  return Array.from(values).sort((a, b) => a - b);
}

export function formatTargetMinute(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function getResolvedTargetMinutes(settings: TimeGuideSettings): number[] {
  return parseTargetTimes(resolveTargetTimesString(settings));
}

export function timeframeToMinutes(timeframe: ChartTimeframe): number {
  switch (timeframe) {
    case "M1":
      return 1;
    case "M5":
      return 5;
    case "M15":
      return 15;
    case "M30":
      return 30;
    case "H1":
      return 60;
    case "H4":
      return 240;
    case "D1":
      return 1440;
    default:
      return 1;
  }
}

export function supportsDailySeparators(timeframe: ChartTimeframe): boolean {
  return timeframeToMinutes(timeframe) <= DAILY_SEPARATOR_MAX_MINUTES;
}

function shouldShowSessionLines(timeframe: ChartTimeframe, settings: TimeGuideSettings): boolean {
  if (!settings.showSessionLines) return false;
  return timeframeToMinutes(timeframe) <= SESSION_LINE_MAX_MINUTES;
}

export function getChartDateParts(timestamp: number): DateParts {
  const date = new Date(timestamp);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

function dayKey(parts: Pick<DateParts, "year" | "month" | "day">): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function buildTimeGuides(
  bars: ChartBar[],
  timeframe: ChartTimeframe | undefined,
  settings: TimeGuideSettings | undefined
): ComputedTimeGuides {
  if (!timeframe || !settings || bars.length === 0) {
    return { verticalLines: [] };
  }

  const resolvedSettings = normalizeTimeGuideSettings(settings);
  const sessionMinutes = getResolvedTargetMinutes(resolvedSettings);
  const verticalLines: TimeGuideVerticalLine[] = [];

  let previousDay = "";

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    const openParts = getChartDateParts(bar.timestamp);
    const currentDay = dayKey(openParts);

    if (
      resolvedSettings.showPeriodSeparators &&
      supportsDailySeparators(timeframe) &&
      ((index > 0 && currentDay !== previousDay) ||
        (index === 0 && openParts.hour === 0 && openParts.minute === 0))
    ) {
      verticalLines.push({
        id: `daily-${currentDay}`,
        kind: "daily",
        timestamp: bar.timestamp,
      });
    }

    if (shouldShowSessionLines(timeframe, resolvedSettings) && sessionMinutes.length > 0) {
      const currentMinuteOfDay = openParts.hour * 60 + openParts.minute;
      if (sessionMinutes.includes(currentMinuteOfDay)) {
        verticalLines.push({
          id: `session-${currentDay}-${formatTargetMinute(currentMinuteOfDay)}`,
          kind: "session",
          timestamp: bar.timestamp,
        });
      }
    }

    previousDay = currentDay;
  }

  return { verticalLines };
}
