"use client";

import { Separator } from "@/components/ui/separator";

import { CompanySwitcher, type SwitchableCompany } from "./company-switcher";
import type { ShellCompany, ShellUser } from "./fixtures";
import { HeaderDate } from "./header-date";
import { NavDrawer } from "./nav-drawer";
import { ThemeToggle } from "./theme-toggle";
import { UserBlock } from "./user-block";

export type AppHeaderProps = {
  readonly activeSegment: string | null;
  readonly company: ShellCompany;
  readonly user: ShellUser;
  /** Every company this user may switch into. Empty for a single membership. */
  readonly companies?: readonly SwitchableCompany[];
  /** `app_metadata.tenant_id` — which of them the session is acting in. */
  readonly activeCompanyId?: string | null;
  /** Injected by the browser suite so a switch can be observed, not followed. */
  readonly onCompanySwitched?: () => void;
  readonly drawerOpen: boolean;
  readonly onDrawerOpenChange: (open: boolean) => void;
};

/**
 * The header, and the order in which it gives things up.
 *
 *   < 1200px  the date and timezone go. Context, not function.
 *   < 768px   the user's name and role go, leaving the avatar; the drawer
 *             trigger appears on the left; the company name truncates but
 *             keeps its branch count.
 *
 * The range segmented control and the notification bell are still deliberately
 * absent — they belong to the dashboard screen, and a control that does
 * nothing is worse than no control. The switcher panel arrived with Story 1.6,
 * and only ever renders as a menu when there is more than one company to
 * choose between.
 */
export function AppHeader({
  activeSegment,
  company,
  user,
  companies,
  activeCompanyId,
  onCompanySwitched,
  drawerOpen,
  onDrawerOpenChange,
}: AppHeaderProps) {
  return (
    <header
      data-slot="app-header"
      className="bg-card border-border sticky top-0 z-30 flex shrink-0 items-center gap-3 border-b px-5 py-3.5 wide:px-7"
    >
      <NavDrawer
        activeSegment={activeSegment}
        planLabel={company.planLabel}
        open={drawerOpen}
        onOpenChange={onDrawerOpenChange}
      />
      <CompanySwitcher
        company={company}
        companies={companies}
        activeCompanyId={activeCompanyId}
        onSwitched={onCompanySwitched}
      />
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <HeaderDate timeZone={company.timeZone} />
        <ThemeToggle />
        <Separator
          orientation="vertical"
          className="hidden h-7 self-center md:block"
        />
        <UserBlock user={user} />
      </div>
    </header>
  );
}
