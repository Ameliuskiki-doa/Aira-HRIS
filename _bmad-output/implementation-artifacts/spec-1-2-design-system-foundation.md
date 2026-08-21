---
title: 'Story 1.2 — Design system foundation'
type: 'feature'
created: '2026-08-22'
status: 'ready-for-dev'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/specs/spec-aira-hris-payroll/design-system.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-Aira-2026-08-20/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The scaffold ships the starter's palette, a dead font wiring, and a dark theme reachable only by `prefers-color-scheme` — so an in-app toggle cannot force anything. Nothing in the tree carries the product's own identity, and the eleven `--ui-*` variables every designed screen depends on exist only inside a Claude Design artboard.

**Approach:** Vendor Nocturne as the token source, install shadcn on Base UI for components, and wire both through one theme layer so a utility resolves at the element and theming works in nested subtrees. Then close the escape hatch with a lint rule so the token scale cannot be bypassed.

## Boundaries & Constraints

**Always:** `styles/nocturne.css` is byte-identical to its source and never edited. Theming is `@theme inline` with `var()` indirection to raw values on `:root` and `.dark`. Dark mode is the `.dark` class. Typography is Inter through `next/font/google`. Every user-facing string is Indonesian.

**Ask First:** Adding a dependency beyond what `shadcn init` and the lint plugin install. Changing the `.dark` selector. Editing any file under `components/ui/` by hand.

**Never:** Do not put literal values inside `@theme inline` — Tailwind folds them to constants, theming dies, and the build still succeeds. Do not link `styles/nocturne.css` into the document; its line-2 Google Fonts `@import` would fire on every visit. Do not use Nocturne's nine component classes. Do not build the application shell, any screen, or any route — those are Story 1.3 onward.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Stored light preference | `localStorage.aira-theme = "light"` | Light on first paint, no dark flash | — |
| No stored preference | Empty storage | Dark applies, matching Nocturne `:root` | — |
| Nested theme | `.dark` on a descendant, not `<html>` | That subtree themes independently | — |
| Arbitrary value | `className="p-[13px]"` in app code | Lint exits non-zero naming the token to use | — |
| Arbitrary variant | `data-[state=open]:opacity-100` | Lint clean — a variant is not a value | — |
| Vendored primitive | Arbitrary value inside `components/ui/` | Lint clean — exempt by path | — |
| Literal in `@theme inline` | A hard-coded colour there | Caught by the nested-theme test failing | Must fail, not warn |

</frozen-after-approval>

## Code Map

Probed empirically on 2026-08-22; every claim below was run, not read.

- `styles/nocturne.css` -- **already fetched** to `/private/tmp/claude-501/-Users-ameliuskiki-Repository-Aira/64f1d54d-1b75-456e-acbc-01739875a9f9/scratchpad/nocturne.css`. 13029 bytes, 294 lines, 51 custom properties, sha256 `6fea354710ec4e3b2b979b723ed37d8e8959bb7d9137425d0d562b4ad8733cda`. Copy it; do not re-fetch. **Line 2 is a Google Fonts `@import` for Inter** — PostCSS forwards remote `@import` rather than inlining it, so linking this file costs a request per visit.
- `app/globals.css:1-26` -- carries four problems at once: `@theme inline` mapping Geist (8-13), dark only via `prefers-color-scheme` (15-20), `font-family: Arial` at line 25 overriding the very variables mapped above it, and a starter palette unrelated to Nocturne. `shadcn init` **rewrites this file wholesale**, 5 → 129 lines.
- `app/layout.tsx:2,6,11,29` -- Geist wiring to remove; line 3 imports `./globals.css`; `shadcn init` also edits this file, adding `h-full antialiased` and `min-h-full flex flex-col`.
- `eslint.config.mjs` -- flat config; the `no-arbitrary-value` rule and the `components/ui/**` exemption go here, after the boundary blocks.
- `postcss.config.mjs` -- one `@tailwindcss/postcss` plugin. **No `tailwind.config.*` exists and none should be created** — v4 is CSS-only.

**What `shadcn@4.19.0 init -b base -p nova -y` does, verified:** creates `components.json` and `lib/utils.ts` (`cn()` = `twMerge(clsx())`); rewrites `app/globals.css`; edits `app/layout.tsx`; leaves `tsconfig.json` alone. Installs `@base-ui/react`, `class-variance-authority`, `clsx`, `lucide-react`, `tailwind-merge`, `tw-animate-css`, and **`shadcn` itself as a runtime dependency** — `globals.css` does `@import "shadcn/tailwind.css"`, which supplies the `data-open`/`data-closed` custom variants. Adding components installs nothing further and does not touch `globals.css` again.

