---
stepsCompleted: [1, 2]
inputDocuments:
  - ../specs/spec-aira-hris-payroll/SPEC.md
  - ../specs/spec-aira-hris-payroll/statutory-rules.md
  - ../specs/spec-aira-hris-payroll/data-model.md
  - ../specs/spec-aira-hris-payroll/stack.md
  - ../specs/spec-aira-hris-payroll/conventions.md
  - ../specs/spec-aira-hris-payroll/test-contract.md
  - ../specs/spec-aira-hris-payroll/commercial-model.md
  - ../specs/spec-aira-hris-payroll/roadmap.md
  - ../specs/spec-aira-hris-payroll/design-system.md
  - ../specs/spec-aira-hris-payroll/screen-dashboard.md
  - ../specs/spec-aira-hris-payroll/screen-dashboard-states.md
  - ../specs/spec-aira-hris-payroll/screen-dashboard-interaction.md
  - architecture/architecture-Aira-2026-08-20/ARCHITECTURE-SPINE.md
---

# Aira - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Aira, decomposing the requirements from SPEC-aira-hris-payroll, its UX design companions, and the architecture spine into implementable stories.

**Requirement identifiers are the SPEC's own `CAP-n` ids.** No parallel `FR-n` space is created: one id space runs from SPEC through epics, stories, and the capability→architecture map, so nothing has to be kept in sync. Non-functional requirements are numbered `NFR-n` — the SPEC carries constraints as unnumbered bullets, so this introduces no duplicate space — and each cites the `AD` that enforces it.

## Requirements Inventory

### Functional Requirements

**Foundation**

- **CAP-1** — Tenant isolation: every tenant's data isolated by the database, not application code, on one pooled schema.
- **CAP-2** — Identity and membership: authenticate, hold roles in several companies, exactly one active at a time.
- **CAP-3** — Statutory rate registry: TER, PTKP, BPJS and overtime rates as dated, tenant-uneditable reference data.
- **CAP-4** — Job runtime: long-running work off the request path, idempotent, resumable, concurrency-capped.
- **CAP-5** — Attendance photo storage: capture, store and serve photos without egress becoming the dominant cost.

**Employee and organisation**

- **CAP-6** — Employee records with dated assignments; where a person sat is answerable for any past date.
- **CAP-7** — Excel import: a new client loads their existing spreadsheet unassisted.
- **CAP-8** — Salary components: parameterised types plus treatment flags, never a formula.
- **CAP-9** — Personal data protection: NIK and salary role-restricted and logged; UU PDP obligations met.

**Attendance, leave, shifts**

- **CAP-10** — Clock in/out with geofence and photo evidence.
- **CAP-11** — Offline attendance sync that cannot duplicate on reconnect.
- **CAP-12** — Night-shift attribution: one shift is one row, keyed to the shift's start date.
- **CAP-13** — Attendance locking, with audited post-lock corrections.
- **CAP-14** — Recap and aggregate reporting from materialized views.
- **CAP-15** — Leave: requests, balances, carry-over, conflict detection.
- **CAP-16** — Shift scheduling: templates, bulk assignment, coverage view.

**Payroll**

- **CAP-17** — Payroll calendars and periods; both pay models, tax month from payment date.
- **CAP-18** — Gross-to-net pipeline where every number is explainable from stored data.
- **CAP-19** — Overtime from a dated rate table on a flag-defined base.
- **CAP-20** — PPh21: TER monthly, progressive annual reconciliation in December.
- **CAP-21** — BPJS: five programs, employer and employee sides, dated caps, per-company risk class.
- **CAP-22** — THR as its own run on its own base.
- **CAP-23** — Run immutability; corrections are a new run, never an edit.
- **CAP-24** — Year-to-date, maintained and importable for mid-year onboarding.
- **CAP-25** — Payslip: immutable snapshot plus PDF.
- **CAP-26** — Statutory and financial exports: bank file, 1721-A1, BPJS, journal CSV.

**Process and commercial**

- **CAP-27** — Approval engine routing to positions, surviving people leaving.
- **CAP-28** — Configuration: dated, preset-seeded, dry-run before commit.
- **CAP-29** — Billing and subscription; overdue degrades to read-only, never blocked.
- **CAP-30** — Self-serve onboarding: signup to finished payroll with zero human contact.
- **CAP-31** — Support deflection: knowledge base, videos, WhatsApp bot.

### NonFunctional Requirements

