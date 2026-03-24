import { promises as fs } from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";

const DEFAULT_MT5_HISTORY_ROOT =
  process.env.MT5_HISTORY_ROOT?.trim() ||
  "C:\\Users\\costa\\AppData\\Roaming\\MetaQuotes\\Terminal\\D0E8209F77C8CF37AD8BF550E51FF075\\bases\\Pepperstone-Demo\\history";

const HEADER_COUNT_OFFSET = 428;
const TIME_SECTION_OFFSET = 432;
const SECTION_MARKER_BYTES = 4;
const INT64_BYTES = 8;
const INT32_BYTES = 4;
const HCC_RECORD_BYTES = 60;
const HCC_MIN_SEGMENT_RECORDS = 20;
const YEAR_FILE_PATTERN = /^(\d{4})\.hcc$/i;
const STANDARD_TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];
const TIMEFRAME_TO_MS = {
  M1: 60_000,
  M5: 5 * 60_000,
  M15: 15 * 60_000,
  M30: 30 * 60_000,
  H1: 60 * 60_000,
  H4: 4 * 60 * 60_000,
  D1: 24 * 60 * 60_000,
};
const SERVICE_DIR = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_BRIDGE_DIR = path.join(SERVICE_DIR, "bin");
const BUNDLED_BRIDGE_NAME =
  process.platform === "win32" ? "request_mt5_bars.exe" : "request_mt5_bars";
const liveMt5State = new Map();
const hccIndexCache = new Map();

function normalizeTimeframe(fileName) {
  const base = path.basename(fileName, path.extname(fileName)).toUpperCase();
  if (base === "DAILY") return "D1";
  return STANDARD_TIMEFRAMES.includes(base) ? base : null;
}

function timeframeToCacheFile(timeframe) {
  return timeframe === "D1" ? "Daily.hc" : `${timeframe}.hc`;
}

function parseHistoryYearFile(name) {
  const match = YEAR_FILE_PATTERN.exec(name);
  return match ? Number(match[1]) : null;
}

function buildHistoryYearFilePath(symbol, year, rootOverride) {
  return path.join(resolveMt5HistoryRoot(rootOverride), symbol, `${year}.hcc`);
}

function buildLiveStateKey(symbol, timeframe) {
  return `${symbol.toUpperCase()}:${timeframe.toUpperCase()}`;
}

function getLiveMt5State(symbol, timeframe) {
  return liveMt5State.get(buildLiveStateKey(symbol, timeframe));
}

function updateLiveMt5State(symbol, timeframe, snapshot) {
  if (!snapshot || !snapshot.lastTimestamp) return;
  liveMt5State.set(buildLiveStateKey(symbol, timeframe), {
    ...snapshot,
    updatedAt: snapshot.updatedAt ?? Date.now(),
  });
}

function applyLiveSummaryOverlay(summary, symbol) {
  if (!summary) return summary;

  const liveState = getLiveMt5State(symbol, summary.timeframe);
  if (!liveState) return summary;
  if ((liveState.lastTimestamp ?? 0) <= (summary.to ?? 0)) return summary;

  const intervalMs = TIMEFRAME_TO_MS[summary.timeframe] ?? TIMEFRAME_TO_MS.M1;
  const canAddCount =
    Number.isFinite(liveState.firstTimestamp) &&
    liveState.firstTimestamp >= summary.to + intervalMs;

  return {
    ...summary,
    to: liveState.lastTimestamp,
    updatedAt: Math.max(summary.updatedAt ?? 0, liveState.updatedAt ?? 0),
    barCount: canAddCount
      ? summary.barCount + Math.max(0, liveState.count ?? 0)
      : summary.barCount,
    source: "live",
  };
}

function bufferToUInt64(buffer, offset = 0) {
  return Number(buffer.readBigUInt64LE(offset));
}

function getSectionOffset(count, section) {
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
    default:
      throw new Error(`Unsupported section: ${section}`);
  }
}

async function readExactly(handle, length, position) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) {
    throw new Error(`Short read at ${position}. Expected ${length}, got ${bytesRead}.`);
  }
  return buffer;
}

