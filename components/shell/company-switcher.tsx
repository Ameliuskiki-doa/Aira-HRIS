"use client";

import { useMemo, useState, useTransition } from "react";
import { Menu } from "@base-ui/react/menu";
import {
  BuildingsIcon,
  CaretUpDownIcon,
  CheckIcon,
} from "@phosphor-icons/react/ssr";

import { cn } from "@/lib/utils";

import type { ShellCompany } from "./fixtures";

/** One entry in the panel. The shell needs no more of a membership than this. */
export type SwitchableCompany = {
  readonly companyId: string;
  readonly legalName: string;
};

export type CompanySwitcherProps = {
  readonly company: ShellCompany;
  /**
   * Every company the signed-in user holds an active membership in, ordered as
   * the access token hook orders memberships — so the first entry is the one
   * the current token carries.
   */
  readonly companies?: readonly SwitchableCompany[];
  /** The company the session is acting in, from `app_metadata.tenant_id`. */
  readonly activeCompanyId?: string | null;
  /**
   * What to do once the switch has been made and a new token issued.
   *
   * Defaults to the real behaviour — a full document navigation to the
   * dashboard root — and exists as a prop so the browser suite can observe
   * that it happened without navigating the test runner. It is not a fixture
   * seam: the default is what ships.
   */
  readonly onSwitched?: () => void;
};

/** Search only earns its place once the list stops fitting in one glance. */
const SEARCH_THRESHOLD = 7;

/** Where a session change lands. See the route handler for why it is the root. */
export const DASHBOARD_ROOT = "/";

/**
 * A **full document navigation**, not `router.push()`, and the difference is
 * the requirement rather than a preference.
 *
 * Switching company changes which tenant the session acts in. Everything the
 * client router is holding — the Router Cache, every prefetched segment, every
 * rendered screen — was produced under the OLD claim, and a soft navigation
 * keeps all of it. `router.refresh()` invalidates the cache, but only after
 * the fact and only for what it knows about. Leaving the document is the one
 * mechanism that cannot leave a fragment of the previous company behind, which
 * is exactly what "a deep link from the previous company must not survive"
 * asks for.
 *
 * Built as an absolute URL against the current origin because that is what it
 * is: a request to the server for the dashboard root, not an in-app route
 * transition.
 */
const navigateToDashboardRoot = () => {
  window.location.assign(new URL(DASHBOARD_ROOT, window.location.origin).toString());
};

/**
 * The company pill, and the panel behind it.
 *
 * **With one membership there is no menu** — no caret, no trigger, no
 * interaction, and deliberately not a disabled button either: a control that
 * cannot do anything is still announced as a control. A dropdown holding a
 * single item is noise, and most tenants are one PT. That is also what a
 * brand-new account looks like, so the label form is the common case rather
 * than the degenerate one.
 *
 * Above one membership it becomes a menu, and the interaction is a **session
 * change, not a filter**. Choosing a company writes `last_active_at` through
 * `switch_company()`, the server reissues the token — which re-runs the access
 * token hook and puts the new `tenant_id` in `app_metadata` — and the browser
 * lands on the dashboard root. The navigation is a full document load on
 * purpose: it drops the client router's cache along with everything rendered
 * under the old claim, so a deep link into the previous company cannot survive
 * the switch.
 *
 * **On failure it fails closed.** The panel stays open, says so, and nothing
 * navigates. It never silently falls back to the company it was already in,
 * because a header that says one company while the rows below it belong to
 * another is the single worst state this screen can reach.
 *
 * The branch count stays even when the name truncates — two similarly-named
 * PTs are told apart by their branch count, which makes it the last thing to
 * drop — but a count of zero is dropped entirely, because "0 branches" beside
 * a name reads as a defect rather than as information.
 */
