/**
 * The application shell, measured.
 *
 * Every assertion in this file is a number the browser had to compute or a
 * name the accessibility tree had to resolve. None is a class string. That is
 * deliberate and it is the lesson of Stories 1.1 and 1.2: a suite that asserts
 * `toContain("w-59")` passes when the utility is renamed, passes when a later
 * rule overrides it, passes when the element is `display: none`, and fails the
 * day someone reorders a `cn()` call. It enumerates the implementation instead
 * of checking the requirement. `getBoundingClientRect()` and a resolved
 * `getComputedStyle` cannot be fooled that way — 236 is 236 or it is not.
 *
 * Two habits this file keeps, both learned from things that were silently
 * green before:
 *
 *   - **Test at the boundary, not inside the region.** `BANDS` samples both
 *     sides of every breakpoint, because a media query written `>= 769` passes
 *     every interior width there is.
 *   - **Never let a parser fall back to "fine".** `alphaOf` and `rgbOf` throw
 *     on a notation they cannot read. The first version of `alphaOf` returned
 *     1, and a backdrop reverted to 10% black sailed through.
 */

// First import, and it has to stay first: `next/link` reaches for
// `process.env.__NEXT_ROUTER_BASEPATH` at module scope, and there is no
// `process` in a browser. ES modules evaluate in import order, so this shim
// runs before the link module body does.
import "./next-env-shim";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { LayoutRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import AppLayout from "@/app/(app)/layout";
import {
  DARK_CLASS,
  THEME_SCRIPT,
  THEME_STORAGE_KEY,
  toggleTheme,
  type Theme,
} from "@/app/theme-script";
import { AppShell } from "@/components/shell/app-shell";
import {
  SHELL_COMPANY_FIXTURE,
  SHELL_USER_FIXTURE,
} from "@/components/shell/fixtures";
import { NAV_ITEMS } from "@/components/shell/navigation";
import {
  formatCompanyDate,
  INDONESIAN_TIME_ZONES,
  zoneLabel,
} from "@/components/shell/timezone";

// The application's real stylesheet, compiled by the same Tailwind pipeline the
// build uses. Without it every measurement below would be the browser's
// default box rather than the shell's.
import "../../app/globals.css";

/** Every placeholder route, as modules — so they can be rendered, not grepped. */
type PageModule = { default: () => React.ReactNode };
const PAGE_MODULES = import.meta.glob("../../app/\\(app\\)/**/page.tsx") as Record<
  string,
  () => Promise<PageModule>
>;

const SIDEBAR_PX = 236;
const RAIL_PX = 64;
const TOUCH_MIN_PX = 44;

/* ── the bands ─────────────────────────────────────────────────────────────
 * One row per rule in the responsive table, expressed as measurements, and
 * sampled on *both sides* of all three boundaries. Interior widths alone
 * cannot tell 768 from 769.
 */
type Band = {
  readonly width: number;
  /** Measured width of the persistent sidebar; 0 when it is not rendered. */
  readonly sidebarWidth: number;
  /** Whether nav labels are on screen in the sidebar. */
  readonly labelsVisible: boolean;
  /** Whether the brand wordmark and plan line survive in the sidebar. */
  readonly wordmarkVisible: boolean;
  /** Whether the four group headings survive in the sidebar. */
  readonly groupHeadingsVisible: boolean;
  /** Minimum height every nav item must reach. */
  readonly itemMinHeight: number;
  /** Whether the off-canvas trigger is in the header. */
  readonly drawerTrigger: boolean;
  /** Whether the date/timezone line survives. */
  readonly headerDate: boolean;
  /** Inline padding of `<main>`, in px. */
  readonly contentPadding: number;
};

const DRAWER_BAND = {
  sidebarWidth: 0,
  labelsVisible: false,
  wordmarkVisible: false,
  groupHeadingsVisible: false,
  itemMinHeight: 0,
  drawerTrigger: true,
  headerDate: false,
  contentPadding: 20,
} as const;

const RAIL_BAND = {
  sidebarWidth: RAIL_PX,
  labelsVisible: false,
  wordmarkVisible: false,
  groupHeadingsVisible: false,
  itemMinHeight: TOUCH_MIN_PX,
  drawerTrigger: false,
  headerDate: false,
  contentPadding: 20,
} as const;

const SIDEBAR_BAND = {
  sidebarWidth: SIDEBAR_PX,
  labelsVisible: true,
  wordmarkVisible: true,
  groupHeadingsVisible: true,
  itemMinHeight: 0,
  drawerTrigger: false,
  headerDate: true,
  contentPadding: 20,
} as const;

const BANDS: readonly Band[] = [
  { width: 375, ...DRAWER_BAND },
  { width: 767, ...DRAWER_BAND }, // one below the drawer/rail boundary
  { width: 768, ...RAIL_BAND }, // the boundary itself
  { width: 800, ...RAIL_BAND },
  { width: 1024, ...RAIL_BAND }, // not a boundary; the comment that said so was wrong
  { width: 1199, ...RAIL_BAND }, // one below the rail/sidebar boundary
  { width: 1200, ...SIDEBAR_BAND }, // the boundary itself
  { width: 1280, ...SIDEBAR_BAND },
  { width: 1439, ...SIDEBAR_BAND }, // one below the wide boundary
  { width: 1440, ...SIDEBAR_BAND, contentPadding: 28 },
];

/** The pairs that make the sampling a boundary test rather than a spot check. */
const BOUNDARY_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [767, 768],
  [1199, 1200],
  [1439, 1440],
];

/* ── helpers ──────────────────────────────────────────────────────────────── */

function renderShell(activeSegment: string | null = null, empty = false) {
  return render(
    <AppShell
      activeSegment={activeSegment}
      company={SHELL_COMPANY_FIXTURE}
      user={SHELL_USER_FIXTURE}
    >
      {empty ? null : <p>Isi halaman</p>}
    </AppShell>,
  );
}