async function readCacheMetadata(filePath) {
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

function isPlausibleHccTimestamp(timestampSeconds, year) {
  const minTimestamp = Date.UTC(year - 1, 11, 20) / 1000;
  const maxTimestamp = Date.UTC(year + 1, 0, 15) / 1000;
  return (
    Number.isFinite(timestampSeconds) &&
    timestampSeconds >= minTimestamp &&
    timestampSeconds <= maxTimestamp &&
    timestampSeconds % 60 === 0
  );
}

function decodeHccRecord(buffer, offset, year) {
  if (offset < 0 || offset + HCC_RECORD_BYTES > buffer.length) {
    return null;
  }

  const timestampSeconds = bufferToUInt64(buffer, offset);
  if (!isPlausibleHccTimestamp(timestampSeconds, year)) {
    return null;
  }

  const open = buffer.readDoubleLE(offset + 8);
  const high = buffer.readDoubleLE(offset + 16);
  const low = buffer.readDoubleLE(offset + 24);
  const close = buffer.readDoubleLE(offset + 32);
  const volume = bufferToUInt64(buffer, offset + 40);
  const spread = buffer.readUInt32LE(offset + 48);

  if (![open, high, low, close].every(Number.isFinite)) {
    return null;
  }
  if (!(open > 0 && high > 0 && low > 0 && close > 0)) {
    return null;
  }
  if (high < open || high < close || high < low) {
    return null;
  }
  if (low > open || low > close || low > high) {
    return null;
  }
  if (!Number.isFinite(volume) || volume < 0) {
    return null;
  }
  if (spread > 100_000) {
    return null;
  }

  return {
    timestamp: timestampSeconds * 1000,
    open,
    high,
    low,
    close,
    volume,
    spread,
  };
}

async function getHccFileIndex(filePath, year) {
  const stats = await fs.stat(filePath);
  const cacheKey = `${filePath}:${stats.size}:${stats.mtimeMs}`;
  const cached = hccIndexCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const buffer = await readFileBufferWithSharing(filePath);
  const rawSegments = [];

  for (let offset = 0; offset <= buffer.length - HCC_RECORD_BYTES * 2; offset += 1) {
    const current = decodeHccRecord(buffer, offset, year);
    if (!current) continue;

    const next = decodeHccRecord(buffer, offset + HCC_RECORD_BYTES, year);
    if (!next) continue;

    const nextDelta = next.timestamp - current.timestamp;
    if (nextDelta < 0 || nextDelta > 7 * 24 * 60 * 60 * 1000) {
      continue;
    }

    const previous = decodeHccRecord(buffer, offset - HCC_RECORD_BYTES, year);
    if (previous) {
      const previousDelta = current.timestamp - previous.timestamp;
      if (previousDelta >= 0 && previousDelta <= 7 * 24 * 60 * 60 * 1000) {
        continue;
      }
    }

    let count = 2;
    let previousTimestamp = next.timestamp;
    let cursor = offset + HCC_RECORD_BYTES * 2;

    while (cursor <= buffer.length - HCC_RECORD_BYTES) {
      const record = decodeHccRecord(buffer, cursor, year);
      if (!record) break;

      const delta = record.timestamp - previousTimestamp;
      if (delta < 0 || delta > 7 * 24 * 60 * 60 * 1000) {
        break;
      }

      previousTimestamp = record.timestamp;
      count += 1;
      cursor += HCC_RECORD_BYTES;
    }

    if (count >= HCC_MIN_SEGMENT_RECORDS) {
      rawSegments.push({
        startOffset: offset,
        count,
        firstTimestamp: current.timestamp,
        lastTimestamp: previousTimestamp,
      });
      offset = cursor - 1;
    }
  }

  const uniqueSegments = [...new Map(
    rawSegments.map((segment) => [
      `${segment.firstTimestamp}:${segment.lastTimestamp}:${segment.count}`,
      segment,
    ])
  ).values()].sort((a, b) => a.firstTimestamp - b.firstTimestamp || a.startOffset - b.startOffset);

  const index = {
    filePath,
    year,
    size: stats.size,
    updatedAt: stats.mtimeMs,
    segments: uniqueSegments,
    barCount: uniqueSegments.reduce((sum, segment) => sum + segment.count, 0),
    firstTimestamp: uniqueSegments[0]?.firstTimestamp ?? 0,
    lastTimestamp: uniqueSegments[uniqueSegments.length - 1]?.lastTimestamp ?? 0,
  };

  hccIndexCache.set(cacheKey, index);
  return index;
}

async function listHistoryYearFiles(symbol, rootOverride) {
  const symbolDir = path.join(resolveMt5HistoryRoot(rootOverride), symbol);
  const entries = await fs.readdir(symbolDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      name: entry.name,
      year: parseHistoryYearFile(entry.name),
    }))
    .filter((entry) => Number.isFinite(entry.year))
    .sort((a, b) => a.year - b.year)
    .map((entry) => ({
      year: entry.year,
      filePath: path.join(symbolDir, entry.name),
    }));
}

