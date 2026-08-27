# Deferred Work

Findings surfaced by review that are real but not caused by, or not in scope for, the story that surfaced them.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-the-repository.md`
  summary: Nothing anywhere enforces the `service_role` prohibition, and no lint rule keeps `lib/db` out of `app/` or `app/` out of `worker/`.
  evidence: Verified by grep — zero occurrences of `service_role` in any lint rule, CI step or test, and zero cross-layer file globs beyond `lib/domain`. CLAUDE.md rule 5 and AD-16 make this the invariant whose violation is a cross-tenant leak. Story 1.1 built 60 denials and 70 tests for core purity while the higher-stakes invariant has none. A reviewer put it as: the invariant that got machinery is not the one that ends the business.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-the-repository.md`
  summary: `npm run test:isolation` exits 0 over an empty directory, with no vanished-suite guard.
  evidence: `REQUIRED_SUITES` in `vitest.config.mts` protects only `tests/boundary.test.ts`. docs/07 calls tenant isolation "the most important test in the codebase". Story 1.4 owns the suite and must extend the guard when it lands.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-the-repository.md`
  summary: docs/07 specifies the isolation suite at `tests/isolation.test.ts`; the scaffold created `tests/isolation/**` and excludes it from CI.
  evidence: Doc and tree disagree from day one. Recorded only in README and a Vitest comment, not in the document the project treats as the contract.
  resolved: Story 1.4 rewrote the "Required test: tenant isolation" section of `docs/07-conventions-and-testing.md` against the harness that now exists — file map, the property it enforces, the per-relation-kind rules, the two non-vacuity rules, and the exemption list. `CLAUDE.md`'s definition of done now points at a description that matches the code.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-the-repository.md`
  summary: `app/page.tsx` ships the create-next-app template — English copy and Vercel marketing links under `<html lang="id">`.
  evidence: CLAUDE.md's definition of done requires Indonesian user-facing strings. The spec's Never list scoped UI work to Stories 1.2–1.3, so this is deliberate deferral rather than an oversight, but it is user-facing English shipping today.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-the-repository.md`
  summary: `AD-*` identifiers are cited throughout the code but resolve to nothing a code reader can reach.
  evidence: `.env.example` cites AD-4/16/20 and `eslint.boundary.mjs` cites AD-2; no `AD-` identifier appears under `docs/`. The spine lives in `_bmad-output/planning-artifacts/`, which CLAUDE.md's "Where things are" map does not list.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-the-repository.md`
  summary: `next.config.ts` is the untouched placeholder — no security headers, no CSP, no `poweredByHeader: false`, no `images.remotePatterns` for the R2 origin.
  evidence: A multi-tenant payroll product storing NIK, salary and attendance photos ships with framework defaults.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-the-repository.md`
  summary: One root tsconfig with DOM lib and `jsx: react-jsx` also governs `worker/`, and `target` is the starter's ES2017.
  evidence: A long-lived Node worker is typechecked with browser types; `window`/`document` type-resolve inside `lib/domain`, where only lint stops them. No `worker` script exists in package.json either.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-the-repository.md`
  summary: No formatter, no format gate, no `.editorconfig`.
  evidence: A tree that deliberately mixes generated starter files with hand-written ones is exactly where formatting drift starts, and a scaffold commit is the cheapest moment to fix it.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-the-repository.md`
  summary: CI runs the full job twice for a push to a branch with an open PR, and lints the tree twice per job.
  evidence: `on: push` and `on: pull_request` carry no branch filters and there is no `concurrency` cancel; `npm test` spawns a second full-tree `npm run lint` inside the boundary suite.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-the-repository.md`
  summary: Every CI build depends on network access to Google Fonts via `next/font/google` (Geist).
  evidence: A build-time external dependency that will fail closed on a network blip, never explicitly decided.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-design-system-foundation.md`
  summary: Vendored shadcn primitives need an app-level wrapper layer — they ship English copy and non-token colours, and hand-editing them is silently reverted by the next `shadcn add`.
  evidence: `components/ui/dialog.tsx` carries `"Close"` twice as user-facing English against a definition of done requiring Indonesian, and `DialogOverlay` hardcodes `bg-black/10`, a near-invisible scrim over `--color-bg: #161826`. The frozen spec block forbids hand-editing `components/ui/`, and the engineering reason holds independently: a fix applied there disappears without warning on regeneration. The pattern applies to every primitive needing Indonesian copy, not only dialog, which makes it structural work for Story 1.3's shell rather than a patch here.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-design-system-foundation.md`
  summary: The light theme is unreachable — nothing in the repo writes the theme preference, and `prefers-color-scheme` is no longer consulted.
  evidence: No `setItem` call exists anywhere under `app/`, `components/` or `lib/`; the resolver only reads `localStorage.aira-theme`. The starter honoured OS preference and that block was removed. Until Story 1.3 ships a toggle, every user is locked to dark regardless of system preference, and roughly forty lines of light-theme CSS plus half the theme suite guard a state no one can reach.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-design-system-foundation.md`
  summary: Nocturne's 0.70x density scale is declared but inert — `--space-*` has no consumer and `p-4` is still 16px.
  evidence: Setting Tailwind's `--spacing` to the Nocturne scale would rescale every shadcn component and every `size-*` icon at once, so the reconciliation was deliberately deferred. Until it happens the product's spacing is Tailwind's, not Nocturne's, and the tokens are dead weight that reads as if it were wired.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-design-system-foundation.md`
  summary: Any future `no-restricted-syntax` block is a live hazard to the AD-2 purity boundary.
  evidence: ESLint replaces rule options rather than merging them, so a new block whose `files` glob overlaps `lib/domain/**` silently deletes every purity denial while lint still exits zero. This happened during this story and only the boundary suite caught it, with 68 failures. Any new block must exclude the core directory, and that constraint is currently recorded only in a code comment.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-design-system-foundation.md`
  summary: No PWA chrome, no `prefers-reduced-motion` guard, and no `color-mix()` fallback.
  evidence: CLAUDE.md calls the product PWA-first, yet there is no manifest, no `themeColor` viewport export and no `<meta name="theme-color">`, so browser chrome stays light while the app is dark. `tw-animate-css` was newly imported and dialog animations use it with no reduced-motion guard. Every `--ui-*` surface value and `--color-divider` — applied globally through `border-border` — is `color-mix()`, which is invalid at computed-value time on engines without support; the production minifier does emit solid fallbacks, but the resulting colours are flattened. Relevant for Indonesian field staff on older Android WebViews.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-design-system-foundation.md`
  summary: The design system is documented nowhere a contributor is pointed at.
  evidence: CLAUDE.md's "Where things are" map lists only `docs/01`–`docs/07`, none of which were touched. The `@theme inline` trap, the `accent`→`brand` rename, the forbidden ramp steps and the arbitrary-value rule live only in CSS comments and in `_bmad-output/specs/.../design-system.md`, which CLAUDE.md never mentions. The same gap applies to the `AD-*` identifiers cited throughout the code.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-the-application-shell.md`
  summary: The application shell itself — sidebar, header, five responsive bands, off-canvas drawer, theme toggle and the app-level wrapper layer — was split out of the DOM-test-harness spec and remains Story 1.3 in sprint tracking.
  evidence: The combined spec measured ~2,700 tokens against a 1,600 target, and the harness is independently shippable: it can be reviewed, tested and merged on its own, and the shell's acceptance criteria (44px touch targets, focus trap, tooltip on focus) cannot be verified until it exists. Its draft spec is on disk and narrowed to the shell alone.

- source_spec: `_bmad-output/implementation-artifacts/spec-dom-test-harness.md`
  summary: `REQUIRED_SUITES` proves a test file exists but never that it contains tests, so a suite emptied in place stays green.
  evidence: The guard is an `existsSync` loop. Replacing any required suite with an empty file satisfies it completely. This is the Story 1.1 pattern inherited unchanged, not a regression introduced here, but it caps what every mutation guard built on top of it can promise.

- source_spec: `_bmad-output/implementation-artifacts/spec-dom-test-harness.md`
  summary: Vitest 4 treats an unmatched `--project` filter as a silent no-op — `vitest run --project doesnotexist` exits 0 with a green report.
  evidence: Verified by a reviewer against the live tree. It means the `--project chromium` flag in the `test` script self-checks nothing; the entire guarantee that the browser project runs rests on `tests/harness-registration.test.ts` executing inside `unit`. That works today, but the margin is thinner than the config comments imply, and the same hazard applies to every future project filter in this repo.

- source_spec: `_bmad-output/implementation-artifacts/spec-dom-test-harness.md`
  summary: `optimizeDeps.include` is a hand-maintained list whose drift is only observable on a cold Vite cache.
  evidence: The list exists because a cold cache made Vite re-optimise mid-test and fail with `Failed to fetch dynamically imported module`. Nothing detects a newly tested component pulling in an unlisted dependency, and a warm local run cannot surface it — the failure returns as an intermittent CI import error. The shell story adds several components and is the first place this will bite.

- source_spec: `_bmad-output/implementation-artifacts/spec-dom-test-harness.md`
  summary: `@testing-library/user-event` is installed but imported nowhere.
  evidence: The spec's task named six dependencies; the focus-trap test correctly uses `userEvent` from `vitest/browser` instead, because that one drives real Playwright key input rather than dispatching synthetic events. The package is dead weight until the shell tests need it, which they may not.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-the-application-shell.md`
  summary: `next/link` in the browser test project resolves to the Pages Router implementation, so the module under test is not the one the build ships.
  evidence: Vite does not apply Next's app-dir alias, which is why the suite needs `tests/browser/next-env-shim.ts` and a capture-phase `preventDefault` to stop the iframe navigating. Component behaviour is asserted correctly, but every navigation assertion runs against a different module than production. The shim's must-be-first-import ordering is also enforced only by a comment rather than a `setupFiles` entry.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-the-application-shell.md`
  summary: The `--color-popover` exemption in the undeclared-variable sweep is keyed on the variable name, not on whether the component that draws it is rendered.
  evidence: Its stated justification is that `DrawerContent` is never rendered — true today, and nothing asserts it stays true. The name is an `@theme inline` key, so it emits no custom property; the moment a later story renders `DrawerContent`, its bleed layer resolves to nothing while the sweep stays green. The sweep is the repo's stated last line of defence against the stylesheet dropping a name a component still reads.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-the-application-shell.md`
  summary: `prefers-reduced-motion` is honoured only by the drawer; the nav item's `transition-colors` and the tooltip's enter animation are unguarded.
  evidence: The story's matrix names only the drawer slide, so this is outside its scope rather than a miss — but the repo now has one guarded animation and two unguarded ones, and the reduced-motion test measures only the drawer panel and overlay, so the gap is invisible to it.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-the-application-shell.md`
  summary: The drawer offers no close button — only backdrop, `Esc`, and following a link.
  evidence: Those three exits are exactly what `screen-dashboard-interaction.md` specifies, so the implementation is faithful to the contract. But the contract itself omits the affordance a touch user reaches for first, and this drawer is the mobile navigation for field staff on personal phones. A design decision to revisit, not an implementation defect.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-the-application-shell.md`
  summary: `company.membershipCount` is carried by the fixture and read by nothing.
  evidence: `CompanySwitcher` hardcodes the one-membership form rather than branching on it, so a `membershipCount: 2` fixture would silently render the wrong thing. The multi-company panel belongs to Story 1.6; the branch and its test belong there with it.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-the-application-shell.md`
  summary: The header date never rolls over at midnight on a long-lived tab.
  evidence: `useSyncExternalStore` is subscribed to a never-firing store, deliberately, so the value is a mount-time snapshot. In a product whose day boundary drives attendance and payroll periods, a tab left open overnight shows yesterday's date with no correction.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-the-application-shell.md`
  summary: The product's screen inventory now exists only in `components/shell/navigation.ts`.
  evidence: Ten destinations and a four-group information architecture were introduced without a line in `docs/05-modules.md` or anywhere else CLAUDE.md points a contributor. Two icon libraries also now ship — `lucide-react` survives, reachable from `components/ui/dialog.tsx` alone — with nothing recording whether it is being retired.

- source_spec: `_bmad-output/implementation-artifacts/spec-dom-test-harness.md`
  summary: The Playwright cache key is invalidated by any dependency change, not only a Playwright upgrade, and has no `restore-keys`.
  evidence: Observed on CI run 33045453865 — `Cache not found` because Story 1.3 added `@phosphor-icons/react`, changing the `package-lock.json` hash and forcing a fresh 114.7 MiB browser download. A reviewer raised this during the harness round and I rejected it on the grounds that the lockfile contains Playwright's version, which is true but incomplete: the key is correct yet far more sensitive than it needs to be. Keying on the resolved Playwright version, or adding `restore-keys`, would keep the browser across unrelated dependency bumps. Cost is ~20s per lockfile change, so this is cheap to leave and cheap to fix.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-tenant-isolation-harness.md`
  summary: The isolation gate cannot see a Supabase-specific permission failure, because bare Postgres is the more permissive substrate. A migration green in CI can still fail to apply to the real project.
  evidence: The gate runs `supabase migration up` against a stock `postgres:17` container — chosen deliberately, and measured: 31s cold against 541s for `supabase start`, 161MB against ~8.5GB across twelve containers, a full drop→migrate→sweep cycle in 2.22s against 15–26s. It proves every acceptance criterion, because all five are catalog or SQL facts. What it cannot prove is *applicability*: the container grants the migration role more than Supabase does. This is not hypothetical — `create function auth.tenant_id()` fails on a real project with `permission denied for schema auth (SQLSTATE 42501)` (migrations run as `postgres`; `auth` is owned by `supabase_admin`), and that exact defect sat in two architecture documents for a week. The mitigation shipped with this story is portability discipline in the migration itself: nothing is created outside `public`, and `anon`/`authenticated` creation is guarded with `do $$ … $$` because `create role` has no `if not exists` and both already exist on Supabase. The residual risk stands: the first `supabase db push` against a real project is still the first time these files meet the stricter substrate. Closing it needs either a scheduled job that applies migrations to a throwaway Supabase branch, or a lint pass over migration SQL for the specific things Supabase denies.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-tenant-isolation-harness.md`
  summary: The epic asks the isolation suite to assert **in-tenant** isolation per role tier; this story cannot, because no role tier exists yet.
  evidence: `epic-1-context.md` says "From this epic it also asserts in-tenant isolation per role tier" — `hr_staff` must not see salary, `staff` only its own row, `supervisor` only their reports. All of that needs `memberships` and `employees`, which Story 1.6 and Story 1.8 create; this story's Never list scopes it to `organizations` and `companies`. The substrate is ready for it: role-tier isolation inside one tenant was proved reachable on bare Postgres during this story's measurement pass, and `tests/isolation/support/substrate.ts` already switches roles per transaction. Story 1.6 must extend `Principal` with the claim-carried `role` and add the tier cases; nothing today would notice if it did not.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-tenant-isolation-harness.md`
  summary: `supabase_migrations` is excluded from catalog discovery outside the three-entry exemption allowlist.
  evidence: `RUNNER_SCHEMAS` in `tests/isolation/support/catalog.ts` drops the schema `supabase migration up` writes its own version rows into. It is not an application schema and holds no tenant data, so it is not an exemption from the tenant rule so much as a statement of where "our schema" ends — but it is a second place, next to `EXEMPTIONS`, where a name can be added to make the sweep look away. The exemption list is pinned to exactly three entries by a test; `RUNNER_SCHEMAS` is not pinned to one. Worth a decision at the next isolation-touching story rather than a silent precedent.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-tenant-isolation-harness.md`
  summary: `CLAUDE.md` rule 2 says `tenant_id` must lead **every** index; the sweep enforces "at least one index leads with it", and this migration's own `companies_organization_id_idx (organization_id, id)` violates the strict reading. **Needs a human decision — not changed here.**
  evidence: The strict reading is unsatisfiable as written: every table's `id uuid primary key` is a unique index whose leading column is `id`, so no table in the schema could ever comply, and Story 1.6's `memberships unique (user_id, company_id)` would violate it too. The enforced rule — every relation has at least one valid, non-partial index whose first column is the column its policy is keyed on — is the defensible one, and a reviewer agreed the document is what should move. It was left alone deliberately: `CLAUDE.md` is the project charter, and rewriting a non-negotiable rule on a reviewer's say-so is exactly the kind of change that should carry a human signature. Suggested replacement text: "RLS on every table, and every table must carry an index whose leading column is `tenant_id` — the access path every policy takes."

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-tenant-isolation-harness.md`
  summary: The first migration raises the Postgres floor to **16**, and nothing enforces that the Supabase project is provisioned there.
  evidence: `public.tenant_id()` and `public.auth_user_id()` use the `IS JSON` predicate (PG16+) to fail closed on a malformed claim. The alternative — a plpgsql `EXCEPTION` block — was rejected because an exception block opens a subtransaction, subtransactions are forbidden inside parallel workers, and the functions must be `parallel safe` or a single call disables parallel query for the whole statement. So "fails closed on a malformed claim" and "parallel safe" are only simultaneously satisfiable on PG16+. The CI container is `postgres:17`, so the gate can never catch a project provisioned on 15; that check has to happen at provisioning time.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-tenant-isolation-harness.md`
  summary: `companies` is deliberately readable **above** the active tenant claim, by the owner of its organization. That is a widening of the tenant boundary and it needs revisiting in Story 1.6.
  evidence: A fresh signup holds a `sub` and no `tenant_id`, so `insert into companies ... returning id` failed under a policy keyed on `id = tenant_id()` — the insert is permitted, the *readback* is not, and PostgREST sends `Prefer: return=representation` by default. Reproduced both ways. `companies_visible_to_org_owner` fixes it by keying SELECT on organization ownership, which is also what the company switcher needs (it must render the legal name and branch count of companies the user is *not* currently in). The consequence is that one principal owning two organizations sees both their companies while holding one tenant claim. That is correct for the boundary row and wrong for anything below it, and today's fixture cannot tell the difference because A and B own disjoint organizations. Story 1.6 replaces "organizations you own" with "companies you hold an active membership in", and should add a fixture where one principal spans two tenants so the distinction is actually asserted.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-tenant-isolation-harness.md`
  summary: The materialized-view rule is privilege-based and has never met a real aggregate.
  evidence: Postgres has no `alter materialized view ... enable row level security`, and a matview is populated as its owner at REFRESH time, so its only protection is that no request role can select it. The sweep enforces exactly that, and a negative control proves the rule fires. But the architecture calls for "aggregates from materialized views only", so Epic 3 will need a wrapping pattern — a `security_invoker` view over the matview, or a function — and none exists yet. The first team to add a matview will hit a red gate with no worked example to copy.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-tenant-isolation-harness.md`
  summary: The `stat_*` exemption is the one allowlist entry that lifts the purity assertion itself, not just a structural rule.
  evidence: `tenant_fixture` was added to `WaivableRule` so global statutory tables are not required to seed two tenants — they have no tenant dimension, so the assertion would be meaningless. It is defensible for `stat_*` and it is also the most dangerous waiver in the file: any future exemption claiming it removes the behavioural check entirely. `EXEMPTIONS` is pinned to exactly three by a test, which is what currently contains it. Nothing yet asserts that `stat_*` policies are read-only, which is the property that actually protects them; that belongs with Epic 5, when the tables exist.