- **NFR-1** — `tenant_id` on every table except global `stat_*`; RLS enabled **and** forced; every index leads with `tenant_id`. *(AD-5, AD-16, AD-18)*
- **NFR-2** — Policies wrap claims as `(select public.tenant_id())`; without the subquery Postgres re-evaluates per row. *(AD-18)*
- **NFR-3** — `tenant_id` = `company_id` = one legal entity; lives in `app_metadata`, never `user_metadata`. *(AD-8, AD-10)*
- **NFR-4** — Workers never use `service_role`; no cross-tenant bypass role; exactly two tenant-context providers. *(AD-6, AD-16)*
- **NFR-5** — Money is integer rupiah, rounded per component at write; gross and net are exact sums of stored lines. *(AD-13, AD-14)*
- **NFR-6** — Payroll-affecting data is versioned `valid_from`/`valid_to`, never overwritten. *(AD-11)*
- **NFR-7** — A locked run is immutable through every code path including the worker; enforced in the database. *(AD-27)*
- **NFR-8** — Payroll calculation is a pure function of its snapshot; the same inputs always produce the same output. *(AD-11, AD-12, AD-26)*
- **NFR-9** — Statutory rates are seeded, dated, and writable only by the migration role. *(AD-27)*
- **NFR-10** — Photos upload client → R2 via signed URL; bytes never pass through a route handler. *(AD-20)*
- **NFR-11** — No Supabase Realtime; poll at 30s. Aggregate reporting from materialized views only. *(AD-17)*
- **NFR-12** — Every job is idempotent, keyed, resumable from recorded progress; failures surfaced, never swallowed. *(AD-3, AD-6, AD-19)*
- **NFR-13** — Clock in/out under 500ms p95; monthly recap for 500 employees under 2s; payroll for 500 under 5 min; payslip PDF under 3s.
- **NFR-14** — The tenant isolation suite is a blocking CI gate; golden files run with no database. *(AD-21)*
- **NFR-15** — Access token TTL is 15 minutes; authorization reads claims, never the `memberships` table on a request path. *(AD-9, AD-25)*
- **NFR-16** — Infra under 6% of revenue, roughly USD 180/month at 100 clients / 4.000 employees.
- **NFR-17** — All mutations are route handlers with Zod validation; Server Actions are not used. *(AD-15)*
- **NFR-18** — `lib/domain` is pure: no `next/*`, no React, no database client, no I/O. Enforced by lint. *(AD-2)*
- **NFR-19** — A derived concept has exactly one implementation, exported from `lib/domain`. *(AD-23)*
- **NFR-20** — User-facing strings are English; code and docs English; Indonesian regulatory terms (PPh21, BPJS, PKWT, THR, lembur) stay Indonesian. *(Reversed 2026-08-27 at the owner's direction; was Indonesian.)*
- **NFR-21** — NIK, salary figures and PIN material are never logged. *(AD-19)*
- **NFR-23** — In-tenant isolation: an employee session reads only its own row; `hr_staff` never sees salary. The isolation suite tests this **alongside** cross-tenant isolation. *(AD-31, AD-33)*
- **NFR-24** — Attendance capture does not depend on a live access token; authentication happens at sync. *(AD-30)*
- **NFR-25** — Clock-in trust is a bundle: bound device, server-side plausibility, EXIF and timestamp checks, retained selfie. GPS is never the single point of trust. *(AD-32)*
- **NFR-26** — The role set is fixed and not tenant-customisable; flexibility lives in approval configuration and assignments. *(AD-33)*
- **NFR-22** — Every rate marked `VERIFY` is source-checked against DJP / BPJS / Kemnaker before seeding.

### Additional Requirements

**🚨 STARTER TEMPLATE — affects Epic 1 Story 1.** The architecture binds `create-next-app` with `--typescript --app --eslint --tailwind --no-src-dir --import-alias "@/*"` (AD-28). `--no-src-dir` is required so `lib/` sits at root per AD-1. **The repo is not empty** (`docs/`, `_bmad/`, `_bmad-output/`, `.claude/`, `CLAUDE.md`, `.mcp.json`), and `create-next-app` refuses to write into a directory with conflicting files — so the scaffold is created in a temporary directory and merged in. The starter's generated `AGENTS.md` is replaced by the `bmad-project-context` managed block. **Tailwind is taken:** components come from shadcn on Base UI (AD-36), styled by utilities that resolve to Nocturne tokens. Nocturne supplies tokens only; its component classes go unused.

- Single repo, two runtimes: `lib/domain` imported by both Next.js (dry-run) and `worker/index.ts` (batch). *(AD-1)*
- ESLint import-boundary rule enforcing core purity. *(AD-2)*
- pg-boss 12.27.0 on the existing Postgres; its schema is a documented exemption from the isolation sweep. *(AD-3, AD-5)*
- Connection policy: serverless via Supavisor transaction mode; worker holds a direct session connection for LISTEN/NOTIFY. *(AD-4)*
- Supabase email auth for signup and admin; Custom Access Token Hook as a Postgres function injecting `app_metadata.tenant_id`. *(AD-7, AD-10)*
- `create extension ltree` in the first migration — available on the project but not installed.
- Migrations are Supabase CLI files, forward-only, each table-creating migration carrying RLS, policy and index in the same file. *(AD-18)*
- All scheduling in pg-boss cron; `pg_cron` not used. Monthly partition provisioning for `attendances` and `audit_logs`, three months ahead. *(AD-17)*
- Sentry in both runtimes; structured JSON to stdout; no log drains. *(AD-19)*
- Vercel Spend Management set to hard pause; WAF on media routes.
- Deployment: Vercel from repo root, worker on Railway or Fly from the same commit; the run pins its domain version. *(AD-26)*
- Environments: one production Supabase project, staging on free tier, branches only while in use.
- Token-based employee invitation; no admin invite API, no `service_role`. *(AD-29)*
- The AD-10 hook carries `role` **and** `employee_id` in claims so role-aware policies need no subquery. *(AD-31)*
- `memberships.role` enum is `admin|hr_manager|hr_staff|supervisor|staff|accountant`; `owner` lives on `organizations.owner_user_id` above the tenant boundary. *(AD-33)*
- A transactional email provider is required — Supabase built-in email is rate-limited and not for production volume. *(AD-29)*
- `payroll_items.meta` carries a fixed envelope: `inputs`, `basis`, `rate`, `source`. *(AD-24)*

### UX Design Requirements

- **UX-DR1** — Declare the eleven `--ui-*` semantic tokens (`body`, `muted`, `faint`, `nav`, `hover`, `track`, `tint`, `active-bg`, `active-fg`, `accent-text`, `link-hover`) per theme in application CSS. They are **not** part of Nocturne; without them the dashboard renders unstyled. *(AD-22)*
- **UX-DR2** — Vendor Nocturne `styles.css` unmodified as the **token** source of truth and feed it to Tailwind v4 via `@theme inline` with `var()` indirection. Its nine component classes go unused. Components come from shadcn on Base UI, copied into the repo and styled with those tokens. Arbitrary Tailwind values (`p-[13px]`) are lint-forbidden. *(AD-22, AD-36)*
- **UX-DR3** — Theme system in CSS: raw values on `:root` and `.dark`, mapped through **`@theme inline` with `var()` indirection**. Never literals inside `@theme inline` — Tailwind folds them to constants and theming dies with a green build. Dark mode is the `.dark` class per shadcn's `@custom-variant`. `color-scheme` set to match. A blocking inline script resolves the stored preference from `localStorage` key `aira-theme` before first paint. Do not port the artboard's JS variable injection.
- **UX-DR4** — Build five shared components: `Skeleton`, `EmptyBlock`, `ErrorBlock`, `FreshnessStamp`, `OnboardingChecklist`. Every region then needs only a state discriminator.
- **UX-DR5** — Skeleton timing: nothing before 200ms, 400ms minimum once shown, "taking longer" line past 10s, region error past 30s. Fill `--ui-track`, opacity pulse only, never the accent, disabled under `prefers-reduced-motion`.
- **UX-DR6** — Day-0 onboarding checklist replacing the stat row and two-column grid: six steps (import, branches, config preset, payroll calendar, YTD, dry-run), with the YTD step rendered only when onboarding after January. Never render zeroed stat cards.
- **UX-DR7** — Steady-state-clear empty states for Needs action, Compliance warnings, Audit trail and holiday attendance, worded as confirmations; card height must not collapse below its populated minimum.
- **UX-DR8** — Between-periods payroll card: next period with derived tax month, "Belum dimulai" tag, last completed run summary, and a start action gated on attendance being locked.
- **UX-DR9** — Calculating state: determinate progress as "{n} dari {total} karyawan", totals rendered as skeleton **not zeros**, breakdown hidden, polled at 30s.
- **UX-DR10** — Page-level tenant-resolution failure fails closed: no sidebar, no company name, no cached figures, **no retry button**, support reference code.
- **UX-DR11** — Region-level error block keeping the card frame and heading; four distinct causes (timeout, view unavailable, fetch failure, offline); no semantic colour — Nocturne has none.
- **UX-DR12** — Payroll job-failed state with job reference and a rerun action, stating explicitly that rerun is safe and resumes from progress.
- **UX-DR13** — Stale-data freshness stamp on CAP-14 surfaces, escalating to a region error past 24 hours.
- **UX-DR14** — Read-only mode: banner, all data rendered normally with no blur or lock overlay, mutations disabled at 45% opacity, export and payslip download **still enabled**.
- **UX-DR15** — Five responsive bands: ≥1440 as drawn, 1200–1439 softened ratio, 1024–1199 icon rail plus single column, 768–1023 icon rail, <768 off-canvas drawer. Sidebar collapses to a 64px icon rail with tooltips and a 6px dot instead of a count.
- **UX-DR16** — Single-column stacking order is by decision urgency: payroll run, needs action, compliance warnings, attendance table, audit trail.
- **UX-DR17** — Attendance table in an `overflow-x: auto` container; page body never scrolls horizontally; sticky outlet column below 1024px; row-rule fade tracks table width, not viewport.
- **UX-DR18** — 44px minimum touch targets at ≤1024px, achieved by block padding so the type scale is unchanged.
- **UX-DR19** — Company switcher panel: search above 7 companies, current company marked, selection reissues the token and returns to the dashboard root; single-company tenants render a plain label with no caret.
- **UX-DR20** — Notification bell: unread **dot, not a count** (Approvals owns the count); panel grouped by today/earlier; eight event types each declaring its channel, only job-failed and payment-failed going per-event to WhatsApp.
- **UX-DR21** — Fix four artboard accessibility defects: breakdown rows become `<button aria-expanded aria-controls>`; the range control uses Nocturne's native-radio `.seg-opt` pattern; icon-only buttons get accessible names; the active nav item gets `aria-current="page"`.
- **UX-DR22** — Progress bars carry `role="progressbar"` with values or are `aria-hidden` with adjacent text; table gets a caption; loading regions carry `aria-busy`; completion announced via `aria-live="polite"`.
- **UX-DR23** — Implement the loaded dashboard per `screen-dashboard.md`: 236px sidebar, header with company switcher and range control, five stat cards, payroll run card with expandable component breakdown, attendance-by-outlet table, and the three right-column cards.
- **UX-DR24** — `--ui-faint` at 10–11px is likely below 4.5:1 and must be contrast-checked; small accent-coloured labels move to `--color-accent-300` on the dark ground per the Nocturne readme.

### FR Coverage Map

| CAP | Epic | Slice |
|---|---|---|
| CAP-1 | Epic 1 | Tenant + in-tenant isolation, proven by a blocking CI gate |
| CAP-2 | Epic 1 (admin auth, hook, roles) · Epic 2 (employee invitation) | One active company per token; role and employee_id in claims |
| CAP-3 | Epic 5 | Dated statutory rate registry, seeded |
| CAP-4 | Epic 2 | Job runtime — first consumer is photo thumbnails |
| CAP-5 | Epic 2 | Client-compressed upload direct to R2 |
| CAP-6 | Epic 1 | Employee records with dated assignments |
| CAP-7 | Epic 1 | Excel import with validation preview |
| CAP-8 | Epic 5 | Salary components and treatment flags |
| CAP-9 | Epic 1 | Role-restricted NIK and salary, audit log, UU PDP |
| CAP-10 | Epic 2 | Geofenced clock-in with photo and the anti-spoof bundle |
| CAP-11 | Epic 2 | Offline queue, idempotent sync |
| CAP-12 | Epic 2 | Night-shift attribution to the start date |
| CAP-13 | Epic 2 | Attendance locking and audited corrections |
| CAP-14 | Epic 2 (views) · Epic 3 (attendance surface) · Epic 6 (payroll card) | The dashboard ships attendance-first; its own state spec covers the no-payroll case |
| CAP-15 | Epic 4 | Leave requests, balances, carry-over |
| CAP-16 | Epic 2 | Shift templates and bulk assignment |
| CAP-17 | Epic 5 | Payroll calendars and periods, both pay models |
| CAP-18 | Epic 6 | Gross-to-net pipeline, every figure traceable |
| CAP-19 | Epic 6 | Overtime from a dated rate table |
| CAP-20 | Epic 6 | PPh21 TER and December reconciliation |
| CAP-21 | Epic 6 | BPJS, five programs |
| CAP-22 | Epic 7 | THR as its own run |
| CAP-23 | Epic 6 | Run immutability, database-enforced |
| CAP-24 | Epic 6 | YTD maintained and importable |
| CAP-25 | Epic 7 | Payslip snapshot and PDF |
| CAP-26 | Epic 7 | Bank file, 1721-A1, BPJS, journal CSV |
| CAP-27 | Epic 4 | Approval engine routing to positions |
| CAP-28 | Epic 5 | Dated config, presets, dry-run |
| CAP-29 | Epic 8 | Billing, dunning, read-only degrade |
| CAP-30 | Epic 1 (signup + import) · Epic 8 (rest) | Self-serve onboarding end to end |
| CAP-31 | Epic 8 | Support deflection |

All 31 capabilities are covered. No epic depends on a later epic.

## Epic List

### Epic 1: A company and its people exist in Aira
An HR manager signs up by email, their company exists inside the product's own frame, and 200 employees are imported from a spreadsheet with a validation preview — with tenant **and in-tenant** isolation proven by a blocking CI gate from the very first table.
**CAPs covered:** CAP-1, CAP-2 (admin auth), CAP-6, CAP-7, CAP-9, CAP-30 (signup and import)

### Epic 2: Attendance is recorded from the floor
Employees are invited by email and clock in and out from their own phone against a server-side geofence with a photo — offline-safe, un-duplicatable, and hard to spoof. HR locks the period when it is done.
**CAPs covered:** CAP-2 (employee invitation), CAP-4, CAP-5, CAP-10, CAP-11, CAP-12, CAP-13, CAP-14 (materialized views), CAP-16

### Epic 3: The day is visible
The dashboard, in its attendance form: is today's attendance normal across every outlet, what is expiring or missing, and what needs a decision. It renders correctly with no payroll run because its own state specification already covers that case — the payroll card joins it in Epic 6.
**CAPs covered:** CAP-14 (surface), UX-DR1–UX-DR24 except the payroll-run regions

### Epic 4: Leave and approvals
Employees request leave, approvers decide it, balances stay correct across the year boundary — on an approval engine that routes to positions, survives an approver resigning, and is reused later by overtime and correction requests.
**CAPs covered:** CAP-15, CAP-27

### Epic 5: Pay is configured
A client picks an industry preset, sets salary components and a payroll calendar, and sees sample payslips from a dry-run before anything is committed. Statutory rates are seeded, dated, and beyond the tenant's reach.
**CAPs covered:** CAP-3, CAP-8, CAP-17, CAP-28
**Inherited obligation:** backfill `employee_assignments.payroll_calendar_id` and add its `not null` constraint, deferred from Epic 1.

### Epic 6: Payroll runs
HR runs payroll for a period. Every figure traces to its inputs, the run locks immutably, corrections are a new run, and a mid-year joiner still reconciles correctly in December. Closes by adding the payroll run card to the dashboard built in Epic 3.
**CAPs covered:** CAP-18, CAP-19, CAP-20, CAP-21, CAP-23, CAP-24

### Epic 7: People are paid and the filings exist
Employees receive a payslip that is complete and permanent; HR gets a bank transfer file that validates, plus the statutory and accounting exports. THR runs on its own base.
**CAPs covered:** CAP-22, CAP-25, CAP-26

### Epic 8: It sells without being touched
Signup to a finished payroll with zero human contact: onboarding, billing at organisation level, dunning, read-only degrade that never blocks payslip access, and support deflected rather than staffed.
**CAPs covered:** CAP-29, CAP-30 (remainder), CAP-31

---

## Epic 1: A company and its people exist in Aira

An HR manager signs up by email, their company exists, and 200 employees are imported from a spreadsheet with a validation preview — with tenant **and in-tenant** isolation proven by a blocking CI gate from the very first table. This epic carries the non-retrofittable foundation: the organisation hierarchy, many-to-many memberships, dated assignments, integer rupiah, and role-aware RLS.

**CAPs:** CAP-1, CAP-2 (admin auth), CAP-6, CAP-7, CAP-9, CAP-30 (signup and import)
**Key ADs:** AD-1, AD-2, AD-7, AD-8, AD-9, AD-10, AD-14, AD-15, AD-16, AD-18, AD-21, AD-22, AD-23, AD-25, AD-27, AD-28, AD-31, AD-33
**UX-DRs:** UX-DR1, UX-DR2, UX-DR3, UX-DR15, UX-DR16, UX-DR18, UX-DR19 (single-company case), UX-DR21 (partial)

### Story 1.1: Scaffold the repository

As a developer,
I want the repository scaffolded with the bound structure and its boundaries enforced,
So that every later story lands in the right place and cannot quietly violate core purity.

**Acceptance Criteria:**

**Given** a repository containing `docs/`, `_bmad/`, `.claude/` and `CLAUDE.md`
**When** the scaffold is created with `create-next-app --typescript --app --eslint --tailwind --no-src-dir --import-alias "@/*"` in a temporary directory and merged in
**Then** no pre-existing file is overwritten
**And** `lib/` sits at the repository root, not under `src/`
**And** Tailwind v4 is present and configured (its tokens are wired in Story 1.2).

**Given** the scaffold is merged
**When** the tree is inspected
**Then** `app/`, `app/api/`, `lib/domain/`, `lib/db/`, `worker/`, `supabase/migrations/`, `styles/` and `tests/` exist
**And** the starter's generated `AGENTS.md` has been replaced by the `bmad-project-context` managed block.

**Given** a file in `lib/domain/` that imports `next/headers`, `react`, or a database client
**When** lint runs
**Then** it fails with an import-boundary error naming the forbidden import.

**Given** the repository
**When** `npm test` runs
**Then** Vitest executes and reports zero tests without error
**And** CI runs lint, typecheck and test on every push.

### Story 1.2: Design system foundation

As a developer,
I want Nocturne's tokens driving Tailwind and shadcn installed on top,
So that every screen afterwards is accessible by default, themed correctly, and unmistakably this product rather than a generic starter.

**Acceptance Criteria:**

**Given** the Nocturne design system, which lives in the Claude Design project `dcaaa7ad-e795-4fad-8b3e-223f30a4ad1d` at `_ds/nocturne-ee56407c-8063-417c-bf1f-fe655f93985a/styles.css`
**When** it is fetched and vendored to `styles/nocturne.css`
**Then** the file is byte-identical to the source and is never edited
**And** its colour ramps, type, spacing, radius and elevation tokens reach Tailwind through `@theme inline` with `var()` indirection to raw values
**And** none of its nine component classes are used by application code.

**Given** the eleven `--ui-*` semantic variables the screens depend on
**When** application CSS is loaded
**Then** all eleven resolve to a value in both themes
**And** `--ui-tint` keeps the dark accent hex in both themes.

**Given** a user who previously selected the light theme
**When** they load any page
**Then** the page paints in light on first paint with no flash of dark
**And** the preference is read from `localStorage` key `aira-theme` by a blocking inline script
**And** `color-scheme` is set to match
**And** runtime switching works in a **nested** subtree, not only on the root element — proving `@theme inline` with `var()` indirection rather than literals or a non-inline `@theme`.

**Given** shadcn is initialised on Base UI
**When** a component is added
**Then** its component files are copied into the repository and are editable source
**And** it renders using Nocturne tokens, not shadcn's default palette
**And** dark mode fires through the `.dark` class.

**Given** a component or page written with an arbitrary Tailwind value such as `p-[13px]` or `bg-[#9184d9]`
**When** lint runs
**Then** it fails, naming the token that should have been used instead.

**Given** no stored preference
**When** the page loads
**Then** the dark theme applies, matching the Nocturne `:root` defaults.

### Story 1.3: The application shell

As an HR manager,
I want the product to have its frame — navigation, header, and theme — from the first screen,
So that every page I use afterwards sits in one consistent, recognisable product rather than a series of bare forms.

**Acceptance Criteria:**

**Given** the shell
**When** it renders at 1440px
**Then** the layout is a 236px sidebar beside a fluid main column at a 13px base size
**And** the sidebar carries the brand mark, four labelled navigation groups, and an active item marked with `--ui-active-bg` and its inset accent ring
**And** the active item carries `aria-current="page"`.

**Given** the header
**When** it renders
**Then** it shows the company name with branch count, the date and timezone resolved from `companies.timezone`, the theme toggle, and the user block with initials, name and role
**And** every icon-only button has an accessible name.

**Given** a viewport below 1024px
**When** the shell renders
**Then** the sidebar collapses to a 64px icon rail with tooltips on hover and on focus
**And** navigation items are at least 44px tall.

**Given** a viewport below 768px
**When** the shell renders
**Then** the sidebar becomes an off-canvas drawer opened from a header control
**And** it closes on backdrop click, on `Esc`, and on navigation
**And** focus is trapped while open and returns to the trigger on close.

**Given** the content area
**When** no page has been built into it yet
**Then** the shell renders an empty content region without layout errors in either theme.

**Given** a user holding exactly one membership
**When** the header renders
**Then** the company name is a plain label with no caret and no menu.

### Story 1.4: Tenant isolation harness

As a developer,
I want tenant isolation enforced by the database and proven by a blocking test before any real data exists,
So that a cross-tenant leak is caught by CI rather than by a client.

**Acceptance Criteria:**

**Given** the first migration
**When** it creates `organizations` and `companies`
**Then** the same file enables row level security, forces it, creates the tenant policy, and creates a `tenant_id`-leading index
**And** it creates the `public.tenant_id()` function as a `stable` function reading `app_metadata`.

**Given** any tenant policy in the codebase
**When** it is inspected
**Then** the claim is wrapped as `(select public.tenant_id())`.

**Given** fixtures for two tenants
**When** the isolation suite runs as tenant A
**Then** every table carrying `tenant_id` returns only tenant A rows
**And** the fixture sanity check confirms the result set is non-empty.

**Given** the `public` schema
**When** the catalog sweep runs
**Then** it reports zero tables without RLS enabled and a policy
**And** the allowlisted exemptions are named explicitly and are exactly three: `stat_*`, the pg-boss schema, and the tables at or above the tenant boundary (`organizations`, `companies`), which are exempt from the `tenant_id` **column** requirement only and still require RLS, force, and a policy.

**Given** a pull request that adds a table without a policy
**When** CI runs
**Then** the build fails and the merge is blocked.

### Story 1.5: Sign up by email and create a company

As an HR manager,
I want to sign up with my email and register my company,
So that I have a tenant of my own without anyone from Aira touching the account.

**Acceptance Criteria:**

**Given** a visitor with a valid email address
**When** they complete signup
**Then** a Supabase auth user is created
**And** an `organizations` row is created with them as `owner_user_id`
**And** a `companies` row is created and its `id` becomes the `tenant_id`.

**Given** the company registration form
**When** it is submitted
**Then** legal name is required, NPWP, NPP BPJS and BPJS Kesehatan code are optional
**And** timezone defaults to `Asia/Jakarta` and accepts WIB, WITA or WIT.

**Given** any input reaching a route handler
**When** it is processed
**Then** it is validated with Zod at the boundary
**And** no `service_role` client is constructed anywhere in the request path.

**Given** signup completes
**When** the user lands in the application
**Then** all user-facing copy is English, apart from Indonesian regulatory terms.

### Story 1.6: Membership, roles, and tenant context in the token

As an HR manager,
I want my session to carry which company I am acting in and what I am allowed to see,
So that the database can enforce my access without the application asking it to.

**Acceptance Criteria:**

**Given** the `memberships` table
**When** it is created
**Then** it enforces `unique (user_id, company_id)`
**And** it carries `last_active_at`, which is where the active company lives
**And** `role` accepts only `admin`, `hr_manager`, `hr_staff`, `supervisor`, `staff` or `accountant` via a check constraint, not a Postgres enum
**And** `employee_id` is nullable.

**Given** a user with an active membership
**When** an access token is issued
**Then** a Custom Access Token Hook implemented as a Postgres function injects `app_metadata.tenant_id`, `app_metadata.role` and `app_metadata.employee_id`
**And** the hook re-validates that the membership is still active before injecting.

**Given** a user whose membership was deactivated
**When** their token is refreshed
**Then** no `tenant_id` is injected and access fails closed.

**Given** the project's auth settings
**When** an access token is issued
**Then** its lifetime is 15 minutes.

**Given** a user holding memberships in two companies
**When** they switch company
**Then** `last_active_at` is updated on the chosen membership and a new token is issued carrying the new `tenant_id`
**And** the hook resolves the active membership by greatest `last_active_at`, tie-broken by `created_at`
**And** no query returns rows from both companies.

### Story 1.7: Company structure — branches, departments, positions

As an HR manager,
I want to set up my outlets, departments and positions,
So that employees can be assigned somewhere and approvals have something to route to.

**Acceptance Criteria:**

**Given** the migration creating `departments`
**When** it runs
**Then** `create extension if not exists ltree` has been executed
**And** `departments.path` is an indexed `ltree` column.

**Given** a department tree three levels deep
**When** all descendants of a node are queried
**Then** the result comes from an `ltree` operator with no recursive CTE.

**Given** a branch
**When** it is created
**Then** latitude, longitude and a radius in metres can be set, with radius defaulting to 100.

**Given** each of `branches`, `departments` and `positions`
**When** its migration is inspected
**Then** it carries `tenant_id`, RLS enabled and forced, a tenant policy, and a `tenant_id`-leading index in the same file.

### Story 1.8: Employee records with dated assignments

As an HR manager,
I want an employee's branch, department, position and manager to be recorded with effective dates,
So that a transfer today never changes what a past payroll period looked like.

**Acceptance Criteria:**

**Given** the `employees` table
**When** it is created
**Then** it enforces `unique (tenant_id, employee_no)`
**And** `user_id` is nullable
**And** `custom_fields` is a JSONB column defaulting to an empty object.

**Given** an employee assigned to Department A from 1 January
**When** a new assignment to Department B effective 1 June is recorded
**Then** a new `employee_assignments` row is inserted and the existing row is closed with `valid_to`
**And** the January row is not modified.

**Given** an employee who moved departments in June
**When** their assignment on 15 March is queried
**Then** Department A is returned.

**Given** the resolution of "the assignment valid on date X"
**When** the codebase is inspected
**Then** exactly one implementation exists, exported from `lib/domain`
**And** `lib/db` fetches rows without re-deriving it.

**Given** `payroll_calendars` does not exist until Epic 5
**When** the `employee_assignments` migration runs
**Then** `payroll_calendar_id` is nullable
**And** a comment records that Epic 5 backfills it and adds the `not null` constraint.

**Given** an employee assignment
**When** it is created
**Then** `manager_id` is stored independently of `department_id`
**And** `employment_type` accepts only `pkwtt`, `pkwt`, `harian_lepas`, `borongan` or `magang`.

### Story 1.9: Import employees from a spreadsheet

As an HR manager,
I want to upload my existing employee spreadsheet and see what will happen before it is saved,
So that I can onboard 200 people myself without calling anyone.

**Acceptance Criteria:**

**Given** a spreadsheet of 200 employees
**When** it is uploaded
**Then** a validation report lists every row-level error with its row number and reason
**And** a preview of what will be created is shown before anything is written.

**Given** a validation report containing errors
**When** the user has not confirmed the preview
**Then** no employee row is written.

**Given** an import that partially failed
**When** the corrected file is uploaded again
**Then** rows already imported are not duplicated
**And** the operation is idempotent on re-run.

**Given** a spreadsheet containing a column the system does not recognise
**When** it is imported
**Then** the value is stored in `custom_fields`
**And** no `ALTER TABLE` is issued.

**Given** the import of 200 employees
**When** it is confirmed
**Then** it completes without a request timeout.

### Story 1.10: Personal data protection and the audit trail

As an HR manager,
I want salary and NIK visible only to the roles that need them and every change on the record,
So that the system is defensible under UU PDP and credible in a sales conversation.

**Acceptance Criteria:**

**Given** a session whose claim role is `hr_staff`
**When** employee records are read
**Then** salary fields are not returned
**And** one `pii_access_logs` row is written for the request, naming the field class, the scope and the count of records exposed.

**Given** a list view exposing 200 employees' salary
**When** it is read
**Then** exactly **one** `pii_access_logs` row is written with `record_count` 200
**And** `audit_logs` is not written to, because no mutation occurred.

**Given** a session whose claim role is `staff`
**When** employee records are read
**Then** only their own `employee_id` row is returned.

**Given** a session whose claim role is `supervisor`
**When** employee records are read
**Then** only employees whose current assignment `manager_id` resolves to them are returned.

**Given** any role-aware policy
**When** it is inspected
**Then** it branches on the role in the JWT claim
**And** no `memberships` or `employees` subquery is present in the policy.

**Given** the `audit_logs` table
**When** any payroll-affecting mutation occurs
**Then** a row is written carrying actor, entity, action, before and after
**And** the table is partitioned by `created_at`.

**Given** the isolation suite
**When** it runs
**Then** it asserts in-tenant isolation for each role tier in addition to cross-tenant isolation
**And** it is a blocking CI gate.

---

## Epic 2: Attendance is recorded from the floor

Employees are invited by email, install nothing beyond the PWA, and clock in and out from their own phone against a server-side geofence with a photo — offline-safe, un-duplicatable, and hard to spoof. HR locks the period when it is done.

**CAPs:** CAP-2 (employee invitation), CAP-4, CAP-5, CAP-10, CAP-11, CAP-12, CAP-13, CAP-14 (materialized views), CAP-16
**Key ADs:** AD-3, AD-4, AD-5, AD-6, AD-15, AD-17, AD-20, AD-23, AD-27, AD-29, AD-30, AD-32
**Prerequisites outside this epic:** a transactional email provider must be chosen before Story 2.1; the native mock-location decision must be settled before this epic reaches a paying client.

### Story 2.1: Invite an employee to their own account

As an HR manager,
I want to invite an employee by email so they can sign in themselves,
So that they can clock in from their own phone without me handing out credentials.

**Acceptance Criteria:**

**Given** an employee record with an email address
**When** HR sends an invitation
**Then** an `employee_invitations` row is created carrying a cryptographically random token and an expiry
**And** an email is sent containing a link bearing that token
**And** no admin invite API and no `service_role` client is used anywhere in the path.

**Given** a valid, unexpired invitation token
**When** the recipient completes signup
**Then** the **token** links the new auth user to the pending `employees` row
**And** a `memberships` row is created with role `staff`
**And** the invitation is marked consumed and cannot be reused.

**Given** an attacker who signs up with an employee's email address but without the token
**When** they complete signup
**Then** they are not linked to any employee record.

**Given** an employee with no email address
**When** HR views them
**Then** the record remains valid and payable
**And** `employees.user_id` stays null.

**Given** an expired invitation
**When** the link is opened
**Then** it is refused and HR can reissue.

### Story 2.2: A job runtime that cannot block a request

As a developer,
I want long-running work to run on a worker with retries, scheduling and tenant safety,
So that photo processing, view refreshes and later payroll can never time out a request or leak across tenants.

**Acceptance Criteria:**

**Given** the worker entrypoint
**When** it starts
**Then** pg-boss runs against the existing Postgres in its own schema
**And** the worker connects with a direct session connection, not through Supavisor transaction mode.

**Given** the isolation catalog sweep
**When** it runs
**Then** the pg-boss schema is an explicitly named allowlisted exemption, not an accidental omission.

**Given** any job handler
**When** it begins work
**Then** it sets tenant context for its transaction from the `tenant_id` in its payload before touching any tenant table.

**Given** a job that fails
**When** it is retried
**Then** it backs off, and after exhausting retries lands in a dead-letter state that is visible rather than silent.

**Given** a job submitted twice with the same idempotency key
**When** both are processed
**Then** the effect occurs once.

**Given** a queue with a concurrency limit
**When** more jobs are enqueued than the limit
**Then** the excess waits rather than running.

**Given** recurring work
**When** it is scheduled
**Then** it is registered with pg-boss cron
**And** `pg_cron` is not used anywhere in the project.

### Story 2.3: Shift templates and assignment

As an HR manager,
I want to define shifts and assign them across a team for a date range,
So that attendance can be judged against an expected schedule rather than guessed.

**Acceptance Criteria:**

**Given** a shift template
**When** it is created
**Then** start time, end time, break minutes and late tolerance are set
**And** `crosses_midnight` is explicit, never inferred from the times.

**Given** 100 employees and a month of dates
**When** shifts are assigned by department or branch over a date range
**Then** the assignment completes as one operation
**And** `shift_assignments` enforces `unique (tenant_id, employee_id, work_date)`.

**Given** a selected week
**When** the coverage view is opened
**Then** days with no assigned shift are shown as unassigned.

### Story 2.4: Clock in and out with geofence and photo

As an employee,
I want to clock in from my own phone with a photo when I am at my outlet,
So that my attendance is recorded without paper or a queue at a shared machine.

**Acceptance Criteria:**

**Given** an employee inside their branch radius
**When** they clock in
**Then** a photo is captured, compressed client-side to 60–80 KB, and uploaded **directly to R2** via a short-TTL signed URL
**And** the image bytes never pass through a Next.js route handler
**And** the R2 credentials never reach the client.

**Given** any clock-in
**When** it is captured
**Then** the photo and GPS fix are written to a local queue **first**, before any network call
**And** capture succeeds even when the access token has expired.

**Given** an employee outside the branch radius
**When** they clock in
**Then** a reason is required
**And** the record is flagged for supervisor review.

**Given** a clock-in
**When** the server records it
**Then** the geofence check is performed **server-side** against `branches.radius_m`, never trusted from the client.

**Given** a shift template with a late tolerance
**When** an employee clocks in after start time plus tolerance
**Then** `late_minutes` is recorded and status is `late`.

**Given** the clock in/out endpoint
**When** measured under load
**Then** p95 latency is under 500ms.

### Story 2.5: Thumbnails and photo retention

As an operator,
I want thumbnails generated once and old photos purged on schedule,
So that list views stay fast and photo egress never becomes the dominant cost.

**Acceptance Criteria:**

**Given** a photo uploaded to R2
**When** the thumbnail job runs
**Then** a 10–15 KB thumbnail is generated once and its key stored on the attendance row.

**Given** any list view of attendance
**When** it renders
**Then** it requests thumbnails only, never full images.

**Given** the object path for any photo
**When** inspected
**Then** it is prefixed `{tenant_id}/{employee_id}/`
**And** the bucket is not public and is reachable only through short-TTL signed URLs.

**Given** the retention schedule
**When** it runs as a pg-boss cron job
**Then** photos past the tenant's retention window are archived or deleted
**And** the free tier's window is 30 days.

### Story 2.6: Offline capture and idempotent sync

As an employee at a site with no signal,
I want my clock-in to be recorded and sent when I get back online,
So that I am not marked absent for working somewhere with poor coverage.

**Acceptance Criteria:**

**Given** no network connection
**When** an employee clocks in
**Then** the punch is stored locally with a device-generated `client_uuid`
**And** the interface confirms it is queued rather than reporting failure.

**Given** queued punches and a restored connection
**When** sync runs
**Then** each punch is submitted to a route handler URL
**And** authentication happens at sync time, using a freshly refreshed token.

**Given** the same `client_uuid` submitted repeatedly
**When** the server processes it
**Then** exactly one attendance row exists.

**Given** a sync that fails midway
**When** it is retried
**Then** already-synced punches are not resent as duplicates
**And** unsynced punches remain queued.

### Story 2.7: A shift that crosses midnight is one day's work

As a payroll administrator,
I want an overnight shift attributed to a single date,
So that overtime and allowances are calculated against the shift that was actually worked.

**Acceptance Criteria:**

**Given** a shift template with `crosses_midnight` true, running 22:00 to 06:00
**When** an employee clocks in at 22:00 on 5 July and out at 06:00 on 6 July
**Then** exactly one `attendances` row exists
**And** its `work_date` is 5 July, the date the shift **started**
**And** it matches the `shift_assignments.work_date` that scheduled it.

**Given** that same overnight attendance
**When** work minutes are computed
**Then** they span the date boundary correctly and exclude break minutes.

**Given** timestamps stored for any attendance
**When** inspected
**Then** they are `timestamptz` in UTC
**And** display and day-boundary logic use `companies.timezone`.

### Story 2.8: Clock-in trust is more than GPS

As an HR manager,
I want spoofed attendance to be hard and visible,
So that a faked punch cannot quietly become a wrong payslip through attendance-based allowances.

**Acceptance Criteria:**

**Given** an employee's first successful clock-in
**When** it is recorded
**Then** the device is bound to that employee.

**Given** a clock-in from a device other than the bound one
**When** it is submitted
**Then** it is accepted but flagged for supervisor review
**And** the flag is visible in the attendance record.

**Given** two consecutive punches whose locations are physically impossible in the elapsed time
**When** the second is processed
**Then** it is flagged as implausible.

**Given** an uploaded attendance photo
**When** it is processed
**Then** its capture timestamp is checked against the submitted punch time
**And** a mismatch beyond tolerance is flagged.

**Given** any flagged punch
**When** payroll later reads attendance
**Then** the flag is carried through and visible, not silently dropped.

### Story 2.9: Lock the period, and record every correction

As an HR manager,
I want to lock attendance for a period and have any later change recorded,
So that payroll calculates from a set that stopped moving and every edit is defensible.

**Acceptance Criteria:**

**Given** a period whose attendance is complete
**When** HR locks it
**Then** `attendance_locked_at` is set on the period
**And** locking attendance is a separate action from locking a payroll run.

**Given** a locked period
**When** a user without an authorised role attempts a correction
**Then** it is refused.

**Given** a locked period
**When** an authorised role makes a correction
**Then** the change succeeds
**And** an `audit_logs` row records actor, before and after.

**Given** any attempt to modify locked attendance
**When** it is made through the worker role rather than a request path
**Then** it is subject to the same rule, enforced in the database.

### Story 2.10: The monthly recap reads from a view, not the table

As a supervisor,
I want the monthly attendance recap to open immediately,
So that reading a report never competes with people clocking in.

**Acceptance Criteria:**

**Given** 500 employees with a month of attendance
**When** the monthly recap is opened
**Then** it renders in under 2 seconds
**And** the query reads a materialized view, not `attendances` directly.

**Given** the materialized views
**When** the nightly refresh runs
**Then** it runs as a pg-boss cron job
**And** the current day is updated incrementally rather than by full refresh.

**Given** the `attendances` table
**When** its definition is inspected
**Then** it is partitioned by range on `work_date`
**And** a pg-boss cron job provisions the next three months of partitions.

**Given** aggregate reporting anywhere in the product
**When** it is implemented
**Then** it reads a materialized view
**And** no live aggregate query runs against the primary attendance table.
