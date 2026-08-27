---
title: 'Story 1.3 — The application shell'
type: 'feature'
created: '2026-08-27'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'ca6e44fd0a288f82f2411e5f9964fe2338979ef1'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/specs/spec-aira-hris-payroll/screen-dashboard.md'
  - '{project-root}/_bmad-output/specs/spec-aira-hris-payroll/screen-dashboard-interaction.md'
  - '{project-root}/_bmad-output/specs/spec-aira-hris-payroll/design-system.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Aira has tokens and two primitives but no product. There is one placeholder route, no navigation, no header, and the light theme is unreachable — nothing in the repo writes `localStorage.aira-theme`, so half the theme CSS guards a state no user can enter.

**Approach:** Build the persistent frame every later screen renders inside — sidebar, header, five responsive bands, off-canvas drawer — plus the theme toggle that makes light reachable, and an app-level wrapper layer so vendored primitives can carry Indonesian copy without being hand-edited. The DOM test harness this story's criteria are verified with is a **prerequisite, delivered separately** (`spec-dom-test-harness.md`).

## Boundaries & Constraints

**Always:** User-facing copy Indonesian. Geometry from Tailwind's default scale (`p-3.5`, `p-1.75`, `p-2.75` — dynamic quarter-steps, not arbitrary values). Colour only through `--ui-*` / `--color-*`. Focus ring is the design system's; never overridden. Text below 12px uses `--ui-muted`, never `--ui-faint`. Icons from `@phosphor-icons/react/ssr`.

**Ask First:** Any change to `--spacing`, `styles/nocturne.css`, or the `--ui-*` contrast values settled in Story 1.2. Any user-facing string the design docs do not supply — propose it, do not ship it silently.

**Never:** No `--space-*` reconciliation (see Design Notes — closed, not deferred). No hand-edits to `components/ui/**`; wrap instead. No company-switcher panel, notification panel, unread dot, badge count, or retention card. No data layer, no Supabase, no auth. No `lib/domain` changes. No test-harness work — it arrives already built.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Wide | ≥1440px | 236px sidebar + fluid main; four labelled groups | N/A |
| Active item | route matches nav item | `--ui-active-bg` + inset accent ring + `aria-current="page"` | exactly one item active |
| Rail | 768–1199px | 64px rail, labels hidden, items ≥44px, tooltip on hover **and focus**, active ring kept | N/A |
| Drawer open | <768px, trigger pressed | 236px off-canvas, focus trapped, labels at ≥44px | N/A |
| Drawer close | backdrop / `Esc` / navigation | closes; focus returns to trigger | all three paths |
| Theme toggle | pressed | class flips, `localStorage` written, survives reload, `color-scheme` follows | storage denied → no throw |
| Icon-only control | rendered | non-empty accessible name; toggle names the action, not the state | N/A |
| Empty content | no page built | `<main>` renders in both themes, no layout error | N/A |
| One membership | fixture | plain label, no caret, no menu | N/A |
| Reduced motion | `prefers-reduced-motion: reduce` | drawer slide disabled | N/A |

</frozen-after-approval>

## Code Map

Probed empirically 2026-08-27 in a scratch mirror of this repo's exact versions; every number below was measured, not read.

- **Harness — already built, committed at `2658ce5`.** The Vitest project is named **`chromium`** (headless Playwright) and collects **`tests/browser/**/*.test.tsx`** — note the directory, not `tests/dom`. Testing Library, the CI cache/install steps and `optimizeDeps.include` are in place; 237 tests pass. Write `tests/browser/shell.test.tsx` and register it in `REQUIRED_SUITES`; change nothing else in `vitest.config.mts` — the `unit` and `isolation` definitions are Ask First.
- **`optimizeDeps.include` is hand-maintained.** It lists the browser project's dependencies so a cold Vite cache does not re-optimise mid-test and fail with `Failed to fetch dynamically imported module`. This story adds components, so **extend that list** with anything new the shell suite pulls in. The failure only reproduces on a cold cache — verify with `rm -rf node_modules/.vite`.
- **Nothing in this repo branches on `prefers-reduced-motion`** — not `app/globals.css`, not `styles/nocturne.css`, not `tw-animate-css`. The matrix row is therefore new work, not a check of existing behaviour. The browser project already pins `reducedMotion: "reduce"` in its context, so the media query is assertable.
- **Geometry — settled.** The shell's specified values {5,7,8,10,11,14,16,20,24,28,40}px are reachable from Tailwind's default scale **15/15 exactly**; from Nocturne's `--space-*` (2.8×N) **0/15**. Quarter-steps like `p-1.75` compile as real utilities and are lint-clean.
- **Icons.** `@phosphor-icons/react@2.1.10`, zero peer warnings, all 19 needed icons present (kebab → PascalCase). The default entry **fails `next build` in a Server Component** (`createContext is not a function`); `@phosphor-icons/react/ssr` builds and prerenders inline `<svg>` at **0 bytes** of client JS, ~758 B gzip each inside a client component. The barrel tree-shakes; deep imports buy nothing.
- **shadcn on Base UI, verified `add`-able:** `tooltip`, `drawer` (native, no `vaul`), `separator`, `avatar`. `menu` 404s — use `dropdown-menu` if ever needed. `drawer` hardcodes `bg-black/10`, near-invisible over `--color-bg #161826` — the reason the wrapper layer exists.
- `app/theme-script.ts:31` -- `resolveTheme` is total and exported; `THEME_STORAGE_KEY`, `DARK_CLASS`, `DEFAULT_THEME` too. **No writer exists** — that is the gap.
- `app/globals.css:200-203` -- comment says the `--space-*` reconciliation "belongs with the first real screen". Now known false; correct it.
- `app/layout.tsx:26` -- root layout; `<body className="min-h-full flex flex-col">`. `app/page.tsx` is the Story 1.2 placeholder.
- Next 16: `useSelectedLayoutSegment` (client) reads one segment below its layout — use it for active state, not `usePathname` string matching.
- **Design-doc conflicts, resolved here:** `screen-dashboard.md:239-242` lists responsive rules, the switcher menu and the bell panel as "open decisions"; `screen-dashboard-interaction.md:22-145` specifies all three. The interaction doc is later and wins. Retention card states 90 days against `commercial-model.md`'s 6 months/30 days — unresolved, so the card is omitted.

