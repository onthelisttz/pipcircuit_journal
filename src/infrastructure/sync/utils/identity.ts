const DEVICE_ID_STORAGE_KEY = "sync.deviceId";

let cachedDeviceId: string | null = null;

function fallbackUuid(): string {
  const segment = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
  return `${segment()}${segment()}-${segment()}-${segment()}-${segment()}-${segment()}${segment()}${segment()}`;
}

export function createUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return fallbackUuid();
}

export function getOrCreateDeviceId(): string {
  if (cachedDeviceId) {
    return cachedDeviceId;
  }

  if (typeof window === "undefined") {
    cachedDeviceId = "server-runtime";
    return cachedDeviceId;
  }

  try {
    const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing) {
      cachedDeviceId = existing;
      return existing;
    }

    const next = createUuid();
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, next);
    cachedDeviceId = next;
    return next;
  } catch {
    const fallback = createUuid();
    cachedDeviceId = fallback;
    return fallback;
  }
}
