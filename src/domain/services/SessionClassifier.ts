import { Session } from "../enums";

/**
 * Classifies trade open time (UTC) into trading session.
 * Asia: 00:00-08:00 UTC
 * London: 08:00-16:00 UTC
 * New York: 13:00-21:00 UTC
 * Overlaps resolve to first matching session.
 */
export function getSessionFromDate(date: Date): Session {
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();
  const totalMinutes = hour * 60 + minute;

  // Asia: 00:00 - 08:00 UTC (0 - 480 min)
  if (totalMinutes >= 0 && totalMinutes < 8 * 60) {
    return Session.Asia;
  }
  // London: 08:00 - 16:00 UTC (480 - 960 min)
  if (totalMinutes >= 8 * 60 && totalMinutes < 16 * 60) {
    return Session.London;
  }
  // New York: 13:00 - 21:00 UTC (780 - 1260 min, wraps)
  if (totalMinutes >= 13 * 60 && totalMinutes < 21 * 60) {
    return Session.NewYork;
  }
  return Session.OutOfSession;
}
