# Epic 1 Context: A company and its people exist in Aira

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

An HR manager signs up by email, registers their company, and imports ~200 employees from a spreadsheet with a validation preview — entirely self-serve. Underneath that thin story sits the whole non-retrofittable foundation: the repo scaffold and its enforced module boundaries, the design-system and shell layer every later screen renders inside, the organisation hierarchy, many-to-many memberships with tenant context in the JWT, dated assignments, integer rupiah, role-aware RLS, and an isolation suite blocking CI from the very first table. Everything after this epic is built on these choices, and each is expensive-to-impossible to change once client data exists.

## Stories

- Story 1.1: Scaffold the repository
- Story 1.2: Design system foundation
- Story 1.3: The application shell
- Story 1.4: Tenant isolation harness
- Story 1.5: Sign up by email and create a company
- Story 1.6: Membership, roles, and tenant context in the token
- Story 1.7: Company structure — branches, departments, positions
- Story 1.8: Employee records with dated assignments
- Story 1.9: Import employees from a spreadsheet
- Story 1.10: Personal data protection and the audit trail

## Requirements & Constraints

**Capabilities:** database-enforced tenant isolation (CAP-1); admin identity and membership with one active company per token (CAP-2); dated employee assignments (CAP-6); unassisted Excel import (CAP-7); role-restricted NIK/salary with an audit trail meeting UU PDP (CAP-9); the signup-and-import half of self-serve onboarding (CAP-30).

**Isolation is the hard gate.** `tenant_id` on every table (global `stat_*` and the pg-boss schema are the only allowlisted exemptions), RLS enabled *and* forced, tenant policy, and `tenant_id`-leading index — all in the same migration that creates the table. Policies wrap the claim as `(select auth.tenant_id())`; without the subquery Postgres re-evaluates per row. The suite discovers tables from the catalog rather than a hand-maintained list, asserts a non-empty fixture result before asserting tenant purity, sweeps for tables missing RLS or a policy, and blocks merges. From this epic it also asserts **in-tenant** isolation per role tier.

**Fixed role set.** `memberships.role` ∈ `admin|hr_manager|hr_staff|supervisor|staff|accountant`, as `text` + check constraint (never a Postgres enum); not tenant-customisable. `owner` is not a membership role — it lives on `organizations.owner_user_id`, above the tenant boundary. `hr_staff` must not see salary, so it is a separate tier from `admin`/`hr_manager`. `staff` sees only its own row; `supervisor` only employees whose current assignment `manager_id` resolves to them; `accountant` is external with null `employee_id`.

**Personal data.** NIK and salary reads are role-restricted and logged to `pii_access_logs` — **one row per request** (actor, field class `nik|salary`, scope, count exposed), never one per record. `audit_logs` stays mutation-shaped with `before`/`after`. Both partitioned by `created_at`. NIK, salary and PIN material are never written to logs.

**Other:** no Supabase Realtime (poll at 30s); aggregates from materialized views only; infra under 6% of revenue, which is why per-row permission lookups are forbidden. User-facing copy is Indonesian; code and docs English; regulatory terms stay Indonesian.

## Technical Decisions

**Repo shape.** One repo, two runtimes. `lib/domain` is pure and total — no `next/*`, no React, no db client, no I/O, clock or randomness — imported by both Next.js and `worker/index.ts`. Effects live at edges: `lib/db` (the only SQL), `app/` + `app/api/`, `worker/`. Purity is enforced by an ESLint import-boundary rule, not convention. Seed: `app/`, `app/api/`, `lib/domain/`, `lib/db/`, `worker/`, `supabase/migrations/`, `styles/`, `tests/golden/`, `tests/isolation/`.

**Scaffold.** `create-next-app --typescript --app --eslint --tailwind --no-src-dir --import-alias "@/*"`; `--no-src-dir` keeps `lib/` at root. The repo is not empty, so scaffold into a temp dir and merge. Three files collide: **keep the repo's `CLAUDE.md`** and append the starter's `@AGENTS.md` import (replacing it destroys the project charter); let `AGENTS.md` **coexist** with the `bmad-project-context` managed block, since `next dev` rewrites its own block every run; **union** `.gitignore`, never replace.

