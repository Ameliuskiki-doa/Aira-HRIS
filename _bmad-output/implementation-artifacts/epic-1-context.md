# Epic 1 Context: A company and its people exist in Aira

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Stand up the non-retrofittable foundation of the product and prove it works end to end: an HR manager signs up by email, registers their company, gets a real application frame around it, and imports 200 employees from their existing spreadsheet with a validation preview — with tenant *and in-tenant* isolation enforced by the database and proven by a blocking CI gate from the very first table. Everything in this epic is expensive or impossible to add later: the organisation hierarchy, many-to-many memberships, dated assignments, role-aware RLS, the design token layer, and the core-purity boundary. Nothing downstream can be trusted until these hold.

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

**Isolation is the product's survival condition.** Every table outside the global statutory reference tables carries `tenant_id`; RLS is enabled *and* forced; every index leads with `tenant_id`. A catalog-driven sweep must find zero unprotected tables in `public`, with only the `stat_*` tables and the job-runtime schema explicitly allowlisted. The isolation suite is a blocking CI gate, not an advisory test, and it must assert in-tenant isolation per role tier alongside cross-tenant isolation.

**Self-serve, no human contact.** A new client must reach a configured tenant unassisted in under 30 minutes. Signup and admin authentication is email. Importing 200 employees must produce a row-level validation report and a preview before anything is written, must write nothing while errors are unconfirmed, and must be idempotent on re-run after corrections.

**History must be answerable.** Where a person sat — branch, department, position, manager, employment type, payroll calendar — must be resolvable for any past date. A transfer in June must leave March unchanged. Unrecognised import columns go to a JSONB field; no per-tenant `ALTER TABLE`.

**Personal data is role-restricted and on the record.** NIK and salary are visible only to roles that need them; every read of that class writes one log row per *request* (with a record count), never one per record; every payroll-affecting mutation writes a before/after audit row. Both log tables are partitioned by creation time.

**Language.** Code, docs and identifiers are English; all user-facing copy is Indonesian; Indonesian regulatory terms stay Indonesian.

## Technical Decisions

**Repository shape.** One repo, two runtimes, one lockfile, one test command. Next.js App Router at root with `lib/` *not* under `src/`; `lib/domain` (pure core), `lib/db` (the only place SQL lives), `app/api` (route handlers), `worker/`, `supabase/migrations/`, `styles/`, `tests/{golden,isolation}`. The scaffold comes from the framework starter generated in a temp directory and merged in, because the repo already has files. Node ≥22.12, TypeScript, Tailwind v4, Vitest, Zod, shadcn on Radix.

**Core purity is lint-enforced.** `lib/domain` may not import framework modules, React, a database client, or anything doing I/O. This is an ESLint import-boundary rule, not a convention. A derived concept — notably "the assignment valid on date X" — has exactly one implementation, exported from `lib/domain`; `lib/db` fetches rows and does not re-derive.

**Migrations carry their own isolation.** Supabase CLI files, forward-only, one concern each. A table-creating migration must contain, in the same file: enable RLS, force RLS, the tenant policy, and the `tenant_id`-leading index. Never loop over tenants in a migration. Enums are `text` plus a check constraint, never Postgres enum types. Money columns are `bigint`; in TypeScript money is a branded integer constructed through a rounding factory, converted explicitly at the `lib/db` boundary. `ltree` must be created in the first migration and is what department subtree queries use — no recursive CTEs.

**Tenancy and identity.** `tenant_id` = `companies.id` = one legal entity. `organizations` sits *above* the tenant boundary (owner, billing) and is built now even for single-entity clients. Memberships are many-to-many from day one, unique per (user, company), with the active company stored as a timestamp on the membership row — resolved by greatest value, tie-broken deterministically. A Postgres-function access-token hook re-validates the membership is still active and injects `tenant_id`, `role` and `employee_id` into `app_metadata`; failure to resolve emits no `tenant_id` and access fails closed. Access token lifetime is 15 minutes; that is the agreed staleness bound, and authorization on a request path reads claims only — never the memberships table.

**RLS is role-aware, and the role set is fixed.** Policies wrap the claim as `(select auth.tenant_id())` so it is evaluated once, not per row, and they branch on the role claim rather than joining to memberships or employees. Roles are `admin`, `hr_manager`, `hr_staff`, `supervisor`, `staff`, `accountant`; `owner` lives above the tenant boundary. `hr_staff` does not see salary — it is a distinct tier from admin/hr_manager. `staff` sees only its own row; `supervisor` sees only employees whose current assignment reports to them. Not tenant-customisable.