/**
 * A `FlightRouterState` for one route below `app/(app)`, shaped the way the
 * real router shapes it. `__PAGE__` is the index route, which is what makes
 * `useSelectedLayoutSegment()` return `null` there.
 */
function routerTree(segment: string) {
  return ["(app)", { children: [segment, { children: ["__PAGE__", {}] }] }];
}

/**
 * The layout as the router mounts it, with the *real* hook reading a real
 * context — not a stub segment handed to `AppShell`.
 *
 * This is the hop the rest of the file cannot see. `AppShell` takes
 * `activeSegment` as a value, so every case below proves the binding from that
 * value to `aria-current` and none of them proves that anything computes the
 * value. Hardcoding `activeSegment={null}` in the adapter, or deleting
 * `app/(app)/layout.tsx` outright, was green across the whole suite.
 */
function renderRoute(segment: string) {
  return render(
    <LayoutRouterContext.Provider
      value={{ parentTree: routerTree(segment) } as never}
    >
      {/* The generated `LayoutProps<"/">` requires `params`; "/" has none. */}
      <AppLayout params={Promise.resolve({})}>
        <p>Isi halaman</p>
      </AppLayout>
    </LayoutRouterContext.Provider>,
  );
}

function slot(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-slot="${name}"]`);
}

function requireSlot(name: string): HTMLElement {
  const found = slot(name);
  if (found === null) throw new Error(`no element with data-slot="${name}"`);
  return found;
}

/** Width of an element's border box, 0 when it is not laid out at all. */
function widthOf(element: Element | null): number {
  return element === null ? 0 : element.getBoundingClientRect().width;
}

function isOnScreen(element: Element | null): boolean {
  return widthOf(element) > 2;
}

/**
 * A custom property's value as the browser resolves it, normalised to the same
 * `rgb(...)` form `getComputedStyle().color` reports.
 *
 * Comparing against the raw token text would not work: `--ui-active-bg` is
 * declared as `var(--color-accent-200)`, and what an element paints is the
 * substituted colour. Painting it on a probe element is the only way to make
 * the two comparable, and it is what makes these assertions survive the ramp
 * being retuned — they check that the shell reads the token, not that the
 * token holds a particular hex.
 */
function resolvedToken(name: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  document.body.appendChild(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
}

/**
 * The alpha channel of a resolved colour.
 *
 * Throws on a notation it does not understand, and that is the whole point.
 * The first version returned 1 for anything unparsed, which meant a backdrop
 * reverted to 10% black satisfied `> 0.3` — the exact regression the helper
 * was written to catch, defeated by its own fallback. Chromium reports a
 * Tailwind opacity modifier as `oklab(… / 0.1)`, not as `rgba(…, 0.1)`.
 */
function alphaOf(colour: string): number {
  const slashed = /\/\s*([\d.]+)(%?)\s*\)/.exec(colour);
  if (slashed !== null) {
    const value = Number.parseFloat(slashed[1]);
    return slashed[2] === "%" ? value / 100 : value;
  }
  const functional = /^rgba?\(([^)]*)\)$/.exec(colour);
  if (functional !== null) {
    const parts = functional[1].split(/[,\s]+/).filter(Boolean);
    return parts.length > 3 ? Number.parseFloat(parts[3]) : 1;
  }
  if (colour === "transparent" || colour === "rgba(0, 0, 0, 0)") return 0;
  throw new Error(`alphaOf cannot read "${colour}"`);
}

/** An opaque colour's channels. Throws rather than guessing — see `alphaOf`. */
function rgbOf(colour: string): [number, number, number] {
  const functional = /^rgba?\(([^)]*)\)$/.exec(colour);
  if (functional === null) throw new Error(`rgbOf cannot read "${colour}"`);
  const parts = functional[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  if (parts.length > 3 && parts[3] !== 1) {
    throw new Error(`rgbOf needs an opaque colour, got "${colour}"`);
  }
  return [parts[0], parts[1], parts[2]];
}

/** WCAG 2.x relative luminance. */
function relativeLuminance(colour: string): number {
  const [r, g, b] = rgbOf(colour).map((channel) => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1:1 to 21:1. */
function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

/** The first opaque background behind an element — what its text sits on. */
function effectiveBackground(element: HTMLElement): string {
  let node: HTMLElement | null = element;
  while (node !== null) {
    const colour = getComputedStyle(node).backgroundColor;
    if (alphaOf(colour) === 1) return colour;
    node = node.parentElement;
  }
  throw new Error("no opaque background behind the element");
}

/** Run the blocking boot script exactly as `<head>` runs it on a real load. */
function runBootScript(): void {
  const element = document.createElement("script");
  element.textContent = THEME_SCRIPT;
  document.head.appendChild(element);
  element.remove();
}

function documentTheme(): Theme {
  return document.documentElement.classList.contains(DARK_CLASS)
    ? "dark"
    : "light";
}

function setTheme(theme: Theme): void {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  runBootScript();
}

/** Every element inside `root` that carries its own text node. */
function textCarryingElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("*")).filter((element) =>
    Array.from(element.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
    ),
  );
}

afterEach(() => {
  cleanup();
  localStorage.removeItem(THEME_STORAGE_KEY);
  document.documentElement.classList.add(DARK_CLASS);
  document.documentElement.style.colorScheme = "dark";
  window.scrollTo(0, 0);
});

beforeEach(async () => {
  await page.viewport(1440, 900);
  document.documentElement.classList.add(DARK_CLASS);
  document.documentElement.style.colorScheme = "dark";
});

beforeAll(() => {
  // A real anchor click navigates the test iframe out from under the runner,
  // and `next/link` only calls `preventDefault()` once a router is in context
  // — there is none here. Stopping the default in the capture phase leaves the
  // component's own `onClick` untouched, which is exactly what the
  // close-on-navigation case needs to observe.
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest("a[href]")) {
        event.preventDefault();
      }
    },
    true,
  );
});

/* ── the helpers, checked against known answers ───────────────────────────── */

describe("the measurement helpers", () => {
  it("computes contrast ratios that match the published arithmetic", () => {
    expect(contrastRatio("rgb(0, 0, 0)", "rgb(255, 255, 255)")).toBeCloseTo(21, 5);
    expect(contrastRatio("rgb(255, 255, 255)", "rgb(255, 255, 255)")).toBeCloseTo(1, 5);
    // WCAG's own worked example: #777 on white is 4.48:1 — just under AA, which
    // is what makes it a useful check that the threshold is not being rounded
    // into place.
    expect(contrastRatio("rgb(119, 119, 119)", "rgb(255, 255, 255)")).toBeCloseTo(
      4.48,
      2,
    );
  });

  it("refuses colours it cannot read rather than reporting a safe number", () => {
    expect(() => alphaOf("color(display-p3 1 0 0)")).toThrow();
    expect(() => rgbOf("oklab(0.5 0 0 / 0.5)")).toThrow();
    expect(alphaOf("oklab(0.5 0 0 / 0.4)")).toBeCloseTo(0.4, 5);
    expect(alphaOf("rgb(1, 2, 3)")).toBe(1);
  });
});

/* ── the navigation definition ────────────────────────────────────────────── */

/**
 * The nav, written out.
 *
 * Not derived from `NAV_GROUPS` — deriving it would make deleting an item
 * invisible, because the expectation would shrink with the thing it checks.
 * This is the one enumeration in the file, and it is enumerating the product
 * decision (which destinations exist) rather than the implementation.
 */
const EXPECTED_NAV: ReadonlyArray<readonly [string, string, string | null]> = [
  ["Dashboard", "/", null],
  ["Reports", "/reports", "reports"],
  ["Employees", "/employees", "employees"],
  ["Attendance", "/attendance", "attendance"],
  ["Leave", "/leave", "leave"],
  ["Shift Schedule", "/shifts", "shifts"],
  ["Run Payroll", "/payroll", "payroll"],
  ["Approvals", "/approvals", "approvals"],
  ["Configuration", "/configuration", "configuration"],
  ["Subscription", "/subscription", "subscription"],
];

/** Where a nav item's stub route lives, as `import.meta.glob` keys it. */
function pageModuleKey(segment: string | null): string {
  return segment === null
    ? "../../app/(app)/page.tsx"
    : `../../app/(app)/${segment}/page.tsx`;
}

describe("the navigation is one definition", () => {
  it("holds exactly the destinations the design specifies", () => {
    expect(
      NAV_ITEMS.map((item) => [item.label, item.href, item.segment]),
    ).toEqual(EXPECTED_NAV.map((entry) => [...entry]));
  });

  it("has one stub route per destination, and no route without one", () => {
    // Set equality in both directions. A missing route breaks navigation; an
    // orphan route is a destination with no way to reach it.
    expect(Object.keys(PAGE_MODULES).sort()).toEqual(
      EXPECTED_NAV.map(([, , segment]) => pageModuleKey(segment)).sort(),
    );
  });

  it("renders every one of those routes without throwing", async () => {
    for (const [label, , segment] of EXPECTED_NAV) {
      const load = PAGE_MODULES[pageModuleKey(segment)];
      expect(load, `${label} has no page module`).toBeDefined();
      const Page = (await load()).default;
      cleanup();
      // Rendered, not grepped. The previous version read the file and checked
      // it contained "export default", which a page that throws on render
      // satisfies completely.
      render(<Page />);
      expect(document.body.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });

  it("renders every one of them, once, as a link to its href", () => {
    renderShell();
    const nav = requireSlot("nav-list");
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(EXPECTED_NAV.length);
    for (const [label, href] of EXPECTED_NAV) {
      const link = within(nav).getByRole("link", { name: label });
      expect(link.getAttribute("href")).toBe(href);
    }
  });
});

/* ── active state ─────────────────────────────────────────────────────────── */

describe("the active item", () => {
  it("is the one the route selects, and is the only one, for every route", () => {
    for (const [label, , segment] of EXPECTED_NAV) {
      cleanup();
      renderShell(segment);
      const nav = requireSlot("nav-list");
      const current = within(nav).getAllByRole("link", { current: "page" });
      expect(current, `${label}: expected exactly one current item`).toHaveLength(1);
      expect(current[0]).toHaveAccessibleName(label);
    }
  });

  it("is computed from the router, not handed in — through the real layout", () => {
    for (const [label, , segment] of EXPECTED_NAV) {
      cleanup();
      // `__PAGE__` is how the router spells the index route; the hook turns it
      // into `null`, which is the value the nav's `Dashboard` entry carries.
      renderRoute(segment ?? "__PAGE__");
      const nav = requireSlot("nav-list");
      const current = within(nav).getAllByRole("link", { current: "page" });
      expect(current, `${label}: expected exactly one current item`).toHaveLength(1);
      expect(current[0]).toHaveAccessibleName(label);
    }
  });

  it("takes the active tokens and keeps its inset ring", () => {
    renderShell("employees");
    const active = within(requireSlot("nav-list")).getByRole("link", {
      current: "page",
    });
    const style = getComputedStyle(active);

    expect(style.backgroundColor).toBe(resolvedToken("--ui-active-bg"));
    expect(style.color).toBe(resolvedToken("--ui-active-fg"));
    // In the rail the ring is the only cue that anything is selected, so its
    // absence is a real defect rather than a styling nicety. `inset` and `1px`
    // together: a ring drawn outside the box, or three pixels wide, is not it.
    expect(style.boxShadow).toMatch(/inset/);
    expect(style.boxShadow).toMatch(/0px 0px 0px 1px inset/);
  });

  it("keeps the design system's focus ring on a keyboard-focused item", async () => {
    renderShell();
    await userEvent.keyboard("{Tab}{Tab}");
    const focused = document.activeElement as HTMLElement;
    expect(focused).toHaveAccessibleName("Dashboard");
    const style = getComputedStyle(focused);
    // The rule is the design system's: 2px at 2px offset, never removed from a
    // row that gains hover styling.
    expect(style.outlineStyle).toBe("solid");
    expect(Number.parseFloat(style.outlineWidth)).toBe(2);
    expect(Number.parseFloat(style.outlineOffset)).toBe(2);
  });
});

/* ── responsive bands ─────────────────────────────────────────────────────── */

describe("responsive bands", () => {
  it("samples both sides of every boundary", () => {
    // The loops below iterate BANDS. An empty or truncated list would make
    // every one of them vacuously true — and a list of interior widths only
    // would pass a media query written one pixel off.
    expect(BANDS).toHaveLength(10);
    const widths = BANDS.map((band) => band.width);
    for (const [below, at] of BOUNDARY_PAIRS) {
      expect(widths, `no sample below ${at}px`).toContain(below);
      expect(widths, `no sample at ${at}px`).toContain(at);
      const under = BANDS.find((b) => b.width === below)!;
      const over = BANDS.find((b) => b.width === at)!;
      // The pair has to actually straddle something, or it is two samples of
      // one band wearing the costume of a boundary test.
      expect(
        JSON.stringify(under) !== JSON.stringify(over),
        `${below}px and ${at}px expect identical layout — that is not a boundary`,
      ).toBe(true);
    }
  });

  for (const band of BANDS) {
    describe(`at ${band.width}px`, () => {
      it("lays the frame out as this band's rule requires", async () => {
        renderShell("employees");
        await page.viewport(band.width, 900);

        expect(widthOf(slot("sidebar"))).toBe(band.sidebarWidth);

        const main = document.querySelector("main");
        expect(main).not.toBeNull();
        expect(getComputedStyle(main!).paddingLeft).toBe(
          `${band.contentPadding}px`,
        );

        // The header's degradation order, as two independent facts.
        expect(isOnScreen(slot("header-date"))).toBe(band.headerDate);
        expect(isOnScreen(slot("nav-drawer-trigger"))).toBe(band.drawerTrigger);

        // The page itself never scrolls sideways, at any width.
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
          band.width,
        );
      });

      it("collapses the sidebar's own chrome with it", async () => {
        renderShell("employees");
        await page.viewport(band.width, 900);
        const sidebar = slot("sidebar");

        // Everything inside the 64px rail has to fit inside 64px. The nav
        // item's label is not the only thing that would overflow it: the brand
        // wordmark and the four group headings each have their own rule, and
        // each was removable without a single case going red.
        const wordmark =
          sidebar?.querySelector<HTMLElement>('[data-slot="brand-wordmark"]') ??
          null;
        expect(isOnScreen(wordmark)).toBe(band.wordmarkVisible);

        const headings = Array.from(
          sidebar?.querySelectorAll<HTMLElement>('[data-slot="nav-group-heading"]') ??
            [],
        );
        if (band.sidebarWidth > 0) expect(headings).toHaveLength(4);
        for (const heading of headings) {
          expect(isOnScreen(heading)).toBe(band.groupHeadingsVisible);
        }

        if (sidebar !== null && band.sidebarWidth > 0) {
          const box = sidebar.getBoundingClientRect();
          for (const child of sidebar.querySelectorAll("*")) {
            const rect = child.getBoundingClientRect();
            if (rect.width === 0) continue;
            expect(
              rect.right,
              `${child.textContent?.trim()} overflows the sidebar at ${band.width}px`,
            ).toBeLessThanOrEqual(box.right + 0.5);
          }
        }
      });

      if (band.sidebarWidth > 0) {
        it("draws its nav items at the height and labelling this band calls for", async () => {
          renderShell("employees");
          await page.viewport(band.width, 900);
          const nav = requireSlot("nav-list");

          for (const [label] of EXPECTED_NAV) {
            const link = within(nav).getByRole("link", { name: label });
            const rect = link.getBoundingClientRect();
            expect(rect.height, `${label} at ${band.width}px`).toBeGreaterThan(0);
            expect(
              rect.height,
              `${label} is below the touch minimum at ${band.width}px`,
            ).toBeGreaterThanOrEqual(band.itemMinHeight);

            // The label is hidden from the eye in the rail and from nobody
            // else: the accessible name is the label in both bands, which is
            // what stops the rail from becoming ten unnamed icons.
            expect(
              isOnScreen(link.querySelector("span")),
              `${label} label visibility at ${band.width}px`,
            ).toBe(band.labelsVisible);
            expect(link).toHaveAccessibleName(label);
          }
        });
      }

      it("never exposes two navigation landmarks at once", async () => {
        renderShell();
        await page.viewport(band.width, 900);
        // Below 768px the sidebar is `display: none`, so its `<nav>` leaves the
        // accessibility tree entirely — there is no landmark until the drawer
        // opens, and then exactly one. Two `<nav>`s sharing the name "Main navigation
        // utama" is the failure this pins against; the drawer suite asserts the
        // open case.
        expect(screen.queryAllByRole("navigation")).toHaveLength(
          band.sidebarWidth > 0 ? 1 : 0,
        );
      });
    });
  }
});

/* ── the persistent frame ─────────────────────────────────────────────────── */

describe("the frame stays put", () => {
  it("pins the sidebar and the header through a long scroll", async () => {
    render(
      <AppShell
        activeSegment={null}
        company={SHELL_COMPANY_FIXTURE}
        user={SHELL_USER_FIXTURE}
      >
        <div style={{ height: "4000px" }}>Isi panjang</div>
      </AppShell>,
    );
    await page.viewport(1440, 700);

    const sidebar = requireSlot("sidebar");
    const header = requireSlot("app-header");
    expect(document.documentElement.scrollHeight).toBeGreaterThan(2000);

    window.scrollTo(0, 1500);
    await vi.waitFor(() => expect(window.scrollY).toBeGreaterThan(1000));

    // A "persistent frame" that leaves the viewport as soon as there is
    // content is a header, not a frame.
    expect(header.getBoundingClientRect().top).toBeCloseTo(0, 0);
    expect(sidebar.getBoundingClientRect().top).toBeCloseTo(0, 0);
    expect(sidebar.getBoundingClientRect().height).toBeCloseTo(700, 0);
  });

  it("puts a skip link ahead of the navigation and lands it on <main>", async () => {
    renderShell();
    const link = requireSlot("skip-link");
    expect(link).toHaveAccessibleName("Skip to content");

    // Off screen until it is needed.
    expect(link.getBoundingClientRect().bottom).toBeLessThan(0);

    // First tab stop on the page — before ten nav items, the toggle and the
    // user block, which is the whole point of it.
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement).toBe(link);
    await vi.waitFor(() =>
      expect(link.getBoundingClientRect().top).toBeGreaterThanOrEqual(0),
    );

    const main = document.querySelector("main")!;
    expect(link.getAttribute("href")).toBe(`#${main.id}`);
    expect(main.id).toBeTruthy();
    // Without a focusable target the browser scrolls but leaves focus behind,
    // and the next Tab returns to the navigation the user just skipped.
    expect(main.getAttribute("tabindex")).toBe("-1");
  });
});

