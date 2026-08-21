---
title: 'Story 1.1 — Scaffold the repository'
type: 'chore'
created: '2026-08-21'
status: 'done'
review_loop_iteration: 2
baseline_commit: '01dcb82f69f98c9295a451eccb17eebc7e90d6d5'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-Aira-2026-08-20/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The repository holds a complete planning contract — 31 capabilities, 38 architecture decisions, 20 stories — and no application. Nothing can be built until the tree, the toolchain, and the boundaries that keep `lib/domain` pure exist and are enforced by CI rather than by memory.

**Approach:** Generate a Next.js scaffold in a temporary directory and merge it in selectively, because `create-next-app` refuses to write into a non-empty repo and three of its files collide with committed work. Then add the directories the architecture requires, the lint rule that enforces core purity, a test runner, and a CI workflow that runs all three.

## Boundaries & Constraints

**Always:** Keep the repository's existing `CLAUDE.md`, `README.md` title, `.mcp.json`, `.claude/`, `_bmad/`, `_bmad-output/` and `docs/` intact. Union `.gitignore`; never replace it. `lib/` sits at the repository root — `--no-src-dir` is mandatory. Every dependency version comes from what the starter resolves, not from a hand-written list.

**Ask First:** Adding any dependency the starter did not install. Changing the generated ESLint config format away from flat config. Any deviation from the AD-28 flag set.

**Never:** Do not run `create-next-app` in place. Do not delete the starter's `AGENTS.md` block — `next dev` rewrites it every run, producing a recurring dirty diff. Do not write application features, database migrations, UI components, or Supabase wiring; those are Stories 1.2 onward. Do not configure Tailwind theme tokens here — that is Story 1.2.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Clean merge | Scaffold generated in temp dir | Generated files copied in; no pre-existing file overwritten | Abort if any protected path would be clobbered |
| `CLAUDE.md` collision | Starter emits 11-byte `@AGENTS.md` | Repo's 4168-byte charter kept; `@AGENTS.md` import appended to it | Fail loudly rather than overwrite |
| `.gitignore` collision | Starter's is a superset minus two lines | Union, preserving `**/.DS_Store` and `**/.claude/settings.local.json` | Fail if either line is absent afterwards |
| Boundary violation | `lib/domain/x.ts` imports `next/server`, `react`, or a db client | `npm run lint` exits non-zero naming the forbidden import | — |
| Dynamic boundary violation | `lib/domain/x.ts` uses `require()` or dynamic `import()` | Lint exits non-zero | — |
| Empty test run | No test files yet | `npm test` exits zero | — |

</frozen-after-approval>

## Code Map

Probed `create-next-app` under Node 25.9.0 / npm 11.12.1 on 2026-08-21.

- `package.json` -- starter gives `dev`/`build`/`start`/`lint` only; `lint` is bare `eslint` (Next 16 dropped `next lint`). **No `typecheck`, no `test`.**
- Starter deps -- `next@16.3.2`, `react`/`react-dom@19.2.8`; dev `eslint@9.39.5`, `eslint-config-next@16.3.2`, `typescript@5.9.3`, `tailwindcss@4.3.3`, `@tailwindcss/postcss@4.3.3`.
- `eslint.config.mjs` -- ESLint 9 flat config (`defineConfig`, `eslint-config-next` subpaths, `globalIgnores`). Where the AD-2 boundary goes.
- `tsconfig.json` -- `paths: {"@/*": ["./*"]}`. **The alias is a boundary hole unless restricted.**
- `app/globals.css` -- carries `@theme inline`, which AD-36 forbids. Story 1.2's problem, not this one.
- `app/layout.tsx` -- ships `lang="en"` and `title: "Create Next App"`. Both user-facing.
- `postcss.config.mjs` -- one plugin; **no `tailwind.config.*`**, v4 is CSS-only.
- `CLAUDE.md` (4168 B) -- the charter. Starter's 11-byte version destroys it. **Protect.**
- `.gitignore` (55 B) -- carries `**/.DS_Store` and `**/.claude/settings.local.json`. **Union.** Starter's `.env*` swallows `.env.example`.
- `AGENTS.md` -- rewritten by `next dev` every run. Coexists; never deleted.

## Tasks & Acceptance