function readHccTimestampAt(buffer, segment, index) {
  if (index < 0 || index >= segment.count) {
    throw new Error(`HCC timestamp index ${index} out of range for ${segment.count} bars.`);
  }
  return bufferToUInt64(buffer, segment.startOffset + index * HCC_RECORD_BYTES) * 1000;
}

function lowerBoundHccIndex(buffer, segment, targetTimestamp) {
  let left = 0;
  let right = segment.count;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    const current = readHccTimestampAt(buffer, segment, mid);
    if (current < targetTimestamp) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  return left;
}

function upperBoundHccIndex(buffer, segment, targetTimestamp) {
  let left = 0;
  let right = segment.count;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    const current = readHccTimestampAt(buffer, segment, mid);
    if (current <= targetTimestamp) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  return left;
}

async function readHccBarsFromFile(filePath, fileIndex, symbol, timeframe, from, to) {
  const buffer = await readFileBufferWithSharing(filePath);
  const bars = [];
  for (const segment of fileIndex.segments) {
    if (segment.lastTimestamp < from || segment.firstTimestamp > to) {
      continue;
    }

    const startIndex = lowerBoundHccIndex(buffer, segment, from);
    const endIndexExclusive = upperBoundHccIndex(buffer, segment, to);
    const sliceCount = Math.max(0, endIndexExclusive - startIndex);
    if (sliceCount <= 0) continue;

    for (let index = 0; index < sliceCount; index += 1) {
      const offset =
        segment.startOffset + (startIndex + index) * HCC_RECORD_BYTES;
      bars.push({
        symbol,
        timeframe,
        timestamp: bufferToUInt64(buffer, offset) * 1000,
        open: buffer.readDoubleLE(offset + 8),
        high: buffer.readDoubleLE(offset + 16),
        low: buffer.readDoubleLE(offset + 24),
        close: buffer.readDoubleLE(offset + 32),
        volume: bufferToUInt64(buffer, offset + 40),
      });
    }
  }
  return bars;
}

async function listHccM1Summary(symbol, rootOverride, options = {}) {
  const yearFiles = await listHistoryYearFiles(symbol, rootOverride);
  const filteredYearFiles = yearFiles.filter(
    ({ year }) => !Number.isFinite(options.minYear) || year >= options.minYear
  );
  if (filteredYearFiles.length === 0) {
    return null;
  }

  const indices = (await Promise.all(
    filteredYearFiles.map(async ({ year, filePath }) => {
      try {
        const index = await getHccFileIndex(filePath, year);
        return index.barCount > 0 ? index : null;
      } catch {
        return null;
      }
    })
  )).filter(Boolean);

  if (indices.length === 0) {
    return null;
  }

  const latestAllowedTimestamp =
    Math.floor(Date.now() / TIMEFRAME_TO_MS.M1) * TIMEFRAME_TO_MS.M1;
  const effectiveTo = Math.min(
    indices[indices.length - 1].lastTimestamp,
    latestAllowedTimestamp
  );

  return {
    timeframe: "M1",
    fileName: `${indices[0].year}-${indices[indices.length - 1].year}.hcc`,
    barCount: indices.reduce((sum, item) => sum + item.barCount, 0),
    from: indices[0].firstTimestamp,
    to: effectiveTo,
    updatedAt: Math.max(...indices.map((item) => item.updatedAt)),
    source: "year",
  };
}