/* ── the type scale ───────────────────────────────────────────────────────── */

describe("the dense type scale", () => {
  it("resolves each step to the size the design specifies", async () => {
    renderShell();
    await page.viewport(1440, 900);

    const sizeOf = (name: string) =>
      Number.parseFloat(getComputedStyle(requireSlot(name)).fontSize);

    // The shell's 13px base, which every screen inherits.
    expect(sizeOf("app-shell")).toBe(13);
    // The three chrome steps below Tailwind's floor. Collapsing any two onto
    // `text-xs` — or moving the base to 16px — was green before this case.
    expect(sizeOf("branch-count")).toBe(11);
    expect(sizeOf("user-role")).toBe(10);
    expect(sizeOf("nav-group-heading")).toBe(9);
    expect(sizeOf("brand-plan")).toBe(9);
    // And they are four distinct steps, not one value repeated.
    expect(new Set([13, 11, 10, 9]).size).toBe(4);
  });
});

/* ── the rail's tooltip ───────────────────────────────────────────────────── */

describe("the rail's tooltip", () => {
  it("appears on keyboard focus alone, not only on hover", async () => {
    renderShell();
    await page.viewport(1024, 900);

    // Tab, not `.focus()`. Base UI opens a tooltip on `:focus-visible`, and a
    // programmatic focus is not focus-visible — a test that called `.focus()`
    // would pass against a component that only ever opened on hover, which is
    // precisely the keyboard user this rule exists for. Two tabs: the skip
    // link is first.
    await userEvent.keyboard("{Tab}{Tab}");
    const first = document.activeElement as HTMLElement;
    expect(first).toHaveAccessibleName("Dashboard");

    const tip = await vi.waitUntil(() => slot("app-tooltip-content"));
    expect(tip).toHaveTextContent("Dashboard");
    const tipBox = tip.getBoundingClientRect();
    expect(tipBox.height).toBeGreaterThan(0);
    expect(tipBox.width).toBeGreaterThan(0);
    // Beside the icon rather than over it — a tooltip covering the item it
    // explains is worse than none.
    expect(tipBox.left).toBeGreaterThan(first.getBoundingClientRect().left);
  });

  it("wears the design system's surface, not the generated inverted chip", async () => {
    renderShell();
    await page.viewport(1024, 900);
    await userEvent.keyboard("{Tab}{Tab}");
    const tip = await vi.waitUntil(() => slot("app-tooltip-content"));

    // The wrapper layer exists for exactly this. Replacing
    // `components/app/tooltip.tsx` with a pass-through reverts the rail's
    // labels to `bg-foreground` / `text-background` — a light chip on a dark
    // sidebar — and every other case in this file stayed green.
    const style = getComputedStyle(tip);
    expect(style.backgroundColor).toBe(resolvedToken("--color-surface"));
    expect(style.color).toBe(resolvedToken("--color-text"));
    // The arrow is a child of the popup and carries its own colour; the
    // wrapper has to reach it too or a light dart hangs off a dark tooltip.
    const arrow = tip.querySelector<HTMLElement>("[data-align]");
    expect(arrow).not.toBeNull();
    expect(getComputedStyle(arrow!).backgroundColor).toBe(
      resolvedToken("--color-surface"),
    );
  });

  it("retires in the sidebar band, where the label is already on screen", async () => {
    renderShell();
    await page.viewport(1440, 900);

    await userEvent.keyboard("{Tab}{Tab}");
    expect(document.activeElement).toHaveAccessibleName("Dashboard");

    await vi.waitFor(() => {
      const tip = slot("app-tooltip-content");
      // Either never opened, or opened with no box. Both are "not on screen";
      // a visible duplicate of a visible label is not.
      expect(tip === null || tip.getBoundingClientRect().height === 0).toBe(true);
    });
  });
});

