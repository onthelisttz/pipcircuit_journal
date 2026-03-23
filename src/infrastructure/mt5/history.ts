import { promises as fs, type Dirent } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import type { ChartBar, ChartTimeframe } from "@domain/entities";

const DEFAULT_MT5_HISTORY_ROOT =
  "C:\\Users\\costa\\AppData\\Roaming\\MetaQuotes\\Terminal\\D0E8209F77C8CF37AD8BF550E51FF075\\bases\\Pepperstone-Demo\\history";

const HEADER_COUNT_OFFSET = 428;
const TIME_SECTION_OFFSET = 432;
const SECTION_MARKER_BYTES = 4;
const INT64_BYTES = 8;
const INT32_BYTES = 4;
const STANDARD_TIMEFRAMES: ChartTimeframe[] = ["M1", "M5", "M15", "H1", "H4", "D1"];
const TIMEFRAME_TO_MS: Record<ChartTimeframe, number> = {
  M1: 60_000,
  M5: 5 * 60_000,
  M15: 15 * 60_000,
  M30: 30 * 60_000,
  H1: 60 * 60_000,
  H4: 4 * 60 * 60_000,
  D1: 24 * 60 * 60_000,
};

type Mt5CacheSectionName =
  | "open"
  | "high"
  | "low"
  | "close"
  | "volume"
  | "spread"
  | "realVolume";

export interface Mt5TimeframeSummary {
  timeframe: ChartTimeframe;
  fileName: string;
  barCount: number;
  from: number;
  to: number;
  source?: "cache" | "derived";
}

export interface Mt5SymbolSummary {
  symbol: string;
  timeframes: Mt5TimeframeSummary[];
}

interface Mt5CacheMetadata {
  count: number;
  firstTimestamp: number;
  lastTimestamp: number;
}

export function getMt5HistoryRoot(): string {
  return process.env.MT5_HISTORY_ROOT?.trim() || DEFAULT_MT5_HISTORY_ROOT;
}

function normalizeTimeframe(fileName: string): ChartTimeframe | null {
  const base = path.basename(fileName, path.extname(fileName)).toUpperCase();
  if (base === "DAILY") return "D1";
  if (
    base === "M1" ||
    base === "M5" ||
    base === "M15" ||
    base === "M30" ||
    base === "H1" ||
    base === "H4" ||
    base === "D1"
  ) {
    return base;
  }
  return null;
}

function timeframeToCacheFile(timeframe: ChartTimeframe): string {
  return timeframe === "D1" ? "Daily.hc" : `${timeframe}.hc`;
}

function bufferToUInt64(buffer: Buffer, offset = 0): number {
  return Number(buffer.readBigUInt64LE(offset));
}

function getSectionOffset(count: number, section: Mt5CacheSectionName): number {
  const timesEnd = TIME_SECTION_OFFSET + count * INT64_BYTES;
  const openStart = timesEnd;
  const highStart = openStart + SECTION_MARKER_BYTES + count * INT64_BYTES;
  const lowStart = highStart + SECTION_MARKER_BYTES + count * INT64_BYTES;
  const closeStart = lowStart + SECTION_MARKER_BYTES + count * INT64_BYTES;
  const volumeStart = closeStart + SECTION_MARKER_BYTES + count * INT64_BYTES;
  const spreadStart = volumeStart + SECTION_MARKER_BYTES + count * INT64_BYTES;
  const realVolumeStart = spreadStart + SECTION_MARKER_BYTES + count * INT32_BYTES;

  switch (section) {
    case "open":
      return openStart;
    case "high":
      return highStart;
    case "low":
      return lowStart;
    case "close":
      return closeStart;
    case "volume":
      return volumeStart;
    case "spread":
      return spreadStart;
    case "realVolume":
      return realVolumeStart;
  }
}

async function readExactly(
  handle: FileHandle,
  length: number,
  position: number
): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) {
    throw new Error(`Short read at ${position}. Expected ${length}, got ${bytesRead}.`);
  }
  return buffer;
}

async function readCacheMetadata(filePath: string): Promise<Mt5CacheMetadata> {
  const handle = await fs.open(filePath, "r");
  try {
    const header = await readExactly(handle, TIME_SECTION_OFFSET + 8, 0);
    const count = header.readUInt32LE(HEADER_COUNT_OFFSET);
    if (count <= 0) {
      return { count: 0, firstTimestamp: 0, lastTimestamp: 0 };
    }

    const firstTimestamp = bufferToUInt64(header, TIME_SECTION_OFFSET) * 1000;
    const lastBuffer = await readExactly(
      handle,
      INT64_BYTES,
      TIME_SECTION_OFFSET + (count - 1) * INT64_BYTES
    );
    const lastTimestamp = bufferToUInt64(lastBuffer) * 1000;

    return { count, firstTimestamp, lastTimestamp };
  } finally {
    await handle.close();
  }
}

