/**
 * The one place the interface's language is declared.
 *
 * Two values that must agree, kept together so they cannot drift: `UI_LANG`
 * is what `<html lang>` carries, `UI_LOCALE` is what `Intl` formats with.
 *
 * They drifted once already. The copy switched from Indonesian to English on
 * 2026-08-27 and the date formatter stayed on `id-ID`, so the header read
 * "27 Agu 2026" beside ten English nav labels. Every test passed, because the
 * test named the same locale the code did. A shared constant is what makes
 * that particular mistake unavailable rather than merely detectable.
 *
 * `en-GB` rather than `en-US`: day-month-year is how this market reads a date,
 * and the language is what changed, not the convention.
 */
export const UI_LANG = "en" as const;

/**
 * Typed as a locale *of* `UI_LANG`, so the two cannot disagree: assigning
 * `"id-ID"` here is a compile error, not a runtime check and not a test that
 * has to remember to look. The defect that motivated this module is now
 * unavailable rather than merely detectable.
 */
export const UI_LOCALE: `${typeof UI_LANG}-${string}` = "en-GB";
