"use client";

import { useCallback, useSyncExternalStore } from "react";

import { formatCompanyDate, zoneLabel } from "./timezone";

export type HeaderDateProps = {
  /** `companies.timezone` — the day boundary the whole product runs on. */
  readonly timeZone: string;
};

/**
 * Nothing to subscribe to. The date is read once on the client and does not
 * change for the life of the page; the store exists only for its third
 * argument, the server snapshot.
 */
const NEVER_CHANGES = () => () => {};

/**
 * Today's date in the company's timezone, plus that timezone's local name.
 *
 * The date is a client-only value, and `useSyncExternalStore` is how that is
 * said without a hydration mismatch: the server snapshot is `null`, the client
 * snapshot is the formatted date, and React swaps them after hydration without
 * either a mismatch warning or a `setState` cascade in an effect. The zone
 * label is static and renders on the server, so the line is never empty.
 *
 * Rendering "today" on the server instead would bake it into prerendered HTML
 * and be wrong from the next midnight on.
 *
 * It is the first thing the header gives up — below 1200px it is gone. It is
 * context, not function, and the space belongs to the controls.
 */
export function HeaderDate({ timeZone }: HeaderDateProps) {
  const getToday = useCallback(
    () => formatCompanyDate(new Date(), timeZone),
    [timeZone],
  );

  const today = useSyncExternalStore(NEVER_CHANGES, getToday, () => null);

  return (
    <p
      data-slot="header-date"
      className="text-ui-muted desk:block hidden shrink-0 text-xs"
    >
      {today === null
        ? zoneLabel(timeZone)
        : `${today} · ${zoneLabel(timeZone)}`}
    </p>
  );
}