async function readTimeAt(
  handle: FileHandle,
  count: number,
  index: number
): Promise<number> {
  if (index < 0 || index >= count) {
    throw new Error(`Timestamp index ${index} out of range for ${count} bars.`);
  }
  const buffer = await readExactly(
    handle,
    INT64_BYTES,
    TIME_SECTION_OFFSET + index * INT64_BYTES
  );
  return bufferToUInt64(buffer) * 1000;
}

async function lowerBoundIndex(
  handle: FileHandle,
  count: number,
  targetTimestamp: number
): Promise<number> {
  let left = 0;
  let right = count;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    const current = await readTimeAt(handle, count, mid);
    if (current < targetTimestamp) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  return left;
}

async function upperBoundIndex(
  handle: FileHandle,
  count: number,
  targetTimestamp: number
): Promise<number> {
  let left = 0;
  let right = count;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    const current = await readTimeAt(handle, count, mid);
    if (current <= targetTimestamp) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  return left;
}

function buildCacheFilePath(symbol: string, timeframe: ChartTimeframe): string {
  return path.join(getMt5HistoryRoot(), symbol, "cache", timeframeToCacheFile(timeframe));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sortTimeframeSummaries(
  summaries: Mt5TimeframeSummary[]
): Mt5TimeframeSummary[] {
  return [...summaries].sort(
    (a, b) => STANDARD_TIMEFRAMES.indexOf(a.timeframe) - STANDARD_TIMEFRAMES.indexOf(b.timeframe)
  );
}

function buildDerivedTimeframes(
  baseSummary: Mt5TimeframeSummary,
  existing: Map<ChartTimeframe, Mt5TimeframeSummary>
): Mt5TimeframeSummary[] {
  return STANDARD_TIMEFRAMES.map((timeframe) => {
    const cached = existing.get(timeframe);
    if (cached) return cached;

    return {
      timeframe,
      fileName: `Derived from ${baseSummary.fileName}`,
      barCount: Math.max(
        1,
        Math.floor(baseSummary.barCount / Math.max(1, TIMEFRAME_TO_MS[timeframe] / TIMEFRAME_TO_MS.M1))
      ),
      from: baseSummary.from,
      to: baseSummary.to,
      source: "derived",
    };
  });
}

function floorTimestampToTimeframe(
  timestamp: number,
  timeframe: ChartTimeframe
): number {
  if (timeframe === "D1") {
    const date = new Date(timestamp);
    date.setUTCHours(0, 0, 0, 0);
    return date.getTime();
  }

  const interval = TIMEFRAME_TO_MS[timeframe];
  return Math.floor(timestamp / interval) * interval;
}

function aggregateBarsToTimeframe(
  bars: ChartBar[],
  timeframe: ChartTimeframe
): ChartBar[] {
  if (timeframe === "M1") return bars;
  if (bars.length === 0) return [];

  const aggregated: ChartBar[] = [];
  let activeBucket = Number.NaN;
  let currentBar: ChartBar | null = null;

  for (const bar of bars) {
    const bucket = floorTimestampToTimeframe(bar.timestamp, timeframe);
    if (currentBar && bucket === activeBucket) {
      currentBar.high = Math.max(currentBar.high, bar.high);
      currentBar.low = Math.min(currentBar.low, bar.low);
      currentBar.close = bar.close;
      currentBar.volume += bar.volume;
      continue;
    }

    if (currentBar) {
      aggregated.push(currentBar);
    }

    activeBucket = bucket;
    currentBar = {
      ...bar,
      timeframe,
      timestamp: bucket,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    };
  }

  if (currentBar) {
    aggregated.push(currentBar);
  }

  return aggregated;
}

export async function listMt5Symbols(): Promise<Mt5SymbolSummary[]> {
  const root = getMt5HistoryRoot();
  const symbolEntries = await fs.readdir(root, { withFileTypes: true });
  const symbols = symbolEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const summaries = await Promise.all(
    symbols.map(async (symbol) => {
      const cacheDir = path.join(root, symbol, "cache");
      let cacheEntries: Dirent[] = [];
      try {
        cacheEntries = await fs.readdir(cacheDir, { withFileTypes: true });
      } catch {
        return null;
      }

      const rawTimeframes: Array<Mt5TimeframeSummary | null> = await Promise.all(
        cacheEntries
          .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".hc"))
          .map(async (entry) => {
            const timeframe = normalizeTimeframe(entry.name);
            if (!timeframe) return null;

            const filePath = path.join(cacheDir, entry.name);
            const metadata = await readCacheMetadata(filePath);
            if (metadata.count === 0) return null;

            return {
              timeframe,
              fileName: entry.name,
              barCount: metadata.count,
              from: metadata.firstTimestamp,
              to: metadata.lastTimestamp,
              source: "cache",
            } satisfies Mt5TimeframeSummary;
          })
      );

      const timeframes = rawTimeframes.filter(
        (item): item is Mt5TimeframeSummary => item !== null
      );

      if (timeframes.length === 0) return null;

      const timeframeMap = new Map(
        timeframes.map((timeframeSummary) => [timeframeSummary.timeframe, timeframeSummary] as const)
      );
      const m1Summary = timeframeMap.get("M1");
      const finalTimeframes = m1Summary
        ? buildDerivedTimeframes(m1Summary, timeframeMap)
        : sortTimeframeSummaries(timeframes).filter((item) =>
            STANDARD_TIMEFRAMES.includes(item.timeframe)
          );

      return {
        symbol,
        timeframes: sortTimeframeSummaries(finalTimeframes),
      } satisfies Mt5SymbolSummary;
    })
  );

  return summaries.filter((item): item is Mt5SymbolSummary => item !== null);
}