/* ── the drawer ───────────────────────────────────────────────────────────── */

async function openDrawer(): Promise<{
  trigger: HTMLElement;
  panel: HTMLElement;
}> {
  const trigger = requireSlot("nav-drawer-trigger");
  await userEvent.click(trigger);
  const panel = await vi.waitUntil(() => slot("app-drawer-panel"));
  return { trigger, panel };
}

describe("the off-canvas drawer", () => {
  beforeEach(async () => {
    await page.viewport(375, 720);
  });

  it("opens to the specified width with its labels at the touch minimum", async () => {
    renderShell("leave");
    const { panel } = await openDrawer();

    expect(panel.getBoundingClientRect().width).toBe(SIDEBAR_PX);

    const nav = within(panel).getByRole("navigation");
    for (const [label] of EXPECTED_NAV) {
      const link = within(nav).getByRole("link", { name: label });
      expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(
        TOUCH_MIN_PX,
      );
      // Labels are on screen here, unlike the rail — there is room, and no
      // tooltip to fall back on.
      expect(isOnScreen(link.querySelector("span"))).toBe(true);
    }

    // Still exactly one active item, and it is the one for this route.
    const current = within(nav).getAllByRole("link", { current: "page" });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName("Leave");

    // And still exactly one navigation landmark: the sidebar's is
    // `display: none` at this width, so the two never compete.
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
  });

  it("traps focus: Tab past the last item comes back round, never to <body>", async () => {
    renderShell();
    const { panel } = await openDrawer();

    const visited: Element[] = [];
    // More presses than the panel has stops, so a full wrap has to happen.
    for (let i = 0; i < 16; i += 1) {
      await userEvent.keyboard("{Tab}");
      const active = document.activeElement;
      // Read once, synchronously. A retrying assertion would accept focus that
      // escapes to <body> and is pulled back a few milliseconds later, which
      // is the failure this case exists to catch.
      expect(active, `focus reached <body> on Tab #${i + 1}`).not.toBe(
        document.body,
      );
      expect(panel.contains(active), `focus left the panel on Tab #${i + 1}`).toBe(
        true,
      );
      visited.push(active as Element);
    }

    // "Never left" is also true of focus that never moved. These say it cycled.
    const distinct = new Set(visited);
    expect(distinct.size).toBeGreaterThanOrEqual(3);
    expect(distinct.size).toBeLessThan(visited.length);
  });

  it("closes on Esc and gives focus back to the trigger", async () => {
    renderShell();
    const { trigger } = await openDrawer();

    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(slot("app-drawer-panel")).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("closes on a backdrop press and gives focus back to the trigger", async () => {
    renderShell();
    const { trigger } = await openDrawer();

    const backdrop = requireSlot("app-drawer-overlay");
    // The backdrop has to be a real, dimmed surface as well as a click target:
    // the generated primitive paints it at 10% black, which over #161826 is
    // invisible and leaves the page looking broken rather than dimmed. The
    // design calls for neutral-900 at 50%.
    expect(alphaOf(getComputedStyle(backdrop).backgroundColor)).toBeGreaterThan(
      0.3,
    );

    // Deliberately off to the right. The backdrop spans the viewport, so its
    // centre sits *behind the panel* — a default click there lands on a nav
    // item and would prove the opposite of what this case is for.
    const box = backdrop.getBoundingClientRect();
    await userEvent.click(backdrop, {
      position: { x: box.width - 20, y: box.height / 2 },
    });
    await vi.waitFor(() => expect(slot("app-drawer-panel")).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("closes when a destination is followed", async () => {
    renderShell();
    const { panel } = await openDrawer();

    await userEvent.click(within(panel).getByRole("link", { name: "Attendance" }));
    await vi.waitFor(() => expect(slot("app-drawer-panel")).toBeNull());
  });

  it("stays open on a click that opens a new tab instead of navigating", async () => {
    renderShell();
    const { panel } = await openDrawer();

    // Cmd/Ctrl-click opens a background tab; this page does not move, so
    // dismissing the menu the user is still reading is wrong.
    await userEvent.click(within(panel).getByRole("link", { name: "Attendance" }), {
      modifiers: ["ControlOrMeta"],
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(slot("app-drawer-panel")).not.toBeNull();
  });

  it("closes itself when the window widens past its own band", async () => {
    renderShell();
    await openDrawer();

    // The trigger is `md:hidden`. Widening past 768px with the panel open
    // leaves a modal drawer with focus trapped inside it, no visible control
    // to close it, and a focus-return target that is no longer rendered.
    await page.viewport(1024, 720);
    await vi.waitFor(() => expect(slot("app-drawer-panel")).toBeNull());
  });

  it("does not slide under prefers-reduced-motion: reduce", async () => {
    // The browser project pins `reducedMotion: "reduce"` in its context, so
    // this is the state a user with the OS setting on would see.
    expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(
      true,
    );

    renderShell();
    const { panel } = await openDrawer();
    expect(getComputedStyle(panel).transitionProperty).toBe("none");
    expect(
      getComputedStyle(requireSlot("app-drawer-overlay")).transitionProperty,
    ).toBe("none");
  });
});

/* ── names ────────────────────────────────────────────────────────────────── */

describe("accessible names", () => {
  it("gives the theme toggle a name that describes the action, not the state", async () => {
    renderShell();
    const toggle = requireSlot("theme-toggle");
    const before = toggle.getAttribute("aria-label");
    expect(before?.trim()).toBeTruthy();

    // The button is reachable by that name — an `aria-label` that exists but
    // does not become the accessible name is not a name.
    expect(screen.getByRole("button", { name: before! })).toBe(toggle);

    await userEvent.click(toggle);
    // A label naming the state would now be wrong. A label naming the action
    // is still true, which is the whole distinction.
    expect(toggle.getAttribute("aria-label")).toBe(before);
    expect(screen.getByRole("button", { name: before! })).toBe(toggle);

    // And the same when the control is *mounted* under each theme rather than
    // toggled within one. The check above alone would miss a label derived
    // from the theme at mount, because nothing re-renders this button — it
    // would be a stale state name rather than a changing one, which is no
    // better.
    for (const theme of ["dark", "light"] as const) {
      cleanup();
      setTheme(theme);
      renderShell();
      expect(
        requireSlot("theme-toggle").getAttribute("aria-label"),
        `the label changed with the ${theme} theme`,
      ).toBe(before);
    }
  });

  it("shows one glyph per theme, and the other one after a press", async () => {
    setTheme("dark");
    renderShell();
    const toggle = requireSlot("theme-toggle");
    const glyphs = Array.from(toggle.querySelectorAll("svg"));
    expect(glyphs, "the toggle should carry both glyphs").toHaveLength(2);

    const onScreen = () => glyphs.filter((glyph) => isOnScreen(glyph));

    // Exactly one. Dropping both `dark:` variants leaves the moon frozen in
    // place in both themes — or, depending which is dropped, both glyphs
    // showing at once. "Exactly one, and a different one" catches either.
    const inDark = onScreen();
    expect(inDark, "dark theme").toHaveLength(1);

    await userEvent.click(toggle);
    expect(documentTheme()).toBe("light");
    const inLight = onScreen();
    expect(inLight, "light theme").toHaveLength(1);
    expect(inLight[0]).not.toBe(inDark[0]);
  });

  it("names the drawer trigger, which renders an icon and nothing else", async () => {
    renderShell();
    await page.viewport(375, 720);
    const trigger = requireSlot("nav-drawer-trigger");
    expect(trigger.getAttribute("aria-label")?.trim()).toBeTruthy();
    expect(
      screen.getByRole("button", { name: trigger.getAttribute("aria-label")! }),
    ).toBe(trigger);
  });

  it("keeps the person's name reachable once the header collapses to the avatar", async () => {
    renderShell();
    await page.viewport(375, 720);
    const block = requireSlot("user-block");
    // Below 768px the name and role are off screen and the initials are all
    // that is left. "SW" is a non-empty accessible name and still not a name,
    // which is why the fallback carries the real one.
    expect(within(block).getByRole("img")).toHaveAccessibleName(
      SHELL_USER_FIXTURE.name,
    );
  });

  it("leaves no control or link nameless, in any band", async () => {
    renderShell("payroll");
    for (const band of BANDS) {
      await page.viewport(band.width, 900);
      for (const role of ["link", "button", "img"] as const) {
        const all = screen.queryAllByRole(role);
        const named = screen.queryAllByRole(role, { name: /\S/ });
        expect(
          named.length,
          `an unnamed ${role} at ${band.width}px`,
        ).toBe(all.length);
      }
      // And there is something to check — a band that rendered nothing would
      // pass the equality above trivially.
      expect(screen.queryAllByRole("button").length).toBeGreaterThan(0);
    }
  });
});

/* ── the header's one piece of logic ──────────────────────────────────────── */

describe("the company's date and timezone", () => {
  it("renders today in Indonesian, in the company's zone, with its local name", async () => {
    renderShell();
    await page.viewport(1440, 900);
    const line = requireSlot("header-date");
    await vi.waitFor(() =>
      expect(line.textContent).toContain("·"),
    );

    // Two independent checks, because either alone is weak. The shape catches
    // a switch to `en-US` ("Aug 27, 2026") or to `dateStyle: "full"`
    // ("Kamis, 27 Agustus 2026"); the equality catches a switch of timezone,
    // which the shape cannot see.
    expect(line.textContent).toMatch(/^\d{1,2} [A-Za-z]{3} \d{4} · WIB$/);
    const expected = new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeZone: SHELL_COMPANY_FIXTURE.timeZone,
    }).format(new Date());
    expect(line.textContent).toBe(`${expected} · WIB`);
  });

  it("names all four Indonesian zones, Pontianak included", () => {
    expect(zoneLabel("Asia/Jakarta")).toBe("WIB");
    // West Kalimantan. A distinct IANA identifier from Jakarta and the one
    // that gets left out; without it a Pontianak company reads the raw string.
    expect(zoneLabel("Asia/Pontianak")).toBe("WIB");
    expect(zoneLabel("Asia/Makassar")).toBe("WITA");
    expect(zoneLabel("Asia/Jayapura")).toBe("WIT");
    expect([...INDONESIAN_TIME_ZONES].sort()).toEqual([
      "Asia/Jakarta",
      "Asia/Jayapura",
      "Asia/Makassar",
      "Asia/Pontianak",
    ]);
    for (const zone of INDONESIAN_TIME_ZONES) {
      expect(zoneLabel(zone)).toMatch(/^WI(B|TA|T)$/);
      expect(formatCompanyDate(new Date(), zone)).toMatch(
        /^\d{1,2} [A-Za-z]{3} \d{4}$/,
      );
    }
  });

  it("survives a timezone the platform does not recognise", () => {
    // `Intl.DateTimeFormat` throws `RangeError` on an unknown zone, and this
    // runs during render — so one bad `companies.timezone` would take the whole
    // shell down, not just the line it belongs to. Nothing validates that
    // column yet.
    expect(() => formatCompanyDate(new Date(), "Asia/Atlantis")).not.toThrow();
    expect(formatCompanyDate(new Date(), "Asia/Atlantis")).toMatch(
      /^\d{1,2} [A-Za-z]{3} \d{4}$/,
    );
    // And the line says so rather than quietly showing a plausible local date.
    expect(zoneLabel("Asia/Atlantis")).toBe("Asia/Atlantis");

    expect(() =>
      render(
        <AppShell
          activeSegment={null}
          company={{ ...SHELL_COMPANY_FIXTURE, timeZone: "Asia/Atlantis" }}
          user={SHELL_USER_FIXTURE}
        >
          <p>Isi</p>
        </AppShell>,
      ),
    ).not.toThrow();
    expect(slot("app-shell")).not.toBeNull();
  });
});

/* ── the theme writer ─────────────────────────────────────────────────────── */

describe("the theme writer", () => {
  it("survives a reload, and a second press returns to dark", async () => {
    setTheme("light");
    expect(documentTheme()).toBe("light");

    renderShell();
    const toggle = requireSlot("theme-toggle");

    await userEvent.click(toggle);
    expect(documentTheme()).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(getComputedStyle(document.documentElement).colorScheme).toBe("dark");

    // The reload. Not a metaphor for one: this is the same blocking script the
    // document runs in `<head>`, re-run against what the writer left behind.
    // Without a writer the resolver alone would put the page back where it
    // started and this would read light.
    document.documentElement.classList.remove(DARK_CLASS);
    runBootScript();
    expect(documentTheme()).toBe("dark");

    await userEvent.click(toggle);
    expect(documentTheme()).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(getComputedStyle(document.documentElement).colorScheme).toBe("light");

    document.documentElement.classList.add(DARK_CLASS);
    runBootScript();
    expect(documentTheme()).toBe("light");
  });

  it("repaints the shell, not just the root class", async () => {
    setTheme("dark");
    renderShell();
    const header = requireSlot("app-header");
    const darkSurface = getComputedStyle(header).backgroundColor;

    await userEvent.click(requireSlot("theme-toggle"));
    const lightSurface = getComputedStyle(header).backgroundColor;

    expect(lightSurface).not.toBe(darkSurface);
    expect(lightSurface).toBe(resolvedToken("--color-surface"));
  });

  it("does not throw when storage is denied", async () => {
    setTheme("dark");
    renderShell();
    const denied = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
    try {
      // Asserted on the writer directly, not only through the click. A throw
      // inside a React event handler is swallowed by the test runner: the
      // class flip has already happened by then, so a click-only check reads
      // green against a writer with no guard at all. Measured — this case was
      // silent until it called the function.
      expect(() => toggleTheme()).not.toThrow();
      expect(documentTheme()).toBe("light");
      expect(denied).toHaveBeenCalled();

      // And through the control, because that is where a user meets it.
      await userEvent.click(requireSlot("theme-toggle"));
      // The session still gets the theme it asked for; only persistence is lost.
      expect(documentTheme()).toBe("dark");
    } finally {
      denied.mockRestore();
    }
  });
});

/* ── contrast and empty content ───────────────────────────────────────────── */

describe("the frame itself", () => {
  it("clears WCAG AA for every piece of small text, in both themes", async () => {
    for (const theme of ["dark", "light"] as const) {
      setTheme(theme);
      cleanup();
      renderShell("subscription");
      const faint = resolvedToken("--ui-faint");
      const shell = requireSlot("app-shell");

      const small = textCarryingElements(shell).filter(
        (element) => Number.parseFloat(getComputedStyle(element).fontSize) < 12,
      );
      // The shell really does run below 12px — group headings and the plan
      // line are 9px — so this is not a rule with nothing to bite on.
      expect(small.length, `${theme}: no sub-12px text found`).toBeGreaterThan(0);

      for (const element of small) {
        const colour = getComputedStyle(element).color;
        const label = `${theme}: "${element.textContent?.trim()}"`;
        // The token rule from the story, and the reason behind it. Asserting
        // only "not --ui-faint" would let any other low-contrast colour past;
        // asserting only the ratio would let `--ui-faint` past on the day the
        // ramp is retuned to clear 4.5 at 9px, which is not the decision that
        // was made. Both.
        expect(colour, `${label} is --ui-faint below 12px`).not.toBe(faint);
        expect(
          contrastRatio(colour, effectiveBackground(element)),
          `${label} fails AA`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("renders <main> with nothing in it, in both themes", async () => {
    for (const theme of ["dark", "light"] as const) {
      setTheme(theme);
      cleanup();
      renderShell(null, true);
      const main = document.querySelector("main");
      expect(main, `${theme}: no <main>`).not.toBeNull();
      const rect = main!.getBoundingClientRect();
      expect(rect.width, `${theme}: <main> collapsed`).toBeGreaterThan(0);
      expect(rect.height, `${theme}: <main> collapsed`).toBeGreaterThan(0);
      // The frame still holds its shape around the hole.
      expect(widthOf(slot("sidebar"))).toBe(SIDEBAR_PX);
      expect(widthOf(slot("app-header"))).toBeGreaterThan(0);
    }
  });

  it("shows one company as a label, with no caret and no menu", () => {
    renderShell();
    const pill = requireSlot("company-switcher");
    expect(pill).toHaveTextContent(SHELL_COMPANY_FIXTURE.legalName);
    expect(pill).toHaveTextContent(`${SHELL_COMPANY_FIXTURE.branchCount} branches`);
    // A single membership gets no control at all — not a disabled one, which a
    // screen reader would still announce as something to operate.
    expect(within(pill).queryByRole("button")).toBeNull();
    expect(pill.querySelectorAll("svg")).toHaveLength(1);
  });

  it("says nothing rather than '0 branches' for a company with no branches", () => {
    render(
      <AppShell
        activeSegment={null}
        company={{ ...SHELL_COMPANY_FIXTURE, branchCount: 0 }}
        user={SHELL_USER_FIXTURE}
      >
        <p>Isi</p>
      </AppShell>,
    );
    // Every company created in Story 1.5 starts here.
    expect(requireSlot("company-switcher")).not.toHaveTextContent("branch");
    expect(slot("branch-count")).toBeNull();
  });
});

/* ── this suite's own registration ────────────────────────────────────────── */

describe("this suite is registered", () => {
  it("is named in REQUIRED_SUITES, so deleting it fails the config", async () => {
    const config = await commands.readFile("vitest.config.mts");
    const start = config.indexOf("const REQUIRED_SUITES");
    const end = config.indexOf("];", start);
    expect(start, "REQUIRED_SUITES is gone from vitest.config.mts").toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    // Parsed, not searched. The array body has its comments stripped first, so
    // a path that only appears in prose cannot stand in for a registration —
    // the mistake that made an earlier version of the CI checks false-green.
    const body = config
      .slice(start, end)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const registered = Array.from(body.matchAll(/"([^"]+)"/g), (m) => m[1]);

    expect(registered).toContain("tests/browser/shell.test.tsx");
  });
});