**Styling.** *(This paragraph was corrected after Story 1.2 — an earlier version of AD-36 stated the opposite theming rule and was wrong. Trust this text and `app/globals.css`, not older copies.)* Nocturne `styles.css` is vendored to `styles/nocturne.css` byte-identical and never edited — **token source only** (ramps, type, spacing, radius, elevation). Its nine component classes go unused. Components come from **shadcn on Base UI** (shadcn 4.x no longer defaults to Radix), copied into the repo, styled by Tailwind utilities resolving to Nocturne tokens. Arbitrary values (`p-[13px]`, `bg-[#9184d9]`) are lint-forbidden outside `components/ui/**`. Dark mode is the **`.dark` class** via `@custom-variant dark (&:is(.dark *))`; light lives on bare `:root`. Twelve `--ui-*` semantic variables (`nav, body, muted, faint, hover, track, tint, active-bg, active-fg, accent-text, link-hover, plus the four text roles as solid ramp steps`) are **not** part of Nocturne and are declared per theme in `app/globals.css`. Theming uses **`@theme inline` plus `var()` indirection** to raw values on `:root` and `.dark` — literals inside `@theme inline` are the trap, because Tailwind constant-folds them into the utility and the build still succeeds. Set `color-scheme`; resolve the `localStorage` key `aira-theme` in a blocking inline script before first paint (`app/theme-script.ts`).

**Auth and tenant context.** Supabase email auth. `companies.id` **is** the `tenant_id`, one legal entity per tenant, living in `app_metadata` and never `user_metadata`. A Custom Access Token Hook (a Postgres function) re-validates the membership is active, then injects `app_metadata.tenant_id`, `role` and `employee_id` — carrying role and employee id in claims is what keeps role-aware policies free of `memberships`/`employees` subqueries. Failure to resolve emits no `tenant_id` and fails closed. Token TTL is 15 minutes, the agreed staleness bound; authorization never queries `memberships` on a request path. Active company is `memberships.last_active_at` — the hook picks greatest `last_active_at`, tie-broken by `created_at`; switching updates it and forces a new token. No `service_role` in a request path; the only two tenant-context providers are the user JWT and a worker's explicit `set local`.

**Data model.** `organizations` (above the tenant boundary; `owner_user_id`, plan) → `companies` (legal name required; NPWP, NPP BPJS, BPJS Kesehatan code optional; `timezone` default `Asia/Jakarta`, accepting WIB/WITA/WIT) → `branches` (lat/long, `radius_m` default 100) → `departments` (indexed `ltree` `path`; `create extension if not exists ltree` in the first migration; descendants via an ltree operator, never a recursive CTE) → `positions`. `memberships` is many-to-many with `unique (user_id, company_id)`, nullable `employee_id`, `is_active`, `last_active_at`. `employees` has `unique (tenant_id, employee_no)`, nullable `user_id`, and JSONB `custom_fields` default `{}` — unrecognised import columns land there, never an `ALTER TABLE`. `employee_assignments` holds `branch_id`, `department_id`, `position_id`, `manager_id` (independent of the department tree), `employment_type` ∈ `pkwtt|pkwt|harian_lepas|borongan|magang`, and `valid_from`/`valid_to`; a transfer inserts a new row and closes the old one, never edits history. `payroll_calendar_id` is nullable here, with a comment recording that Epic 5 backfills it and adds `not null`.

**Conventions.** Plural snake_case tables, each with `id uuid`, `tenant_id uuid`, `created_at timestamptz`. Enums are `text` + check. Money is `bigint` in Postgres and a branded `Rupiah` integer in TS, constructible only through a rounding `rupiah(n)`, converted explicitly at the `lib/db` boundary. `timestamptz` UTC for timestamps, plain `date` for business dates, `companies.timezone` for day boundaries. Migrations are Supabase CLI files, forward-only, one concern each, never looping over tenants. Every mutation is a route handler with Zod validation at the boundary — Server Actions are not used; reads go through Server Components calling `lib/db`. A derived concept has exactly one implementation exported from `lib/domain` ("the assignment valid on date X" is written once there; `lib/db` fetches rows without re-deriving). Invariants that must survive every code path live in the database as constraints or triggers.

