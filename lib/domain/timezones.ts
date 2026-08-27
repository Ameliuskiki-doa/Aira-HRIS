/**
 * The time zones a company may be registered in.
 *
 * Indonesia has three legal zones — WIB, WITA, WIT — spread over **four** IANA
 * identifiers, and the difference between those two counts is the whole trap.
 * `Asia/Pontianak` is West Kalimantan: WIB, the same offset as Jakarta, and a
 * separate identifier in the IANA database. An earlier version of this module
 * listed three identifiers because the story said "three zones", and the effect
 * was that a Pontianak company could not register at all — the check
 * constraint raised, and no other value was an honest answer.
 * `components/shell/timezone.ts` has carried a comment naming this exact trap
 * since Story 1.3.
 *
 * `companies.timezone` is the day boundary every attendance record and every
 * payroll period is resolved in, never the server's. Getting it wrong shifts a
 * clock-in across midnight and moves a day's work into the wrong payroll
 * period, so the set is closed — but closed at four identifiers, not three.
 *
 * Pure and total, so it lives here (AD-2): no clock, no I/O, no framework.
 * `lib/validation/company.ts` builds the boundary schema from it, the
 * registration form renders its options from it, and the database repeats the
 * same set as a check constraint — three consumers, one list, and a test that
 * fails if the schema and the constraint stop agreeing.
 */

/**
 * The identifiers, in the order the form offers them: west to east.
 *
 * A `const` tuple rather than an array of objects, so it can be handed to
 * `z.enum` without a cast and so `CompanyTimeZone` is a union of the four
 * literals rather than `string`.
 */
export const COMPANY_TIME_ZONE_IDS = [
  "Asia/Jakarta",
  "Asia/Pontianak",
  "Asia/Makassar",
  "Asia/Jayapura",
] as const;

export type CompanyTimeZone = (typeof COMPANY_TIME_ZONE_IDS)[number];

/**
 * `Record<CompanyTimeZone, …>` and not a partial map: adding an identifier
 * above without naming its zone here is a compile error rather than a form
 * option that renders `undefined`.
 *
 * Two identifiers share the zone `WIB`, which is correct and is why the form
 * shows the covered provinces rather than the zone name alone — "WIB (UTC+7)"
 * would render twice with nothing to choose between.
 *
 * **The regions are the IANA groupings, and getting them wrong defeats the
 * whole point of the list.** A first draft put "West & Central Kalimantan" on
 * the `Asia/Jakarta` row; both of those provinces are `Asia/Pontianak` ("Borneo
 * west, central"). A Pontianak company would have read its own province on the
 * Jakarta row and picked Jakarta — making the option added *for them*
 * unreachable by the only people who need it. Both zones are UTC+7 with no
 * DST, so no payslip would have been wrong; the user would simply have been
 * misled, and the fix would have looked unnecessary forever after.
 *
 * Source groupings, from the IANA database's own comments:
 *   Asia/Jakarta    Java, Sumatra
 *   Asia/Pontianak  Borneo (west, central)
 *   Asia/Makassar   Borneo (east, south); Sulawesi; Bali; Nusa Tenggara;
 *                   Timor (west)
 *   Asia/Jayapura   New Guinea (West Papua); Malukus
 *
 * North Kalimantan is on the Makassar row: it was split out of East Kalimantan
 * in 2012 and kept WITA.
 */
const ZONE_DETAIL: Record<CompanyTimeZone, { zone: string; offset: string; region: string }> = {
  "Asia/Jakarta": { zone: "WIB", offset: "UTC+7", region: "Java, Sumatra" },
  "Asia/Pontianak": { zone: "WIB", offset: "UTC+7", region: "West & Central Kalimantan" },
  "Asia/Makassar": {
    zone: "WITA",
    offset: "UTC+8",
    region: "Bali, Nusa Tenggara, Sulawesi, East/South/North Kalimantan",
  },
  "Asia/Jayapura": { zone: "WIT", offset: "UTC+9", region: "Maluku, Papua" },
};

/** What the registration form renders, one entry per identifier. */
export const COMPANY_TIME_ZONES: ReadonlyArray<{
  readonly id: CompanyTimeZone;
  readonly zone: string;
  readonly offset: string;
  readonly region: string;
}> = COMPANY_TIME_ZONE_IDS.map((id) => ({ id, ...ZONE_DETAIL[id] }));

/** The default a company gets when it expresses no preference. */
export const DEFAULT_COMPANY_TIME_ZONE: CompanyTimeZone = "Asia/Jakarta";
