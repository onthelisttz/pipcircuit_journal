import { promises as fs } from "node:fs";
import http from "node:http";
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

function normalizeTimeframe(fileName) {
  const base = path.basename(fileName, path.extname(fileName)).toUpperCase();
  if (base === "DAILY") return "D1";
  return STANDARD_TIMEFRAMES.includes(base) ? base : null;
}

function timeframeToCacheFile(timeframe) {
  return timeframe === "D1" ? "Daily.hc" : `${timeframe}.hc`;
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

export function resolveMt5HistoryRoot(overridePath) {
  return overridePath?.trim() || DEFAULT_MT5_HISTORY_ROOT;
}

export async function listMt5Symbols(rootOverride) {
  const root = resolveMt5HistoryRoot(rootOverride);
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
            const metadata = await readCacheMetadata(filePath);
            if (metadata.count === 0) return null;

            return {
              timeframe,
              fileName: entry.name,
              barCount: metadata.count,
              from: metadata.firstTimestamp,
              to: metadata.lastTimestamp,
              source: "cache",
            };
          })
      );

      const timeframes = rawTimeframes.filter(Boolean);
      if (timeframes.length === 0) return null;

      const timeframeMap = new Map(
        timeframes.map((timeframeSummary) => [timeframeSummary.timeframe, timeframeSummary])
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
      };
    })
  );

  return summaries.filter(Boolean);
}

export async function readMt5Bars(params) {
  const { symbol, timeframe, from, to, limit = 10_000, rootPath } = params;
  const filePath = buildCacheFilePath(symbol, timeframe, rootPath);

  if (!(await fileExists(filePath)) && timeframe !== "M1") {
    const ratio = Math.max(1, Math.ceil(TIMEFRAME_TO_MS[timeframe] / TIMEFRAME_TO_MS.M1));
    const m1Bars = await readMt5Bars({
      symbol,
      timeframe: "M1",
      from,
      to,
      limit: limit * ratio,
      rootPath,
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

    return bars;
  } finally {
    await handle.close();
  }
}

function buildCorsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
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

    if (request.method !== "GET") {
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