async function readTimeAt(handle, count, index) {
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

async function lowerBoundIndex(handle, count, targetTimestamp) {
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

async function upperBoundIndex(handle, count, targetTimestamp) {
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

function buildCacheFilePath(symbol, timeframe, rootOverride) {
  return path.join(
    resolveMt5HistoryRoot(rootOverride),
    symbol,
    "cache",
    timeframeToCacheFile(timeframe)
  );
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readFileBufferWithSharing(filePath) {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if (process.platform !== "win32" || error?.code !== "EBUSY") {
      throw error;
    }
  }

  const escapedSource = filePath.replace(/'/g, "''");
  const script = [
    `$src='${escapedSource}';`,
    `$in=[System.IO.File]::Open($src,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::ReadWrite);`,
    "try {",
    "  $mem=New-Object System.IO.MemoryStream;",
    "  try {",
    "    $in.CopyTo($mem);",
    "    $base64=[Convert]::ToBase64String($mem.ToArray());",
    "    $bytes=[System.Text.Encoding]::ASCII.GetBytes($base64);",
    "    [Console]::OpenStandardOutput().Write($bytes,0,$bytes.Length);",
    "  } finally { $mem.Dispose() }",
    "} finally { $in.Dispose() }",
  ].join(" ");

  const { stdout } = await runProcess("powershell", ["-NoProfile", "-Command", script]);
  return Buffer.from(stdout.trim(), "base64");
}

function sortTimeframeSummaries(summaries) {
  return [...summaries].sort(
    (a, b) => STANDARD_TIMEFRAMES.indexOf(a.timeframe) - STANDARD_TIMEFRAMES.indexOf(b.timeframe)
  );
}

function buildDerivedTimeframes(baseSummary, existing) {
  return STANDARD_TIMEFRAMES.map((timeframe) => {
    const cached = existing.get(timeframe);
    if (cached) return cached;

    return {
      timeframe,
      fileName: `Derived from ${baseSummary.fileName}`,
      barCount: Math.max(
        1,
        Math.floor(
          baseSummary.barCount /
            Math.max(1, TIMEFRAME_TO_MS[timeframe] / TIMEFRAME_TO_MS.M1)
      )
      ),
      from: baseSummary.from,
      to: baseSummary.to,
      updatedAt: baseSummary.updatedAt,
      source: "derived",
    };
  });
}

function floorTimestampToTimeframe(timestamp, timeframe) {
  if (timeframe === "D1") {
    const date = new Date(timestamp);
    date.setUTCHours(0, 0, 0, 0);
    return date.getTime();
  }

  const interval = TIMEFRAME_TO_MS[timeframe];
  return Math.floor(timestamp / interval) * interval;
}

function aggregateBarsToTimeframe(bars, timeframe) {
  if (timeframe === "M1") return bars;
  if (bars.length === 0) return [];

  const aggregated = [];
  let activeBucket = Number.NaN;
  let currentBar = null;

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
    };
  }

  if (currentBar) {
    aggregated.push(currentBar);
  }

  return aggregated;
}

function mergeBarsByTimestamp(primaryBars, secondaryBars, limit) {
  const merged = new Map();
  for (const bar of primaryBars) {
    merged.set(bar.timestamp, bar);
  }
  for (const bar of secondaryBars) {
    merged.set(bar.timestamp, bar);
  }
  return [...merged.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(0, limit);
}

export function resolveMt5HistoryRoot(overridePath) {
  return overridePath?.trim() || DEFAULT_MT5_HISTORY_ROOT;
}

export async function listMt5Symbols(rootOverride) {
  const root = resolveMt5HistoryRoot(rootOverride);
  const currentYear = new Date().getUTCFullYear();
  const symbolEntries = await fs.readdir(root, { withFileTypes: true });
  const symbols = symbolEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const summaries = await Promise.all(
    symbols.map(async (symbol) => {
      const cacheDir = path.join(root, symbol, "cache");
      let cacheEntries = [];
      try {
        cacheEntries = await fs.readdir(cacheDir, { withFileTypes: true });
      } catch {
        return null;
      }

      const rawTimeframes = await Promise.all(
        cacheEntries
          .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".hc"))
          .map(async (entry) => {
            const timeframe = normalizeTimeframe(entry.name);
            if (!timeframe) return null;

            const filePath = path.join(cacheDir, entry.name);
            const [metadata, stats] = await Promise.all([
              readCacheMetadata(filePath),
              fs.stat(filePath),
            ]);
            if (metadata.count === 0) return null;

            return {
              timeframe,
              fileName: entry.name,
              barCount: metadata.count,
              from: metadata.firstTimestamp,
              to: metadata.lastTimestamp,
              updatedAt: stats.mtimeMs,
              source: "cache",
            };
          })
      );

      const timeframes = rawTimeframes.filter(Boolean);
      const cacheTimeframeMap = new Map(
        timeframes.map((timeframeSummary) => [timeframeSummary.timeframe, timeframeSummary])
      );
      const cacheM1Summary = cacheTimeframeMap.get("M1") ?? null;
      const hccM1Summary = await listHccM1Summary(symbol, rootOverride, {
        minYear: cacheM1Summary
          ? new Date(cacheM1Summary.to).getUTCFullYear()
          : currentYear,
      }).catch(() => null);

      let preferredM1Summary = cacheM1Summary;
      if (hccM1Summary && cacheM1Summary && hccM1Summary.to > cacheM1Summary.to) {
        const recentBars = await readMt5Bars({
          symbol,
          timeframe: "M1",
          from: cacheM1Summary.to + TIMEFRAME_TO_MS.M1,
          to: hccM1Summary.to,
          limit: 250_000,
          rootPath: rootOverride,
        }).catch(() => []);
        preferredM1Summary = {
          ...cacheM1Summary,
          barCount: cacheM1Summary.barCount + recentBars.length,
          to: hccM1Summary.to,
          updatedAt: Math.max(
            cacheM1Summary.updatedAt ?? 0,
            hccM1Summary.updatedAt ?? 0
          ),
          source: "year",
        };
      } else if (hccM1Summary && !cacheM1Summary) {
        preferredM1Summary = hccM1Summary;
      }

      if (!preferredM1Summary && timeframes.length === 0) return null;

      const timeframeMap = new Map(
        timeframes.map((timeframeSummary) => [
          timeframeSummary.timeframe,
          timeframeSummary,
        ])
      );
      if (preferredM1Summary) {
        timeframeMap.set("M1", preferredM1Summary);
      }
      const overlayTimeframes = [...timeframeMap.values()].map((timeframeSummary) =>
        applyLiveSummaryOverlay(timeframeSummary, symbol)
      );
      const overlayTimeframeMap = new Map(
        overlayTimeframes.map((timeframeSummary) => [timeframeSummary.timeframe, timeframeSummary])
      );
      const m1Summary = overlayTimeframeMap.get("M1");
      const finalTimeframes = m1Summary
        ? buildDerivedTimeframes(m1Summary, overlayTimeframeMap)
        : sortTimeframeSummaries(overlayTimeframes).filter((item) =>
            STANDARD_TIMEFRAMES.includes(item.timeframe)
          );

      return {
        symbol,
        timeframes: sortTimeframeSummaries(finalTimeframes),
      };
    })
  );

  return summaries.filter(Boolean);
}

export async function readMt5Bars(params) {
  const { symbol, timeframe, from, to, limit = 10_000, rootPath } = params;
  const normalizedFrom = Math.min(from, to);
  const normalizedTo = Math.max(from, to);

  if (timeframe === "M1") {
    const yearFiles = await listHistoryYearFiles(symbol, rootPath).catch(() => []);
    const fromYear = new Date(normalizedFrom).getUTCFullYear();
    const toYear = new Date(normalizedTo).getUTCFullYear();
    const candidateYearFiles = yearFiles.filter(
      ({ year }) => year >= fromYear - 1 && year <= toYear + 1
    );
    if (yearFiles.length > 0) {
      const relevantFiles = [];
      for (const { year, filePath } of candidateYearFiles) {
        let index;
        try {
          index = await getHccFileIndex(filePath, year);
        } catch {
          continue;
        }
        if (index.barCount <= 0) continue;
        if (index.lastTimestamp < normalizedFrom || index.firstTimestamp > normalizedTo) {
          continue;
        }
        relevantFiles.push({ filePath, index });
      }

      if (relevantFiles.length > 0) {
        const merged = new Map();
        for (const { filePath, index } of relevantFiles) {
          const fileBars = await readHccBarsFromFile(
            filePath,
            index,
            symbol,
            timeframe,
            normalizedFrom,
            normalizedTo
          );
          for (const bar of fileBars) {
            merged.set(bar.timestamp, bar);
          }
        }

        const yearBars = [...merged.values()]
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(0, limit);
        if (yearBars.length > 0) {
          return yearBars;
        }
      }
    }
  }

  const filePath = buildCacheFilePath(symbol, timeframe, rootPath);

  if (!(await fileExists(filePath)) && timeframe !== "M1") {
    const ratio = Math.max(1, Math.ceil(TIMEFRAME_TO_MS[timeframe] / TIMEFRAME_TO_MS.M1));
    const m1Bars = await readMt5Bars({
      symbol,
      timeframe: "M1",
      from: normalizedFrom,
      to: normalizedTo,
      limit: limit * ratio,
      rootPath,
    });
    return aggregateBarsToTimeframe(m1Bars, timeframe).slice(0, limit);
  }

  if (!(await fileExists(filePath)) && timeframe === "M1") {
    const liveBars = await requestMt5BarsData({
      symbol,
      timeframe,
      from: normalizedFrom,
      to: normalizedTo,
      historyRoot: rootPath,
    });
    return liveBars.slice(0, limit);
  }

  const handle = await fs.open(filePath, "r");
  try {
    const header = await readExactly(handle, TIME_SECTION_OFFSET + 8, 0);
    const count = header.readUInt32LE(HEADER_COUNT_OFFSET);
    if (count <= 0) {
      if (timeframe === "M1") {
        const liveBars = await requestMt5BarsData({
          symbol,
          timeframe,
          from: normalizedFrom,
          to: normalizedTo,
          historyRoot: rootPath,
        });
        return liveBars.slice(0, limit);
      }
      return [];
    }

    const cacheMetadata =
      timeframe === "M1"
        ? {
            count,
            firstTimestamp: bufferToUInt64(header, TIME_SECTION_OFFSET) * 1000,
            lastTimestamp: bufferToUInt64(
              await readExactly(
                handle,
                INT64_BYTES,
                TIME_SECTION_OFFSET + (count - 1) * INT64_BYTES
              )
            ) * 1000,
          }
        : null;

    const startIndex = await lowerBoundIndex(handle, count, normalizedFrom);
    const endIndexExclusive = await upperBoundIndex(handle, count, normalizedTo);
    const totalRequested = Math.max(0, endIndexExclusive - startIndex);
    const sliceCount = Math.min(totalRequested, Math.max(1, limit));
    if (sliceCount === 0) {
      if (timeframe === "M1" && cacheMetadata && normalizedTo > cacheMetadata.lastTimestamp) {
        const liveFrom = Math.max(normalizedFrom, cacheMetadata.lastTimestamp + TIMEFRAME_TO_MS.M1);
        const liveBars = await requestMt5BarsData({
          symbol,
          timeframe,
          from: liveFrom,
          to: normalizedTo,
          historyRoot: rootPath,
        });
        return liveBars.slice(0, limit);
      }
      return [];
    }

    const timeBuffer = await readExactly(
      handle,
      sliceCount * INT64_BYTES,
      TIME_SECTION_OFFSET + startIndex * INT64_BYTES
    );
    const openBuffer = await readExactly(
      handle,
      sliceCount * INT64_BYTES,
      getSectionOffset(count, "open") + SECTION_MARKER_BYTES + startIndex * INT64_BYTES
    );
    const highBuffer = await readExactly(
      handle,
      sliceCount * INT64_BYTES,
      getSectionOffset(count, "high") + SECTION_MARKER_BYTES + startIndex * INT64_BYTES
    );
    const lowBuffer = await readExactly(
      handle,
      sliceCount * INT64_BYTES,
      getSectionOffset(count, "low") + SECTION_MARKER_BYTES + startIndex * INT64_BYTES
    );
    const closeBuffer = await readExactly(
      handle,
      sliceCount * INT64_BYTES,
      getSectionOffset(count, "close") + SECTION_MARKER_BYTES + startIndex * INT64_BYTES
    );
    const volumeBuffer = await readExactly(
      handle,
      sliceCount * INT64_BYTES,
      getSectionOffset(count, "volume") + SECTION_MARKER_BYTES + startIndex * INT64_BYTES
    );

    const bars = [];
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

    if (timeframe !== "M1") {
      return bars;
    }

    if (!cacheMetadata || normalizedTo <= cacheMetadata.lastTimestamp) {
      return bars;
    }

    const liveFrom = Math.max(normalizedFrom, cacheMetadata.lastTimestamp + TIMEFRAME_TO_MS.M1);
    const liveBars = await requestMt5BarsData({
      symbol,
      timeframe,
      from: liveFrom,
      to: normalizedTo,
      historyRoot: rootPath,
    });

    return mergeBarsByTimestamp(bars, liveBars, limit);
  } finally {
    await handle.close();
  }
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: SERVICE_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `${command} exited with code ${code}`));
    });
  });
}