## Tasks & Acceptance

**Execution:**
- [x] `package.json` -- add `@phosphor-icons/react@2.1.10`; no other new dependency
- [x] `app/theme-script.ts` -- add the writer that persists the preference and flips the class; keep the resolver total and the inline script unchanged
- [x] `components/app/` -- the wrapper layer: re-export the shell's primitives with Indonesian copy and token colours, so `components/ui/**` stays regenerable. Fix `bg-black/10` here, not there
- [x] `components/shell/navigation.ts` -- the four groups and their items as data: label, href, icon, group. One definition, consumed by sidebar, rail and drawer alike
- [x] `components/shell/` -- sidebar, header, nav item, theme toggle, company switcher (one-membership form only), drawer. Icons via `/ssr`; keep client boundaries as small as the interactivity requires
- [x] `app/(app)/layout.tsx` + placeholder segments -- the shell as a route-group layout, plus a stub route per nav destination so navigation and active state are real rather than mocked
- [x] `app/globals.css` -- correct the stale `--space-*` comment to record the closed verdict
- [x] `tests/browser/shell.test.tsx` -- **the suite must fail if any single one of these is removed:** a nav item from the definition, the `aria-current` binding, any `aria-label` on an icon-only control, the focus trap, the `Esc` handler, the backdrop handler, the close-on-navigation handler, the focus-return, any responsive band's rule, the theme writer, or the suite's own registration. That property, not a list of cases, is the requirement. **Assert on measured layout** — `getBoundingClientRect()` and resolved `getComputedStyle` in the real browser — never on class strings, which would re-create the enumeration trap that cost Stories 1.1 and 1.2

**Acceptance Criteria:**
- Given a stored light preference, when the toggle is pressed and the page reloaded, then light survives, and a second press returns to dark — proving the writer, not only the resolver.
- Given the rail at 1024px, when a nav item is focused by keyboard alone, then its tooltip appears — hover-only would pass a mouse test and fail a keyboard user.
- Given the drawer open, when Tab is pressed past the last item, then focus returns to the first and never reaches `<body>`.
- Given any breakpoint, when the shell renders in both themes, then no element's accessible name is empty and no text below 12px resolves to `--ui-faint`.
- Given `npm run lint`, `npx tsc --noEmit`, the full test run and `npm run build`, when all four run, then all four exit zero.

## Spec Change Log

**2026-08-27 — patch round, no loopback.**
*Trigger:* three reviewers, ~80 raw findings. Six were demonstrated as running mutations that left the suite green at 38/38: forcing `activeSegment` to `null` (every route highlighting Dasbor), replacing the tooltip wrapper with a pass-through, switching the date formatter to `en-US`/UTC, raising the 13px base to 16px, freezing the theme toggle on one glyph, and showing the brand wordmark and group headings inside the 64px rail. The band table also sampled only interior widths, so a media query written `>= 769` would have passed every case.
*Root cause:* the test task stated the mutation property correctly; the suite under-delivered against it. `labelsVisible` measured only the nav item's own span, so two band rules escaped a property the spec explicitly demanded.
*Why no revert:* the production code was verified correct by reading `app-shell-route.tsx` and `header-date.tsx` and by re-running three mutations independently. Only assertions were blind, and they fix additively. Same call as Story 1.2.
*Amended:* the test task now names the band rules individually and requires boundary widths, not interior samples.
*KEEP:* the segment comparison in `AppShellRoute` rather than pathname matching — `/karyawan/123` must keep Data Karyawan active. The CSS icon swap in the theme toggle rather than React state, which is what avoids a wrong glyph on first paint. The `useSyncExternalStore` date snapshot, which is what keeps the server render safe.

## Design Notes

**The `--space-*` reconciliation is closed, not deferred.** `deferred-work.md` records it as postponed because rescaling was expensive. It is worse than expensive: Nocturne uses `--space-*` for padding and gap, while Tailwind's `--spacing` also drives sizing. Setting `--spacing: 2.8px` collapses a default Button from 32px to 22.4px, its icon from 16px to 11.2px, and — decisively — turns `min-h-11` into 30.8px, so the very utility guaranteeing a 44px touch target silently stops guaranteeing it. A named namespace (`--spacing-n3`) was tested and works mechanically, but covers 0 of the shell's 15 values. `--space-*` stays a Nocturne reference token; `--spacing` stays at 4px.

**Why the wrapper layer is structural.** `components/ui/**` is regenerated by `shadcn add`; a hand-edit there disappears without warning. Every Indonesian string and token-colour correction must live one layer up or it is temporary.

## Verification

**Commands:**
- `npm run lint` -- expected: exits zero
- `npx tsc --noEmit` -- expected: exits zero
- `npm test` -- expected: exits zero; the shell suite runs in the chromium project
- `npm run build` -- expected: exits zero
- `grep -rn "phosphor-icons/react\"" app components` -- expected: no match; every import uses the `/ssr` entry
