export const CTRADER_LIVE_SERVICE_URL_SETTING_KEY = "ctrader.liveServiceUrl";
export const DEFAULT_CTRADER_LIVE_SERVICE_URL = "http://127.0.0.1:47832";

export function normalizeLocalServiceUrl(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/, "");
}

export function buildLocalServiceEndpoint(
  path: string,
  serviceUrl?: string | null
): string {
  const normalized = normalizeLocalServiceUrl(serviceUrl);
  if (!normalized) return path;
  return `${normalized}${path.startsWith("/") ? path : `/${path}`}`;
}
