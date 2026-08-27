import { UI_LOCALE } from "@/lib/locale";

/**
 * Company timezones, and the day boundary the product runs on.
 *
 * Not in `fixtures.ts`, where it started. That module is the deletable seam for
 * the absent data layer — Stories 1.5 and 1.6 remove it — and deleting it would
 * have taken this with it. Fixtures are values; this is behaviour.
 *
 * Indonesia has three legal time zones spread over four IANA identifiers, and
 * the fourth is the one that gets forgotten: `Asia/Pontianak` is West
 * Kalimantan, WIB, and a distinct identifier from `Asia/Jakarta`.
 */

/** The four IANA identifiers an Indonesian company can carry, and their names. */
const ZONE_LABELS: Record<string, string> = {
  "Asia/Jakarta": "WIB",
  "Asia/Pontianak": "WIB",
  "Asia/Makassar": "WITA",
  "Asia/Jayapura": "WIT",
};

/** Every identifier the label map covers. Exported so a test can sweep them. */
export const INDONESIAN_TIME_ZONES: readonly string[] = Object.keys(ZONE_LABELS);

/** WIB / WITA / WIT for an identifier; the identifier itself if unrecognised. */
export function zoneLabel(timeZone: string): string {
  return ZONE_LABELS[timeZone] ?? timeZone;
}

/**
 * A date in the company's timezone, in Indonesian.
 *
 * Fails soft, and that matters more than it looks: `Intl.DateTimeFormat`
 * throws `RangeError` on an unrecognised `timeZone`, and this runs during
 * render — so one bad `companies.timezone` would take down the entire shell,
 * not just the header line it belongs to. `companies.timezone` is tenant data
 * from Story 1.5 onward and nothing validates it yet.
 *
 * The fallback is UTC rather than the browser's zone. A wrong date that reads
 * as local is indistinguishable from a right one; paired with `zoneLabel`
 * echoing the unrecognised identifier back, the line visibly says something is
 * misconfigured instead of quietly lying by a few hours.
 */
export function formatCompanyDate(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(UI_LOCALE, {
      dateStyle: "medium",
      timeZone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(UI_LOCALE, {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(date);
  }
}