async function fileExistsQuietly(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveMt5BridgeCommand() {
  const bundledPath = path.join(BUNDLED_BRIDGE_DIR, BUNDLED_BRIDGE_NAME);
  if (await fileExistsQuietly(bundledPath)) {
    return {
      mode: "bundled",
      command: bundledPath,
      argsPrefix: [],
    };
  }

  const scriptPath = path.join(SERVICE_DIR, "request_mt5_bars.py");
  const pythonAttempts = [
    { command: "python", argsPrefix: [scriptPath] },
    { command: "py", argsPrefix: ["-3", scriptPath] },
  ];

  for (const attempt of pythonAttempts) {
    try {
      const probeArgs =
        attempt.command === "python" ? ["--version"] : ["-3", "--version"];
      await runProcess(attempt.command, probeArgs);
      return {
        mode: "python",
        command: attempt.command,
        argsPrefix: attempt.argsPrefix,
      };
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        continue;
      }
    }
  }

  throw new Error(
    "No MT5 bridge was found. Build the bundled bridge with `npm run mt5:bridge:build`, or install Python and the MetaTrader5 package for development."
  );
}

export async function requestMt5BarsDownload(params) {
  const {
    symbol,
    timeframe,
    from,
    to,
    historyRoot,
  } = params;
  const intervalMs = TIMEFRAME_TO_MS[timeframe] ?? TIMEFRAME_TO_MS.M1;
  const normalizedFrom = Math.min(from, to);
  const normalizedToCandidate = Math.max(from, to);
  const normalizedTo =
    normalizedToCandidate === normalizedFrom
      ? normalizedToCandidate + intervalMs
      : normalizedToCandidate;

  const bridge = await resolveMt5BridgeCommand();
  const baseArgs = [
    "--symbol",
    symbol,
    "--timeframe",
    timeframe,
    "--from",
    new Date(normalizedFrom).toISOString(),
    "--to",
    new Date(normalizedTo).toISOString(),
  ];

  if (historyRoot?.trim()) {
    baseArgs.push("--history-root", historyRoot.trim());
  }

  const result = await runProcess(bridge.command, [...bridge.argsPrefix, ...baseArgs]);
  const parsed = JSON.parse(result.stdout);
  updateLiveMt5State(symbol, timeframe, {
    count: parsed.count ?? 0,
    firstTimestamp: parsed.firstTimestamp ?? null,
    lastTimestamp: parsed.lastTimestamp ?? null,
    updatedAt: Date.now(),
  });
  return {
    ...parsed,
    bridgeMode: bridge.mode,
  };
}

