---
title: 'DOM test harness — a browser environment that can actually verify UI'
type: 'chore'
created: '2026-08-27'
status: 'done'
review_loop_iteration: 0
baseline_commit: '63495b71fd98522154d3ff17a53dd808bb4fd571'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Aira's two test suites are pure Node — they read files and compile CSS. Nothing here can render a React component, and the shell that follows has acceptance criteria unverifiable without one: a 44px touch target, a focus trap, a tooltip that must appear on focus and not only hover. The obvious answer, jsdom, silently cannot do any of them.

**Approach:** Add a third Vitest project running real headless Chromium, alongside the existing Node projects, and prove with a smoke suite that it can do the three specific things jsdom cannot. Wire it into CI so the capability is guarded, not merely available.

## Boundaries & Constraints

**Always:** The two existing Node projects keep running exactly as they do now — no DOM, no browser, no slower. The new project is additive. CI must actually run it, and must fail if it stops running.

**Ask First:** Any change to the existing `unit` or `isolation` project definitions. Any decision to drop the browser and settle for a simulated DOM.

**Never:** No application code. No shell components, no `app/` changes beyond what a smoke fixture needs, no new user-facing surface. No `@vitejs/plugin-react` — it cannot install here.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Node projects unchanged | `--project unit` | runs pure Node, launches no browser, `typeof document === "undefined"` | N/A |
| calc() resolution | a real Tailwind-compiled `min-h-11` | resolves to `44px`, a number — not a `calc(...)` string | N/A |
| Real layout | a rendered, sized element | `getBoundingClientRect().height` is non-zero and matches the computed style | N/A |
| Focus trap | Base UI overlay open, Tab past the last item | focus stays inside, never reaches `<body>`; `Esc` closes and returns focus to the trigger | the case jsdom gets wrong |
| Suite deleted | required suite missing | the whole run fails at config load, including `--project unit` | must not read as success |

</frozen-after-approval>

## Code Map

All measured 2026-08-27 in a scratch mirror of this repo's exact versions. Nothing quoted from docs.

- **Why not jsdom or happy-dom.** Neither evaluates `calc()`, and every Tailwind v4 spacing utility compiles to `calc(var(--spacing) * N)`. `min-h-11` reads back as `"calc(var(--spacing) * 11)"` (jsdom) / `"calc(4px * 11)"` (happy-dom); chromium returns `"44px"`. Neither does layout — `getBoundingClientRect().height` is `0` in both.
- **The decisive failure.** In jsdom a Base UI focus trap **does not hold**: focus escapes to Base UI's guard `<span>`s and reaches `<body>` by tab 2–3. That test would be red because of the environment. happy-dom and chromium both hold it.
- **Installs clean:** `@testing-library/react@16.3.2`, `@testing-library/dom@10.4.1`, `@testing-library/user-event@14.6.6`, `@vitest/browser@4.1.11`, `@vitest/browser-playwright@4.1.11`, `playwright@1.62.1`. **`@vitejs/plugin-react` cannot install** (ERESOLVE) and is not needed — esbuild honours `jsx: react-jsx` from tsconfig.
- `vitest.config.mts` -- `projects` accepts a `browser` block per project; adding one leaves `unit` pure Node (verified). The browser project **needs `resolve.alias { "@": ROOT }`**, which the Node projects never did. Set `screenshotFailures: false`. `unit`'s `include` is `*.test.ts`, so `.tsx` never leaks in.
- **Vitest 4 breaking change:** `provider: "playwright"` as a string throws — must be `playwright()` from `@vitest/browser-playwright`, a separate package. jest-dom matchers are built in; no setup file.
- `package.json` -- `test` is `vitest run --project unit`. **A new project runs nowhere until this changes** — the single most likely way this work lands and does nothing.
- `REQUIRED_SUITES` is a module-level existence check and still fires across the project boundary: hiding a browser suite fails even `--project unit`. Verified.
- `.github/workflows/ci.yml` -- checkout@v5 → setup-node@v5 (22.x, `cache: npm`) → `npm ci` → lint → typecheck → `npm test` → build.
- **CI cost, measured.** `chromium-headless-shell` = **19s / 199 MB**; full `chromium` = 46s / 554 MB and wastes 355 MB, since Vitest headless launches `chrome-headless-shell` (`DEBUG=pw:browser`). Cache `~/.cache/ms-playwright` keyed on `hashFiles('package-lock.json')` — the browser build id is fixed per Playwright release. System deps sit outside the cached path, so a cache hit still needs `install-deps`. Test execution ~1.1s.
- **Cheaper, only partly verified:** `playwright({ launchOptions: { channel: "chrome" } })` needs no download, cache or `--with-deps`; passed locally in 5.85s. **Not** verified on an ubuntu runner — ship the cached headless-shell.