export function CompanySwitcher({
  company,
  companies = [],
  activeCompanyId = null,
  onSwitched = navigateToDashboardRoot,
}: CompanySwitcherProps) {
  const [query, setQuery] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return companies;
    return companies.filter((entry) => entry.legalName.toLowerCase().includes(needle));
  }, [companies, query]);

  if (company.membershipCount <= 1) {
    return (
      <p
        data-slot="company-switcher"
        className="flex min-w-0 items-center gap-2 rounded-md px-2.5 py-1.25 shadow-sm"
      >
        <CompanyMark />
        <span className="truncate font-medium">{company.legalName}</span>
        <BranchCount count={company.branchCount} />
      </p>
    );
  }

  const choose = (companyId: string) => {
    if (companyId === activeCompanyId) return;
    setFailed(false);
    startTransition(async () => {
      try {
        const response = await fetch("/api/memberships/switch", {
          method: "POST",
          // `application/json` is not decoration: the boundary refuses anything
          // else, because a form-encoded post is how a cross-site request
          // reaches an endpoint without a preflight.
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ companyId }),
        });
        if (!response.ok) {
          setFailed(true);
          return;
        }
        onSwitched();
      } catch {
        setFailed(true);
      }
    });
  };

  return (
    <Menu.Root>
      <Menu.Trigger
        data-slot="company-switcher"
        disabled={pending}
        className="focus-visible:ring-ring flex min-w-0 items-center gap-2 rounded-md px-2.5 py-1.25 shadow-sm hover:bg-ui-hover focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-60"
      >
        <CompanyMark />
        <span className="truncate font-medium">{company.legalName}</span>
        <BranchCount count={company.branchCount} />
        <CaretUpDownIcon
          aria-hidden="true"
          data-slot="company-switcher-caret"
          className="text-ui-muted size-3.5 shrink-0"
        />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="start" side="bottom" sideOffset={6}>
          <Menu.Popup
            data-slot="company-switcher-panel"
            // A switch is a session change and takes a round trip plus a token
            // reissue. `aria-busy` is what says so to a screen reader, since
            // there is nothing visual left to change once the panel stops
            // closing on click.
            aria-busy={pending || undefined}
            className="bg-card border-border z-40 flex max-h-80 w-64 flex-col overflow-hidden rounded-md border py-1 shadow-lg outline-none"
          >
            {companies.length > SEARCH_THRESHOLD && (
              <div className="border-border border-b px-2 pb-1.5">
                <input
                  data-slot="company-switcher-search"
                  type="search"
                  // An icon-only control needs a name; so does an input with
                  // no visible label above it.
                  aria-label="Search companies"
                  placeholder="Search companies"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  // Base UI menus type-ahead on keypress, which would steal
                  // every character typed here.
                  onKeyDown={(event) => event.stopPropagation()}
                  className="focus-visible:ring-ring w-full rounded-sm bg-transparent px-1.5 py-1 outline-none focus-visible:ring-2"
                />
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {visible.map((entry) => {
                const current = entry.companyId === activeCompanyId;
                return (
                  <Menu.Item
                    key={entry.companyId}
                    data-slot="company-switcher-item"
                    data-current={current || undefined}
                    // The panel stays open. Closing on click looks decisive
                    // and is wrong twice over: on success the page is about to
                    // be replaced anyway, so the close buys nothing; on
                    // failure the panel is the only place the failure can be
                    // said, and a menu that shuts on a refused switch reports
                    // it as a switch.
                    closeOnClick={false}
                    onClick={() => choose(entry.companyId)}
                    className={cn(
                      "flex w-full min-w-0 cursor-default items-center gap-2 px-2.5 py-1.5 text-left outline-none",
                      "data-highlighted:bg-ui-hover",
                      current && "bg-ui-active-bg text-ui-active-fg",
                    )}
                  >
                    <span className="truncate">{entry.legalName}</span>
                    {current && (
                      <CheckIcon
                        aria-hidden="true"
                        data-slot="company-switcher-current"
                        className="ml-auto size-3.5 shrink-0"
                      />
                    )}
                  </Menu.Item>
                );
              })}
              {visible.length === 0 && (
                <p data-slot="company-switcher-empty" className="text-ui-muted px-2.5 py-2">
                  No company matches that.
                </p>
              )}
            </div>
            {failed && (
              // Fails closed, and says so. Nothing navigated, the session is
              // still in the company it was in, and the caller is told rather
              // than left to infer it from a header that did not change.
              <p
                data-slot="company-switcher-error"
                role="alert"
                className="text-destructive border-border border-t px-2.5 py-2"
              >
                We could not switch company. You are still in {company.legalName}.
              </p>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

const CompanyMark = () => (
  <BuildingsIcon aria-hidden="true" className="text-brand size-3.5 shrink-0" />
);

const BranchCount = ({ count }: { readonly count: number }) =>
  count > 0 ? (
    <span data-slot="branch-count" className="text-2xs text-ui-muted shrink-0">
      {count} {count === 1 ? "branch" : "branches"}
    </span>
  ) : null;
