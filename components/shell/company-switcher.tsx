import { BuildingsIcon } from "@phosphor-icons/react/ssr";

import type { ShellCompany } from "./fixtures";

export type CompanySwitcherProps = {
  readonly company: ShellCompany;
};

/**
 * The company pill.
 *
 * The artboard draws a `caret-up-down` on it, implying a menu it never draws.
 * The interaction spec resolves that: **with one membership there is no menu**
 * — no caret, no trigger, no interaction. A dropdown holding a single item is
 * noise, and most tenants are one PT.
 *
 * So this renders a label, and deliberately not a disabled button: a control
 * that cannot do anything is still announced as a control. The multi-company
 * panel, and the token reissue behind it, belong to Story 1.6, where a
 * membership list exists to switch between.
 *
 * The branch count stays even when the name truncates. Two similarly-named PTs
 * are told apart by their branch count, which makes it the last thing to drop
 * — but a count of zero is dropped entirely. Every company created in Story
 * 1.5 starts with no branches, and "0 cabang" beside its name reads as a
 * defect rather than as information.
 */
export function CompanySwitcher({ company }: CompanySwitcherProps) {
  return (
    <p
      data-slot="company-switcher"
      className="flex min-w-0 items-center gap-2 rounded-md px-2.5 py-1.25 shadow-sm"
    >
      <BuildingsIcon aria-hidden="true" className="text-brand size-3.5 shrink-0" />
      <span className="truncate font-medium">{company.legalName}</span>
      {company.branchCount > 0 && (
        <span
          data-slot="branch-count"
          className="text-2xs text-ui-muted shrink-0"
        >
          {company.branchCount} cabang
        </span>
      )}
    </p>
  );
}
