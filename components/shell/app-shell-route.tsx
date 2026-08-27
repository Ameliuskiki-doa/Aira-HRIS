"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "./app-shell";
import type { SwitchableCompany } from "./company-switcher";
import type { ShellCompany, ShellUser } from "./fixtures";

/**
 * The shell, connected to the router.
 *
 * Kept to this one adapter so `AppShell` itself takes the active segment as a
 * value. `useSelectedLayoutSegment()` reads exactly one segment below the
 * layout that calls it and returns `null` on that layout's own page, which is
 * why the nav's active test is a segment comparison rather than pathname
 * string-matching — the latter would call `/employees/123` inactive.
 *
 * Everything below the segment arrives from the server layout, read under the
 * user's own session: the company from `companies`, the person's role from the
 * token's `app_metadata`, and the switchable companies from
 * `switch_company()`. The last of the Story 1.3 fixtures left the header with
 * Story 1.6 — `branchCount` is the only one still standing, and it waits for
 * Story 1.7 to create `branches`.
 */
export function AppShellRoute({
  company,
  user,
  companies,
  activeCompanyId,
  children,
}: {
  readonly company: ShellCompany;
  readonly user: ShellUser;
  readonly companies?: readonly SwitchableCompany[];
  readonly activeCompanyId?: string | null;
  readonly children: ReactNode;
}) {
  const activeSegment = useSelectedLayoutSegment();

  return (
    <AppShell
      activeSegment={activeSegment}
      company={company}
      user={user}
      companies={companies}
      activeCompanyId={activeCompanyId}
    >
      {children}
    </AppShell>
  );
}