**Testing and CI.** Vitest; domain and golden suites run with **no database**. The isolation suite runs against a Supabase CLI local stack and is the blocking gate. CI runs lint, typecheck and test on every push. Sentry in both runtimes plus structured JSON to stdout; no log drains.

## UX & Interaction Patterns

**Shell at ≥1440px.** Grid `236px / minmax(0,1fr)`, `min-height: 100vh`, 13px base font; ground `--color-bg`, sidebar and cards `--color-surface`. Sidebar carries a brand mark over the plan line and four labelled nav groups (Ringkasan, Karyawan, Payroll, Pengaturan); the active item takes `--ui-active-bg`/`--ui-active-fg` plus an inset 1px accent ring and `aria-current="page"`. Header carries the company switcher pill (legal name plus branch count), date and timezone rendered from `companies.timezone`, theme toggle, notification bell, and an initials avatar with name and role.

**Responsive bands.** ≥1440 as drawn; 1200–1439 keeps the sidebar with tighter content padding; 1024–1199 and 768–1023 collapse it to a 64px icon rail; <768 an off-canvas drawer. Rail: icons only, group labels hidden, 44px item height, active ring kept (without a label it is the only cue), counts become a 6px accent dot, labels appear as tooltips on hover **and focus**. Drawer: 236px from the left over a dimmed backdrop, full labels at 44px, closing on backdrop click, `Esc`, and navigation, with focus trapped while open and returned to the trigger. Header degrades in order: date/timezone drops <1200px, the range control moves to its own row <1024px, the user block collapses to the avatar <768px while the switcher truncates but keeps its branch count.

**Company switcher.** One membership → a plain label, no caret, no menu. Otherwise a scrollable panel below-left, search only above 7 companies, current company marked with `--ui-active-bg` and a check. Switching is a session change, not a filter: the token is reissued, the page enters loading, and navigation returns to the **dashboard root** — a deep link from the previous company must not survive. On failure, fail closed to the tenant-resolution error state; never silently fall back.

**Touch and a11y.** At ≤1024px raise nav items and comparable rows to a 44px minimum via block padding only, leaving the type scale unchanged. Icon-only buttons need `aria-label`; the theme toggle's names the action, not the state. Focus is the design system's 2px accent ring at 2px offset — never overridden, never removed from rows that gain hover styling. Motion respects `prefers-reduced-motion: reduce`. `--ui-faint` at 10–11px likely fails 4.5:1 and must be contrast-checked; small accent labels move to `--color-accent-300` on the dark ground.

**Visual signatures.** The accent is a line and a glow, never a flood — the primary button is an accent outline, not a fill. Rules fade to transparent over 48px at each end. Elevation is a hairline edge plus ambient darkness; never stack heavy shadows. Icons are Phosphor regular, taken as a local dependency, not a runtime CDN load.

## Cross-Story Dependencies

- 1.1 gates everything: scaffold, purity lint rule, and CI must exist first.
- 1.2 gates 1.3 — the shell needs tokens, the `--ui-*` layer, theming, and shadcn initialised.
- 1.4 gates every later migration: `auth.tenant_id()`, the first policy pattern, and the catalog sweep must precede further tables; each new table extends the suite.
- 1.5 precedes 1.6 (a company must exist before a membership points at it); 1.6 precedes 1.7–1.10, which all need `tenant_id`, `role` and `employee_id` in the JWT.
- 1.7 precedes 1.8 (assignments reference branches, departments, positions); `ltree` is created in the first migration but first consumed here.
- 1.8 precedes 1.9 (the import writes employees and their initial assignments).
- 1.10 depends on claim-carried role from 1.6 and on the tables from 1.8.
- **Deferred to Epic 5:** backfill `employee_assignments.payroll_calendar_id` and add its `not null` constraint.
- **Deferred to Epic 2:** the employee half of CAP-2 — token-based email invitation, which also needs a transactional email provider (Supabase built-in email is rate-limited and not production-grade).
- **Consumed by Epic 3:** the Story 1.3 shell is the frame the dashboard renders inside; the payroll run card joins it only in Epic 6.