export async function readMt5Bars(params: {
  symbol: string;
  timeframe: ChartTimeframe;
  from: number;
  to: number;
  limit?: number;
}): Promise<ChartBar[]> {
  const { symbol, timeframe, from, to, limit = 10_000 } = params;
  const filePath = buildCacheFilePath(symbol, timeframe);
  if (!(await fileExists(filePath)) && timeframe !== "M1") {
    const ratio = Math.max(1, Math.ceil(TIMEFRAME_TO_MS[timeframe] / TIMEFRAME_TO_MS.M1));
    const m1Bars = await readMt5Bars({
      symbol,
      timeframe: "M1",
      from,
      to,
      limit: limit * ratio,
    });
    return aggregateBarsToTimeframe(m1Bars, timeframe).slice(0, limit);
  }
  const handle = await fs.open(filePath, "r");

  try {
    const header = await readExactly(handle, TIME_SECTION_OFFSET, 0);
    const count = header.readUInt32LE(HEADER_COUNT_OFFSET);
    if (count <= 0) return [];

    const normalizedFrom = Math.min(from, to);
    const normalizedTo = Math.max(from, to);
    const startIndex = await lowerBoundIndex(handle, count, normalizedFrom);
    const endIndexExclusive = await upperBoundIndex(handle, count, normalizedTo);
    const totalRequested = Math.max(0, endIndexExclusive - startIndex);
    const sliceCount = Math.min(totalRequested, Math.max(1, limit));

    if (sliceCount === 0) return [];

    const timeBuffer = await readExactly(
      handle,
      sliceCount * INT64_BYTES,
      TIME_SECTION_OFFSET + startIndex * INT64_BYTES
    );
    const openBuffer = await readExactly(
      handle,
      sliceCount * INT64_BYTES,
      getSectionOffset(count, "open") +
        SECTION_MARKER_BYTES +
        startIndex * INT64_BYTES
    );
    const highBuffer = await readExactly(
      handle,
      sliceCount * INT64_BYTES,
      getSectionOffset(count, "high") +
        SECTION_MARKER_BYTES +
        startIndex * INT64_BYTES
    );
    const lowBuffer = await readExactly(
      handle,
      sliceCount * INT64_BYTES,
      getSectionOffset(count, "low") +
        SECTION_MARKER_BYTES +
        startIndex * INT64_BYTES
    );
    const closeBuffer = await readExactly(
      handle,
      sliceCount * INT64_BYTES,
      getSectionOffset(count, "close") +
        SECTION_MARKER_BYTES +
        startIndex * INT64_BYTES
    );
    const volumeBuffer = await readExactly(
      handle,
      sliceCount * INT64_BYTES,
      getSectionOffset(count, "volume") +
        SECTION_MARKER_BYTES +
        startIndex * INT64_BYTES
    );

    const bars: ChartBar[] = [];
    for (let index = 0; index < sliceCount; index += 1) {
      bars.push({
        symbol,
        timeframe,
        timestamp: bufferToUInt64(timeBuffer, index * INT64_BYTES) * 1000,
        open: openBuffer.readDoubleLE(index * INT64_BYTES),
        high: highBuffer.readDoubleLE(index * INT64_BYTES),
        low: lowBuffer.readDoubleLE(index * INT64_BYTES),
        close: closeBuffer.readDoubleLE(index * INT64_BYTES),
        volume: bufferToUInt64(volumeBuffer, index * INT64_BYTES),
      });
    }

    return bars;
  } finally {
    await handle.close();
  }
}