**Two context providers only.** The user JWT on a request path, or an explicit per-transaction context set in a worker. There is never a third, and no `service_role` client is constructed in any request path.

**Mutations are route handlers** with Zod validation at the boundary — authenticate, validate, delegate, return. Server Actions are not used. Reads go through Server Components calling `lib/db`. Errors return a stable code plus an Indonesian user-facing message.

**Design tokens.** The Nocturne stylesheet is vendored byte-identical as the *token* source of truth (colour ramps, type, spacing, radius, elevation) and exposed to Tailwind through a **non-inline** `@theme`; its component classes go unused. Eleven `--ui-*` semantic variables are not part of it and must be declared in application CSS per theme, or screens render unstyled; the tint variable keeps the dark accent value in both themes. Components come from shadcn, copied into the repo, styled with those tokens. Arbitrary Tailwind values are lint-forbidden. Theming is CSS-defined (dark on `:root`, light on a data attribute) with `color-scheme` set and a blocking inline script resolving the stored preference before first paint — the two-stage pattern, since inline `@theme` breaks runtime switching. Dark is the default.

**Tests split by what they need.** Domain and golden-file tests run with no database. The isolation suite runs against a local Supabase stack and blocks CI. CI runs lint, typecheck and test on every push.

## UX & Interaction Patterns

**Shell.** 236px sidebar beside a fluid main column, 13px base size, ground and surface from tokens. Sidebar carries the brand mark, four labelled navigation groups, and a footer notice card; the active item takes the active background plus an inset accent ring **and** `aria-current="page"`. Header carries the company name with branch count, a range segmented control, date and timezone resolved from the company's stored timezone, a theme toggle, a notification bell, and the user block.

**Responsive floor, not a mobile redesign.** Five bands: as-drawn at ≥1440; softened column ratio at 1200–1439 (date/timezone line drops first); 64px icon rail plus single column at 1024–1199 (range control moves to its own full-width row); icon rail at 768–1023; off-canvas drawer below 768. The rail keeps the active ring, shows labels as tooltips on hover *and* focus, and replaces any count badge with a small accent dot. The drawer closes on backdrop click, Escape and navigation, traps focus while open, and returns focus to its trigger. At ≤1024px, interactive rows reach a 44px minimum via block padding only — the type scale does not change.

**Single-column stacking order is by decision urgency**, not source order, and is part of the spec.

**Company switcher.** Switching is a session change, not a filter: it updates the active membership, reissues the token, and returns to the dashboard root — a deep link from the previous company must not survive. On failure, fail closed to the tenant-resolution error state; never silently fall back. A search field appears only above seven companies; the current company is marked. A user with exactly one membership gets a plain label — no caret, no menu.

**Accessibility baseline.** Icon-only controls need accessible names (the theme toggle's names the action, not the state); segmented controls use the native-radio pattern rather than styled spans; the design system's focus ring is not to be overridden; reduced-motion is respected. Small text at the faintest token is likely below 4.5:1 and must be contrast-checked, with small accent-coloured labels moving up the accent ramp.

## Cross-Story Dependencies

- 1.1 (scaffold) precedes everything. 1.2 (tokens and theme) precedes 1.3 (shell), which is the frame every later screen sits in.
- 1.4 establishes the isolation migration pattern, `auth.tenant_id()`, and the CI gate. Every table-creating story after it (1.6, 1.7, 1.8, 1.10) must satisfy that gate in the same migration file.
- 1.6 must land before any role-aware policy: 1.10's policies depend on `role` and `employee_id` being present in token claims, and 1.5's company creation is what the token hook resolves against.
- 1.7 must precede 1.8 — assignments reference branches, departments and positions. 1.8 must precede 1.9, which writes employees and their initial assignments.
- 1.8 introduces a payroll-calendar reference on the assignment row that Epic 5 fills in; treat it as a forward reference, not a dependency to build here.
- 1.10 extends the 1.4 suite with per-role in-tenant assertions; the two share one harness.
- Downstream: Epic 2 depends on the branch geofence fields from 1.7, the nullable employee-to-user link from 1.8, and the token hook from 1.6. No story in this epic depends on a later epic.
