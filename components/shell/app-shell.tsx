"use client";

import { useState, type ReactNode } from "react";

import { AppTooltipProvider } from "@/components/app/tooltip";

import type { SwitchableCompany } from "./company-switcher";
import type { ShellCompany, ShellUser } from "./fixtures";
import { AppHeader } from "./header";
import { Sidebar } from "./sidebar";

export type AppShellProps = {
  /**
   * The route segment directly below `app/(app)`, or `null` on the index
   * route. Passed in rather than read here so the frame stays renderable — and
   * therefore measurable — without a router around it.
   */
  readonly activeSegment: string | null;
  readonly company: ShellCompany;
  readonly user: ShellUser;
  /**
   * Every company this user holds an active membership in, ordered as the
   * access token hook orders memberships. Empty or single means the header
   * renders a plain label and no menu at all.
   */
  readonly companies?: readonly SwitchableCompany[];
  /** `app_metadata.tenant_id` — which of them the session is acting in. */
  readonly activeCompanyId?: string | null;
  /** Injected by the browser suite so a switch can be observed, not followed. */
  readonly onCompanySwitched?: () => void;
  readonly children: ReactNode;
};

/**
 * The frame every screen in the product renders inside.
 *
 * A flex row rather than the drawn `grid-template-columns: 236px minmax(0,1fr)`
 * — `w-59 shrink-0` beside `flex-1 min-w-0` measures identically and stays on
 * Tailwind's default scale, where the grid template would have needed an
 * arbitrary value. The measurement is what the design specifies; the mechanism
 * is not.
 *
 * `text-dense` sets the 13px base the designed screens run at. It is declared
 * once, here, so every screen inherits it rather than restating it.
 *
 * The frame is persistent in the literal sense: the sidebar is `sticky` at
 * full viewport height and the header is `sticky` at the top, so neither
 * scrolls away on a long screen. A "persistent frame" that leaves the viewport
 * as soon as there is content is just a header.
 */
export function AppShell({
  activeSegment,
  company,
  user,
  companies,
  activeCompanyId,
  onCompanySwitched,
  children,
}: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <AppTooltipProvider delay={0}>
      <div
        data-slot="app-shell"
        className="text-dense flex min-h-svh w-full flex-1"
      >
        {/*
          The first tab stop on every page. Without it a keyboard user crosses
          ten nav items, the theme toggle and the user block before reaching
          the content, on every navigation.

          Positioned off-screen by a transform rather than `sr-only`, because
          `sr-only` and the `focus:` reset that undoes it are different utility
          groups and their emitted order is not something to depend on. A
          transform is one property, and its state is measurable.
        */}
        <a
          data-slot="skip-link"
          href="#main-content"
          className="bg-card text-foreground focus:translate-y-0 motion-reduce:transition-none fixed top-2 left-2 z-50 -translate-y-20 rounded-md px-3 py-2 shadow-md transition-transform"
        >
          Skip to content
        </a>
        <Sidebar activeSegment={activeSegment} planLabel={company.planLabel} />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader
            activeSegment={activeSegment}
            company={company}
            user={user}
            companies={companies}
            activeCompanyId={activeCompanyId}
            onCompanySwitched={onCompanySwitched}
            drawerOpen={drawerOpen}
            onDrawerOpenChange={setDrawerOpen}
          />
          {/*
            Renders whether or not a screen has been built inside it. The
            placeholder routes this story ships are close to empty on purpose:
            the frame has to hold its own shape with nothing in it.
          */}
          {/*
            `tabIndex={-1}` is what makes the skip link land: without it the
            browser moves the scroll position but leaves focus where it was,
            and the next Tab returns to the navigation the user just skipped.
          */}
          <main
            id="main-content"
            tabIndex={-1}
            className="flex min-w-0 flex-1 flex-col gap-5 px-5 pt-5 pb-10 outline-none wide:px-7 wide:pt-6"
          >
            {children}
          </main>
        </div>
      </div>
    </AppTooltipProvider>
  );
}
