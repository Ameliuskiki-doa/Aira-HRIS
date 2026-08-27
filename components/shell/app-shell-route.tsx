"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "./app-shell";
import { SHELL_COMPANY_FIXTURE, SHELL_USER_FIXTURE } from "./fixtures";

/**
 * The shell, connected to the router.
 *
 * Kept to this one adapter so `AppShell` itself takes the active segment as a
 * value. `useSelectedLayoutSegment()` reads exactly one segment below the
 * layout that calls it and returns `null` on that layout's own page, which is
 * why the nav's active test is a segment comparison rather than pathname
 * string-matching — the latter would call `/karyawan/123` inactive.
 *
 * The company and the user are fixtures. There is no data layer until Stories
 * 1.5 and 1.6; this is the single line that changes when there is one.
 */
export function AppShellRoute({ children }: { children: ReactNode }) {
  const activeSegment = useSelectedLayoutSegment();

  return (
    <AppShell
      activeSegment={activeSegment}
      company={SHELL_COMPANY_FIXTURE}
      user={SHELL_USER_FIXTURE}
    >
      {children}
    </AppShell>
  );
}