**Execution:**
- [x] temp dir -- run `create-next-app` with the AD-28 flags; copy in only non-colliding files behind a guard that aborts if a target exists
- [x] `.gitignore` -- union both, keep both Aira lines, add `!.env.example`
- [x] `.env.example` -- name the variables later stories need, no values, and one line warning that a `service_role` key must never be added here
- [x] `CLAUDE.md` -- append the `@AGENTS.md` import to the existing charter
- [x] `README.md` -- keep the title; describe only checks that actually exist
- [x] `lib/domain/`, `lib/db/`, `worker/jobs/`, `styles/`, `supabase/migrations/`, `tests/golden/`, `tests/isolation/` -- create with `.gitkeep`
- [x] `eslint.config.mjs` -- enforce the **whole** AD-2 invariant, not a package list. Relative escapes must be denied in **non-canonical form too** (`./../x`, `./../../x`) — anchoring on `^(?:\.\./)` alone leaves a hole. I/O globals include `console`. `lib/domain` is pure: no framework, database, filesystem, network, clock or randomness, and no import out of itself into `app/`, `lib/db/` or `worker/` **by any path form** — bare specifier, `@/` alias, or relative. Every JS/TS extension. Block `require()`, dynamic `import()` and `createRequire`. Use `no-restricted-syntax`/`no-restricted-globals` for whatever imports cannot express. Built-ins only, no new dependency
- [x] `package.json` -- add `typecheck` (`next typegen && tsc --noEmit` — `.next/types` is gitignored, so bare `tsc` fails from a clean checkout) and `test`
- [x] Vitest -- install; scope the default run to database-free suites and give `tests/isolation/**` its own script now, before Story 1.4 writes into it
- [x] `tests/boundary.test.ts` -- the suite must **fail if any single denial is removed from the config**. That property, not a list of classes, is the requirement — derive the cases from the config's own denial entries so a new denial cannot be added without a case. Real fixtures, linted through the entry point CI invokes. Place fixtures at the depths real domain code occupies — directly in `lib/domain/` and one level below — with intra-core controls at those same depths so an over-strict rule is caught too. Assert on the specific rule and message, never on "some error exists", and scope the exit-code assertion to the fixture files rather than the whole tree
- [x] fixtures -- boundary fixtures must not be able to break a later `lint`, `typecheck` or `build` if a run is killed mid-test: ignore their paths or write them outside the tracked tree
- [x] `vitest.config.mts` -- a lost or renamed boundary suite must not report success
- [x] `app/layout.tsx` -- `lang="id"`, real metadata
- [x] `.github/workflows/ci.yml` -- push + PR; `npm ci` then lint, typecheck, test **and build**; `permissions: contents: read`; job timeout

**Acceptance Criteria:**
- Given a `lib/domain` module that reads a file, imports `lib/db` through the `@/` alias, calls `Date.now()` and `Math.random()`, when `npm run lint` runs, then it exits non-zero reporting every one of those violations.
- Given any single denial is removed from the boundary config — one global, one selector, one path form, or a one-character narrowing of the depth generator — when the test suite runs, then it fails.
- Given a `lib/domain` module importing `./../db/client` or `./../../db/client`, when `npm run lint` runs, then it exits non-zero.
- Given a `lib/domain` module calling `console.log`, when `npm run lint` runs, then it exits non-zero.
- Given the lint entry point is narrowed to exclude `lib/`, when the test suite runs, then it fails.
- Given the boundary test file is renamed so the include glob no longer matches, when `npm test` runs, then it does not report success.
- Given malformed CSS, when CI runs, then it fails.
- Given the merged scaffold, when lint, typecheck, test and build run, then all four exit zero.
- Given `git status` after the merge, then only `.gitignore`, `CLAUDE.md` and `README.md` are modified, each additively, and `CLAUDE.md` still carries all twelve rules and the stack table.
- Given the repository root, then `lib/` exists there and no `src/` exists.

## Spec Change Log

**2026-08-21 — iteration 1.**
*Trigger:* AD-2 proved half-enforced — a `lib/domain` module using `node:fs`, an `@/lib/db` alias import, `Date.now()` and `Math.random()` linted clean at exit 0. Also demonstrated: narrowing the `lint` script left the suite green; renaming the boundary test gave zero tests and exit 0; malformed CSS passed lint, typecheck and test but failed `build`.
*Root cause:* the Tasks section enumerated seven package names instead of stating the invariant, and asked only that the test "reject a fixture" — so the test's rows mirror the config and can never fail on a gap.
*Amended:* boundary task now states the invariant across every path form and extension; the test must use real fixtures through the CI lint entry point, one case per violation class; CI gained build, permissions and a timeout; Vitest gained an isolation split and a vanished-suite guard; added `.env.example`, `lang="id"`, honest README claims.
*Known-bad state avoided:* a green CI that proves nothing.
*KEEP:* temp-dir scaffold with a guard aborting on collision; the three merge outcomes (charter intact, `.gitignore` unioned, README title kept); `typecheck` as `next typegen && tsc --noEmit` (an original discovery); the AD-1 tree with `.gitkeep`; Vitest as the only added dependency; `engines.node >= 22.12`.