## Tasks & Acceptance

**Execution:**
- [x] `package.json` -- add the six dependencies above; change `test` so every project runs, and keep a way to run the Node projects alone
- [x] `vitest.config.mts` -- add the browser project (headless chromium, `playwright()`, alias, `screenshotFailures: false`) without touching the existing projects; register the new suite in `REQUIRED_SUITES`
- [x] `.github/workflows/ci.yml` -- cache the Playwright browser, install `chromium-headless-shell`, run the browser project. Do not install full `chromium`. **Assertions about CI must be structural** — parse the workflow's steps; a substring match is satisfied by a comment, and was
- [x] smoke suite -- **the harness must prove the three things jsdom cannot**, each asserted on a real measurement rather than on a class string or a source file: a Tailwind-compiled `calc()` utility resolving to a number, a rendered element reporting non-zero layout, and a Base UI overlay whose focus trap holds under repeated Tab, closes on `Esc`, and returns focus to its trigger. The suite must **fail if the browser project is removed, if it silently falls back to a non-browser environment, or if its registration is removed** — that property, not a list of cases, is the requirement

**Acceptance Criteria:**
- Given `vitest run` with no project filter, when it completes, then the output shows both a Node project and the chromium project executing, and every suite passes.
- Given the Node projects run alone, when they do, then no browser launches and `typeof document` is still `undefined` inside them.
- Given the browser project is deleted from the config, when the full test command runs, then it fails — a harness that can be removed without a red build is not a harness.
- Given a clean CI runner, when the workflow runs, then the browser project executes there too.
- Given `npm run lint`, `npx tsc --noEmit` and `npm run build`, when they run, then all three still exit zero.

## Spec Change Log

**2026-08-27 — patch round, no loopback.**
*Trigger:* three reviewers, 45 raw findings. The decisive one was reproduced twice: deleting the entire `Cache Playwright browsers` step from `ci.yml` left every assertion green, because `toContain("~/.cache/ms-playwright")` was satisfied by a comment in the same file. The anti-full-download guard also passed a bare `npx playwright install`, which fetches chromium, firefox and webkit.
*Root cause:* this spec stated the mutation property for the smoke suite but said nothing about the CI assertions, so those were written as source-text matches — testing spelling, not behaviour.
*Why no revert:* the config, dependencies and CI steps were independently verified correct by mutation before review; only assertions were weak, and they fix additively. Same call as Story 1.2, for the same reason.
*Amended:* the CI task now requires structural assertions (parsed workflow steps, not substring matches) and states the mutation property for CI wiring, so a re-derivation keeps it.
*KEEP:* the three core capability tests — `calc()` resolving to a number, non-zero layout, and the focus trap — and their mutation guards. The `optimizeDeps.include` list, which fixes a guaranteed first-CI-run flake found by deleting `node_modules/.vite`.

## Design Notes

This is its own change because the conclusion driving it — *a simulated DOM cannot verify this product's UI* — deserves review on its own evidence. Buried in the shell story it would be a config diff nobody reads. If it is wrong, far cheaper to learn that here than after a shell is written against it.

## Verification

**Commands:**
- `npx vitest run` -- expected: exits zero; output names both a Node project and the chromium project
- `npx vitest run --project unit` -- expected: exits zero, no browser launched
- `npm run lint` -- expected: exits zero
- `npx tsc --noEmit` -- expected: exits zero
- `npm run build` -- expected: exits zero
