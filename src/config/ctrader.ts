/**
 * cTrader API configuration
 *
 * ProtoOAGetTrendbarsReq has a hard limit of 14,000 bars per request.
 * For M1: 14,000 bars ≈ 9.7 days. Use 9 days per chunk to stay under the limit.
 * @see https://community.ctrader.com/forum/connect-api-support/24731
 */
export const CTRADER_MAX_BARS_PER_REQUEST = 14_000;

/** M1 bars per day (24h) */
const M1_BARS_PER_DAY = 24 * 60;

/** Max chunk size in days for M1 to stay under API limit */
export const CTRADER_M1_MAX_CHUNK_DAYS = Math.floor(
  CTRADER_MAX_BARS_PER_REQUEST / M1_BARS_PER_DAY
);
