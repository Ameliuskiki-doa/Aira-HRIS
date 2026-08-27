"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "./app-shell";
import { SHELL_USER_FIXTURE, type ShellCompany } from "./fixtures";

/**
 * The shell, connected to the router.
 *
 * Kept to this one adapter so `AppShell` itself takes the active segment as a
 * value. `useSelectedLayoutSegment()` reads exactly one segment below the
 * layout that calls it and returns `null` on that layout's own page, which is
 * why the nav's active test is a segment comparison rather than pathname
 * string-matching — the latter would call `/employees/123` inactive.
 *
 * The company arrives from the server layout, which reads it under the user's
 * own session. The user is still `SHELL_USER_FIXTURE`: `auth.users` carries an
 * email, not a name, and a role belongs to a membership — Story 1.6.
 */
export function AppShellRoute({
  company,
  children,
}: {
  readonly company: ShellCompany;
  readonly children: ReactNode;
}) {
  const activeSegment = useSelectedLayoutSegment();

  return (
    <AppShell
      activeSegment={activeSegment}
      company={company}
      user={SHELL_USER_FIXTURE}
    >
      {children}
    </AppShell>
  );
}