async function requestMt5BarsData(params) {
  const {
    symbol,
    timeframe,
    from,
    to,
    historyRoot,
  } = params;
  const intervalMs = TIMEFRAME_TO_MS[timeframe] ?? TIMEFRAME_TO_MS.M1;
  const normalizedFrom = Math.min(from, to);
  const normalizedToCandidate = Math.max(from, to);
  const normalizedTo =
    normalizedToCandidate === normalizedFrom
      ? normalizedToCandidate + intervalMs
      : normalizedToCandidate;

  const bridge = await resolveMt5BridgeCommand();
  const baseArgs = [
    "--symbol",
    symbol,
    "--timeframe",
    timeframe,
    "--from",
    new Date(normalizedFrom).toISOString(),
    "--to",
    new Date(normalizedTo).toISOString(),
    "--return-bars",
  ];

  if (historyRoot?.trim()) {
    baseArgs.push("--history-root", historyRoot.trim());
  }

  const result = await runProcess(bridge.command, [...bridge.argsPrefix, ...baseArgs]);
  const parsed = JSON.parse(result.stdout);
  updateLiveMt5State(symbol, timeframe, {
    count: parsed.count ?? 0,
    firstTimestamp: parsed.firstTimestamp ?? null,
    lastTimestamp: parsed.lastTimestamp ?? null,
    updatedAt: Date.now(),
  });
  return Array.isArray(parsed.bars)
    ? parsed.bars.map((bar) => ({
        symbol,
        timeframe,
        timestamp: Number(bar.timestamp),
        open: Number(bar.open),
        high: Number(bar.high),
        low: Number(bar.low),
        close: Number(bar.close),
        volume: Number(bar.volume),
      }))
    : [];
}

function buildCorsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function writeJson(response, statusCode, payload, origin) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...buildCorsHeaders(origin),
  });
  response.end(JSON.stringify(payload));
}

function parseLimit(raw) {
  const limit = Number(raw ?? "10000");
  return Number.isFinite(limit) ? Math.max(1, Math.min(limit, 50_000)) : 10_000;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large."));
        request.destroy();
      }
    });

    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });

    request.on("error", reject);
  });
}

export function startMt5LocalService(options = {}) {
  const host = options.host || process.env.MT5_LOCAL_SERVICE_HOST || "127.0.0.1";
  const port = Number(
    options.port || process.env.MT5_LOCAL_SERVICE_PORT || process.env.PORT || 47831
  );

  const server = http.createServer(async (request, response) => {
    const origin = request.headers.origin;

    if (!request.url) {
      writeJson(response, 400, { error: "Missing request URL." }, origin);
      return;
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204, buildCorsHeaders(origin));
      response.end();
      return;
    }

    if (request.method !== "GET" && request.method !== "POST") {
      writeJson(response, 405, { error: "Method not allowed." }, origin);
      return;
    }

    try {
      const url = new URL(request.url, `http://${request.headers.host ?? `${host}:${port}`}`);
      const pathname = url.pathname;

      if (pathname === "/health") {
        writeJson(
          response,
          200,
          {
            ok: true,
            service: "mt5-history-local-service",
            defaultRootPath: resolveMt5HistoryRoot(),
          },
          origin
        );
        return;
      }

      if (pathname === "/api/mt5/history/meta") {
        const rootPath = url.searchParams.get("rootPath");
        const symbols = await listMt5Symbols(rootPath);
        writeJson(
          response,
          200,
          {
            sourcePath: resolveMt5HistoryRoot(rootPath),
            symbols,
          },
          origin
        );
        return;
      }

      if (pathname === "/api/mt5/history/bars") {
        const symbol = url.searchParams.get("symbol")?.trim();
        const timeframe = url.searchParams.get("timeframe")?.trim() ?? "";
        const from = Number(url.searchParams.get("from"));
        const to = Number(url.searchParams.get("to"));
        const rootPath = url.searchParams.get("rootPath");

        if (!symbol) {
          writeJson(response, 400, { error: "Missing symbol." }, origin);
          return;
        }

        if (!STANDARD_TIMEFRAMES.includes(timeframe)) {
          writeJson(response, 400, { error: "Invalid timeframe." }, origin);
          return;
        }

        if (!Number.isFinite(from) || !Number.isFinite(to)) {
          writeJson(response, 400, { error: "Invalid from/to range." }, origin);
          return;
        }

        const bars = await readMt5Bars({
          symbol,
          timeframe,
          from,
          to,
          limit: parseLimit(url.searchParams.get("limit")),
          rootPath,
        });

        writeJson(
          response,
          200,
          {
            symbol,
            timeframe,
            from,
            to,
            bars,
          },
          origin
        );
        return;
      }

      if (pathname === "/api/mt5/history/request-bars" && request.method === "POST") {
        const body = await readJsonBody(request);
        const symbol = typeof body.symbol === "string" ? body.symbol.trim() : "";
        const timeframe = typeof body.timeframe === "string" ? body.timeframe.trim() : "";
        const from = Number(body.from);
        const to = Number(body.to);
        const historyRoot =
          typeof body.historyRoot === "string" ? body.historyRoot.trim() : "";

        if (!symbol) {
          writeJson(response, 400, { error: "Missing symbol." }, origin);
          return;
        }

        if (!STANDARD_TIMEFRAMES.includes(timeframe)) {
          writeJson(response, 400, { error: "Invalid timeframe." }, origin);
          return;
        }

        if (!Number.isFinite(from) || !Number.isFinite(to)) {
          writeJson(response, 400, { error: "Invalid from/to range." }, origin);
          return;
        }

        const result = await requestMt5BarsDownload({
          symbol,
          timeframe,
          from,
          to,
          historyRoot,
        });

        writeJson(
          response,
          200,
          {
            ok: true,
            ...result,
          },
          origin
        );
        return;
      }

      writeJson(response, 404, { error: "Not found." }, origin);
    } catch (error) {
      writeJson(
        response,
        500,
        {
          error: error instanceof Error ? error.message : "Unexpected MT5 service error.",
        },
        origin
      );
    }
  });

  server.listen(port, host, () => {
    console.log(`MT5 local service listening on http://${host}:${port}`);
  });

  return server;
}

const isEntrypoint =
  process.argv.includes("--serve") &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isEntrypoint) {
  startMt5LocalService();
}