**Its token shape:** semantic role names in one flat tier (`--background`, `--primary`, `--accent`, `--border`, `--ring`, `--chart-1..5`, `--sidebar-*`), oklch values, `--radius-sm..4xl` derived by `calc()` from a single `--radius`, raw values on `:root` and `.dark`, mapped through `@theme inline`. Components name the semantic role (`bg-primary`), **but also reach past it into raw vars** — `hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]`, `rounded-[min(var(--radius-md),10px)]`. So the raw `--secondary` / `--foreground` / `--radius-md` names must stay alive, not only the `--color-*` ones.

**Collisions:** shadcn's `--color-accent` is a muted *surface*, Nocturne's is the brand blurple — same name, different meaning. `--radius-*` collides with shadcn's calc chain. `--space-*` is safe; Tailwind v4 uses a single `--spacing`.

**Theming, measured four ways** (compiled CSS plus `getComputedStyle` in Chrome): `@theme inline` + `var()` indirection works on the root **and** in nested subtrees. A non-inline `@theme` emits `--color-x: var(--raw)` onto `:root`, freezing the indirection there — it works on `<html>` and silently fails nested. Literals inside `@theme inline` are constant-folded to `background-color:red`; no variable survives and the build still passes. **`@theme inline` is required, literals are the trap.**

**Lint:** `eslint-plugin-tailwindcss@4.4.0`, rule `no-arbitrary-value`. Flat-config native, Tailwind v4 peer, needs no `tailwind.config`. Verified to flag `p-[13px]`, `bg-[#9184d9]`, values inside `cn()`/`clsx()` and template literals, while correctly ignoring arbitrary *variants* (`data-[state=open]:`, `[&>svg]:size-4`). Its options schema is empty — there is no allowlist — and it flags 5 genuine arbitrary values in shadcn's own generated components, so `components/ui/**` must be exempted by path.

## Tasks & Acceptance

**Execution:**
- [ ] `styles/nocturne.css` -- copy the pre-fetched file; verify the sha256 matches before proceeding
- [ ] `shadcn init` -- run with Base UI and a preset, non-interactive; accept that it rewrites `globals.css` and edits `layout.tsx`
- [ ] `app/globals.css` -- keep shadcn's semantic `@theme inline` block untouched; repoint only its raw `:root` and `.dark` values at the Nocturne scale, so every generated component follows without being edited. Import Nocturne's token block; do **not** link the vendored file itself
- [ ] `--ui-*` layer -- declare all eleven per theme from the table in `design-system.md`; `--ui-tint` keeps the dark accent hex in both
- [ ] `--color-accent` collision -- resolve it so the brand blurple is reachable and shadcn's surface meaning is not silently repurposed; record the choice in a comment
- [ ] `app/layout.tsx` -- Inter via `next/font/google` mapped onto `--font-heading` and `--font-body`; remove Geist; remove the `font-family: Arial` override
- [ ] theme script -- a blocking inline script resolving `localStorage.aira-theme` before first paint, setting the `.dark` class and `color-scheme`
- [ ] `eslint.config.mjs` -- `no-arbitrary-value` on app code, off for `components/ui/**`
- [ ] `components/ui/` -- add `button` and one overlay primitive as proof the pipeline works end to end
- [ ] `tests/theme.test.ts` -- cover the I/O matrix, including the nested-theme case that is the only thing distinguishing a correct `@theme inline` from a literal-poisoned one

**Acceptance Criteria:**
- Given `.dark` on a descendant element rather than `<html>`, when the page renders, then that subtree themes independently — this fails if any literal reaches `@theme inline`.
- Given a stored light preference, when any page loads, then it paints light on first paint with no dark flash, and `color-scheme` matches.
- Given app code with `p-[13px]`, when lint runs, then it exits non-zero; given `data-[state=open]:opacity-100`, then it stays clean.
- Given `components/ui/`, when lint runs over shadcn's generated arbitrary values, then it stays clean.
- Given the vendored stylesheet, when hashed, then it matches the recorded sha256, and no `<link>` or CSS `@import` pulls the file into the document.
- Given a rendered page, when fonts are inspected, then Inter is served by `next/font` and no request goes to fonts.googleapis.com.
- Given all four gates, when run, then lint, typecheck, test and build exit zero.

## Design Notes

The adapter direction matters. Repointing shadcn's raw layer at Nocturne means every generated component inherits the brand without a single edit, because components only ever name the semantic role. Mapping the other way — rewriting components to use Nocturne names — would have to be redone on every `shadcn add`.

The nested-theme test is the load-bearing one. Root-only theming passes under three of the four possible wirings, including two that are wrong. Only a nested subtree distinguishes them.

## Verification

**Commands:**
- `shasum -a 256 styles/nocturne.css` -- expected: `6fea354710ec4e3b2b979b723ed37d8e8959bb7d9137425d0d562b4ad8733cda`
- `npm run lint` -- expected: exits zero
- `npm run typecheck` -- expected: exits zero
- `npm test` -- expected: exits zero, theme suite runs
- `npm run build` -- expected: exits zero
- `grep -r "fonts.googleapis.com" app/ styles/*.css --include=*.tsx --include=*.css` -- expected: only the untouched vendored file