**2026-08-22 — iteration 2.**
*Trigger:* mutation testing defeated the suite. Changing `repeat(depth - 1)` to `repeat(depth)` — one character — left 16/16 green while a `lib/domain` module importing `../db/client` linted clean; the only escape fixture sat at depth 3 while real domain code lives at depths 1–2. Replacing `IMPORT_LIKE` with `"ImportDeclaration"` also left 16/16 green while `export * from "next/server"` linted clean. Separately verified live in the shipped config: `./../db/client` and `./../../db/client` escape, and `console` is not denied.
*Root cause:* the test task enumerated violation classes — the same mistake as iteration 1, one level up. A class list only ever covers what someone already thought of.
*Amended:* the test task now states a property — the suite must fail if any single denial is removed — with cases derived from the config's own denial entries, fixtures at the depths real code occupies plus controls there, and assertions pinned to the specific rule and message. Added the non-canonical relative form and `console` to the boundary; required fixtures not to be able to break a later run; added a `service_role` warning to `.env.example`.
*Known-bad state avoided:* a boundary that works today, silently stops working after any edit, and shows green either way.
*KEEP:* everything from iteration 1, plus — the denial-by-default design (not a package list); the finding that `no-restricted-imports` `patterns` cannot express "deny non-relative, allow intra-core relative" because no negation form re-allows a legitimate sibling import, which is why selector rules are used; the boundary test running through the real lint entry point with on-disk fixtures; the `REQUIRED_SUITES` vanished-suite guard; `lang="id"` with Indonesian metadata; CI carrying build, `permissions` and a timeout; the `--project` split keeping `npm test` database-free.

## Design Notes

State the invariant, not the enumeration. A list of forbidden packages is a list of things someone already thought of; `lib/domain` is pure, and the rule should read that way so a reviewer can tell whether it is complete.

The boundary test must exercise the entry point CI actually invokes. A test built on `lintText` with a synthetic path verifies the config object, which is not the thing that can regress — the script's argument list is.

## Verification

**Commands:**
- `npm run lint` -- expected: exits zero on the clean tree
- `npm run typecheck` -- expected: exits zero
- `npm test` -- expected: exits zero; boundary suite runs and passes
- `npm run build` -- expected: exits zero
- `git status --short` -- expected: only additive changes to the three merged files

## Suggested Review Order

**The AD-2 boundary — the heart of this change**

- Start here: denials are declared as data, so the config and the test read one source of truth.
  [`eslint.boundary.mjs:359`](../../eslint.boundary.mjs#L359)

- The escape pattern. Matches a climb whether it ends in a slash or ends the specifier, without catching legal intra-core climbs.
  [`eslint.boundary.mjs:108`](../../eslint.boundary.mjs#L108)

- Shared denials apply at depths 1, 2 and past the cap — narrowing this is what three review rounds kept slipping through.
  [`eslint.boundary.mjs:65`](../../eslint.boundary.mjs#L65)

- The extension list. Dropping one silently removes the boundary for those files, so it is pinned in the test manifest.
  [`eslint.boundary.mjs:38`](../../eslint.boundary.mjs#L38)

- Clock, randomness and I/O globals, including `console` and the `globalThis` aliases.
  [`eslint.boundary.mjs:285`](../../eslint.boundary.mjs#L285)

- Fixture paths are lint-ignored unless the suite opts in, so a killed test run cannot break the next lint.
  [`eslint.config.mjs:7`](../../eslint.config.mjs#L7)

**Proof the boundary cannot be weakened silently**

- The hand-written manifest pins the denial set; removing a denial fails here even though cases are derived.
  [`tests/boundary.test.ts:14`](../../tests/boundary.test.ts#L14)

- The suite lints twice — with fixtures opted in, then without — proving the ignore branch is live.
  [`tests/boundary.test.ts:268`](../../tests/boundary.test.ts#L268)

- A renamed or vanished boundary suite fails at config load rather than passing with zero tests.
  [`vitest.config.mts:12`](../../vitest.config.mts#L12)

**Gates**

- `typecheck` runs `next typegen` first — `.next/types` is gitignored, so bare `tsc` fails from a clean checkout.
  [`package.json:13`](../../package.json#L13)

- CI builds as well as lints — malformed CSS passes the other three gates and only fails here.
  [`.github/workflows/ci.yml:34`](../../.github/workflows/ci.yml#L34)

**The three merged files — additive only**

- The charter kept whole; the starter's 11-byte version would have replaced it.
  [`CLAUDE.md:84`](../../CLAUDE.md#L84)

- Unioned, not replaced — the two Aira-specific ignore lines survive.
  [`.gitignore:1`](../../.gitignore#L1)

- Indonesian document language, per the definition of done.
  [`app/layout.tsx:28`](../../app/layout.tsx#L28)
