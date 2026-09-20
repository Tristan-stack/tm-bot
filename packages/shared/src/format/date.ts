import { DAY_MS, HOUR_MS, MINUTE_MS, REMAINING_DETAIL_BELOW_MS } from "../constants.js";
import { en } from "../i18n/en.js";

// Everything is in UTC (D18). Fixed table: Intl `en-GB` gives "Sept" with a recent ICU.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const twoDigits = (value: number): string => String(value).padStart(2, "0");

/** `12 Oct` */
export const formatDayMonth = (date: Date): string =>
  `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()] ?? ""}`;

/** `12 Sep 2026` */
export const formatDate = (date: Date): string =>
  `${formatDayMonth(date)} ${date.getUTCFullYear()}`;

/** `14:32 UTC` */
export const formatTimeUtc = (date: Date): string =>
  `${twoDigits(date.getUTCHours())}:${twoDigits(date.getUTCMinutes())} UTC`;

/** `17 Sep 2026, 14:32 UTC` */
export const formatDateTime = (date: Date): string => `${formatDate(date)}, ${formatTimeUtc(date)}`;

/**
 * Time left on a subscription: `until 12 Oct` from 72 h, then `1d 4h left`, `4h left` and
 * `35m left`, rounded down. `null` once expired.
 */
export function formatRemaining(expiresAt: Date, now: Date): string | null {
  const ms = expiresAt.getTime() - now.getTime();
  if (ms <= 0) return null;
  if (ms >= REMAINING_DETAIL_BELOW_MS) return en.remaining.until(formatDayMonth(expiresAt));

  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
  if (days > 0) return en.remaining.daysHours(days, hours);
  if (hours > 0) return en.remaining.hours(hours);
  return en.remaining.minutes(Math.max(1, Math.floor(ms / MINUTE_MS)));
}
