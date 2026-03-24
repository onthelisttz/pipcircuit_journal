export const MT5_HISTORY_ROOT_SETTING_KEY = "mt5.historyRoot";
export const MT5_LOCAL_SERVICE_URL_SETTING_KEY = "mt5.localServiceUrl";
export const DEFAULT_MT5_LOCAL_SERVICE_URL = "http://127.0.0.1:47831";

export function normalizeMt5ServiceUrl(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/, "");
}

export function buildMt5ServiceEndpoint(
  path: string,
  serviceUrl?: string | null
): string {
  const normalized = normalizeMt5ServiceUrl(serviceUrl);
  if (!normalized) return path;
  return `${normalized}${path.startsWith("/") ? path : `/${path}`}`;
}
