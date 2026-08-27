---
id: SPEC-aira-hris-payroll
companions:
  - statutory-rules.md
  - data-model.md
  - stack.md
  - conventions.md
  - test-contract.md
  - commercial-model.md
  - roadmap.md
  - design-system.md
  - screen-dashboard.md
  - screen-dashboard-states.md
  - screen-dashboard-interaction.md
  - ../../planning-artifacts/architecture/architecture-Aira-2026-08-20/ARCHITECTURE-SPINE.md
sources:
  - ../../../docs/01-product-scope.md
  - ../../../docs/02-architecture.md
  - ../../../docs/03-data-model.md
  - ../../../docs/04-domain-rules-indonesia.md
  - ../../../docs/05-modules.md
  - ../../../docs/06-roadmap.md
  - ../../../docs/07-conventions-and-testing.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. `ARCHITECTURE-SPINE.md` is an adopted companion owned by `bmad-architecture`: it governs **how** these capabilities are built, and downstream cites its `AD` ids. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Aira — HRIS + Payroll for Indonesian SMBs

## Why

**A pain to solve, on a segment nobody serves at this price.** Indonesian SMBs of 20–150 employees run attendance and payroll on Excel and WhatsApp. Every month someone hand-computes PPh21, BPJS, overtime and proration, and every month some of it is wrong — a wrong payslip is the failure that costs a client relationship, not a missing feature. The incumbent HRIS vendors quote Rp5–15jt implementation plus an annual contract, which prices the segment out and makes migration a project rather than a signup. Aira sells one guarantee: the calculation is correct, and it is correct without anyone from Aira touching the account. That forces two things at once — statutory logic owned and versioned by us rather than typed in by HR, and onboarding that a client completes alone in under 30 minutes. Attendance is the wedge (free tier, immediate daily value); payroll is what makes the account sticky and worth Rp15.000/employee/month.

## Capabilities

### Foundation

- **CAP-1** — Tenant isolation
  - **intent:** Every tenant's data is isolated by the database, not by application code, on a single pooled schema.
  - **success:** A catalog-driven sweep finds zero `public` tables without RLS enabled and a policy (global `stat_*` tables allowlisted explicitly); the isolation suite in `test-contract.md` runs blocking in CI and is green.

- **CAP-2** — Identity and membership
  - **intent:** A person authenticates and can hold roles in several companies, with exactly one active at a time. Employees are never required to have work email.
  - **success:** The signup and administrator path reaches an authenticated session by email; `tenant_id` resolves from `app_metadata` injected by the access-token hook, which re-validates the membership on every issue; a user with memberships in two companies switches context via token reissue and no query ever returns blended cross-company rows. Employee-facing credentials are deferred to Phase 1 — see AD-7 and AD-8.

- **CAP-3** — Statutory rate registry
  - **intent:** TER, PTKP, BPJS and overtime rates are reference data we maintain, dated, and identical across every tenant.
  - **success:** Rates are seeded with `valid_from`; no tenant-facing path can write them; recalculating a past period picks the rate row valid on that period, not the current one.

- **CAP-4** — Job runtime
  - **intent:** Long-running work (payroll calculation, PDF generation, view refresh, thumbnails, archival) runs off the request path on a dedicated worker.
  - **success:** Every job carries an idempotency key and re-running it does not double-post; a killed job resumes from recorded progress rather than zero; queue concurrency is capped so simultaneous payroll runs cannot saturate the instance; the worker role cannot bypass RLS.

- **CAP-5** — Attendance photo storage
  - **intent:** Attendance photos are captured, stored and served without the egress bill becoming the dominant cost.
  - **success:** The client compresses to 60–80 KB and uploads directly to R2 via a signed URL with no server hop; a 10–15 KB thumbnail is generated once at upload and list views load only thumbnails; access is short-TTL signed URLs with no public bucket; retention deletes or archives per tier.

### Employee and organisation

- **CAP-6** — Employee records with dated assignments
  - **intent:** Where a person sat — branch, department, position, manager, employment type, payroll calendar — is answerable for any past date, not just today.
  - **success:** Transferring an employee between departments in June leaves March payroll and its reprinted payslip unchanged; "position on date X" returns the historically correct value; the org chart renders from `ltree` without a recursive query.

- **CAP-7** — Excel import
  - **intent:** A new client loads their existing employee spreadsheet without help.
  - **success:** 200 employees import with a validation report and a preview shown before commit; after fixing errors the same file re-runs idempotently without creating duplicates.

- **CAP-8** — Salary components
  - **intent:** A company expresses its pay structure by choosing parameterised component types and setting treatment flags, never by writing a formula.
  - **success:** Each component definition carries its calc type and the seven treatment flags; per-employee amounts are dated rows; a salary change in July does not alter a March calculation.

- **CAP-9** — Personal data protection
  - **intent:** NIK, salary and payroll figures are visible only to roles that need them, and every touch is on the record.
  - **success:** NIK and salary access is role-restricted and logged; every payroll-affecting mutation writes an audit row with before/after; the UU PDP obligations in `conventions.md` — client DPA, retention policy, data deletion flow — are implemented and demonstrable.

### Attendance, leave, shifts

- **CAP-10** — Clock in/out
  - **intent:** An employee records attendance from their own phone at a known location with photo evidence.
  - **success:** Clock in/out completes under 500ms p95; position is geofenced against the branch radius and an out-of-range punch requires a reason and is flagged; mock-location devices are flagged (see open question); photo and thumbnail keys are recorded on the attendance row.

- **CAP-11** — Offline attendance sync
  - **intent:** Attendance still works where there is no signal, and reconnecting cannot duplicate it.
  - **success:** Punches queue offline and sync on reconnect; submitting the same `client_uuid` repeatedly produces exactly one row.

- **CAP-12** — Night-shift attribution
  - **intent:** A shift crossing midnight is one day's work, keyed the same way as the schedule that planned it.
  - **success:** A 22:00–06:00 shift produces one attendance row on the shift's **start** date, matching `shift_assignments.work_date`; work minutes and overtime across the date boundary are correct.

- **CAP-13** — Attendance locking
  - **intent:** Payroll calculates from an attendance set that stopped moving, and later corrections leave a trail.
  - **success:** Attendance locks as a step separate from locking the payroll run; after lock, a correction requires an authorised role and writes an audit row.

- **CAP-14** — Recap and aggregate reporting
  - **intent:** Supervisors and HR read monthly attendance, overtime and analytics without a live aggregate query hitting the primary tables.
  - **success:** A monthly recap for 500 employees renders under 2s from a materialized view; views refresh nightly with incremental current-day updates.

- **CAP-15** — Leave
  - **intent:** Employees request leave, approvers decide it, and balances stay correct across the year boundary.
  - **success:** Balance decrements on final approval, not submission; overlapping requests for the same employee are rejected; cancelling an approved request restores the balance; carry-over runs at year end per policy; approved paid leave feeds attendance as `leave`, not absence, and does not wrongly reduce attendance-based allowances.

- **CAP-16** — Shift scheduling
  - **intent:** A schedule is assigned in bulk and gaps are visible before they become absences.
  - **success:** A month of shifts for 100 employees is assigned in one operation; `crosses_midnight` and late tolerance are explicit on the template; a coverage view shows unassigned days for a selected week.

### Payroll

- **CAP-17** — Payroll calendars and periods
  - **intent:** Both the calendar-month and the mid-month cut-off pay model work, and one company can run both at once.
  - **success:** Tax month and BPJS period derive from **payment date**, not work period, for both models; two employees on different calendars in the same company both calculate correctly; periods are generated 24 months ahead.

- **CAP-18** — Gross-to-net pipeline
  - **intent:** Pay is computed as an explicit ordered sequence where every number is explainable from stored data.
  - **success:** Each step writes `payroll_items` with its inputs in `meta`; every figure on a payslip traces to its inputs; payroll for 2.000 employees completes without timeout and is resumable; 500 employees complete in under 5 minutes; running the same snapshot twice produces identical output.

- **CAP-19** — Overtime
  - **intent:** Lembur is paid from a rate table, on a base the company defines by flag, from a source the company chooses.
  - **success:** Hourly wage = monthly wage ÷ 173; base is the sum of `base_for_overtime` components; multipliers come from a dated table covering weekday, rest day and public holiday for 5- and 6-day working weeks; a company can require an approved request instead of deriving from raw attendance, and request is the default.

- **CAP-20** — PPh21
  - **intent:** Monthly withholding uses TER and the year still reconciles correctly in December.
  - **success:** Jan–Nov withholding is a TER category and bracket lookup against monthly gross; December or the final month of employment runs the progressive annual calculation net of Jan–Nov withheld and may produce a refund; a mid-year joiner with imported YTD reconciles correctly.

- **CAP-21** — BPJS
  - **intent:** All five programs compute on a company-specific risk class and dated caps, splitting employee and employer sides correctly.
  - **success:** JHT, JKK, JKM, JP and Kesehatan each compute from a base defined by the `base_for_bpjs_*` flags with dated wage caps applied; JKK uses the company's risk classification; employer contributions appear as cost, never as a deduction from net.

- **CAP-22** — THR
  - **intent:** THR is paid as its own run on its own base.
  - **success:** Entitlement starts after 1 month of continuous service; 12+ months pays one month's wage and 1–12 months pays proportionally; base is the sum of `base_for_thr` components; it runs as `run_type = 'thr'` against the same period.

- **CAP-23** — Run immutability and corrections
  - **intent:** A payslip that has been issued never changes underneath the person who received it.
  - **success:** Locking snapshots the config **as used** (not a reference) and freezes every payslip; no code path including the worker can modify a locked run; a correction is a new run in the same period; reprinting a January payslip in December produces identical figures.

- **CAP-24** — Year-to-date
  - **intent:** A client who arrives in August still gets a correct December.
  - **success:** `employee_ytd` accumulates gross, PPh21 and BPJS per tax year from calculation, and accepts an import marked `source = 'imported'`; December reconciliation from imported YTD is correct.

- **CAP-25** — Payslip
  - **intent:** Every employee receives a payslip that is complete, explainable and permanent.
  - **success:** An immutable full-breakdown snapshot is stored per payslip; the PDF renders in under 3s; the layout is configuration, not per-client customisation.

- **CAP-26** — Statutory and financial exports
  - **intent:** HR files and pays from files we generate; we never submit or disburse on their behalf.
  - **success:** Bank bulk-transfer files validate against the BCA, Mandiri, BNI and BRI specs; 1721-A1 data, BPJS reporting and a journal CSV all export.

### Process and commercial

- **CAP-27** — Approval engine
  - **intent:** One engine serves leave, overtime and correction requests, and it survives people leaving.
  - **success:** Routes target `position_id` and department path and resolve to the current holder, so a supervisor's resignation does not break pending approvals; levels are configurable per request type; an approver on leave routes to their delegate; requests escalate after a configurable timeout; adding a new approvable entity requires no engine change; full history is retained after close.

- **CAP-28** — Configuration
  - **intent:** A client configures the system correctly the first time, from a preset, with the result shown before it is saved.
  - **success:** Presets for Retail/Toko, F&B, Manufaktur and Kantor exist; a dry-run against 3–5 sample employees shows resulting payslips before config is committed; payroll-affecting config is dated so changing a policy in July leaves March unaffected; the national holiday calendar is seeded and editable per company; role changes take effect without re-login problems.

- **CAP-29** — Billing and subscription
  - **intent:** The account bills itself on real headcount and a payment failure never costs the client access to their own payroll data.
  - **success:** Billing is at organization level with headcount summed across companies on a defined snapshot date; mid-month joiners and leavers prorate; the free tier enforces 10 employees and 30-day photo retention; a dunning sequence runs on payment failure; overdue degrades to read-only that still permits payslip download and export.

- **CAP-30** — Self-serve onboarding
  - **intent:** A client goes from signup to a finished payroll without speaking to anyone.
  - **success:** A new client completes configuration in under 30 minutes unassisted, and at least one real signup reaches a completed payroll run with zero human contact.

- **CAP-31** — Support deflection
  - **intent:** Repeat questions are answered by material and automation rather than by staff.
  - **success:** Knowledge base, short videos and a WhatsApp bot for repeat questions are live before paid volume; support cost per client stays inside the margin implied by `commercial-model.md`.

## Constraints

Full rationale for each lives in the companion named in brackets.

**Tenancy and isolation**

- `tenant_id` **is** `company_id` — one legal entity (PT). Not a group, not a branch. NPWP, NPP BPJS, PKWT and 1721-A1 all attach to a legal entity. [stack]
- `tenant_id` on every table including lookup and log tables. Only global `stat_*` reference tables are exempt, and they must be explicitly allowlisted in the isolation test. [data-model]
- RLS `enable` **and** `force` on every table, and JWT claims wrapped as `(select auth.tenant_id())` — without the subquery Postgres re-evaluates the function per row, a 10–100× difference on a multi-million-row attendance table. [stack]
- Every index leads with `tenant_id`, otherwise it is unusable once RLS adds its predicate. [conventions]
- `tenant_id` lives in `app_metadata`, never `user_metadata` — `user_metadata` is user-writable. [stack]
- Workers never use `service_role`. A dedicated role with `FORCE ROW LEVEL SECURITY` sets tenant context per transaction, so a forgotten `WHERE` is caught by the database. [stack]
- No cross-tenant bypass role. Group access is explicit `memberships` rows resolved through a view; the JWT carries one active company. [stack]
- One Supabase project for all tenants. Never a project or a schema per client. [stack]

**Money and payroll**

- Money is integer rupiah (`bigint`), rounded per component at the moment it is written — so `gross`, `total_deduction` and `net` are exact sums of their stored lines. No float, no decimal-as-string, no currency library. [conventions]
- Anything that affects payroll is versioned with `valid_from` / `valid_to` and never overwritten: statutory rates, BPJS rates, salary components, org assignments, payroll config. [data-model]
- A locked payroll run is immutable through every code path, including the worker role. [data-model]
- Statutory rates are ours — seeded, dated, identical across tenants, not editable by any tenant. If HR can type "12%" into a PPh21 field, their mistake becomes our system's mistake. [statutory-rules]
- No formula builder. Components are parameterised types plus seven boolean treatment flags. [statutory-rules]
- Payroll calculation is a pure function of its snapshot: the same inputs always produce the same output. [conventions]
- Every rate marked `VERIFY` must be source-checked against DJP / BPJS / Kemnaker publications before seeding. [statutory-rules]

**Attendance and storage**

- `work_date` is the date the shift **starts**. Changing this after production data exists means recalculating every attendance row. [statutory-rules]
- Photos upload client → R2 directly via signed URL, never through a Next.js route handler. No public buckets; short-TTL signed URLs only. [stack]

**Platform economics**

- Infra stays under 6% of revenue — roughly USD 180/month at 100 clients / 4.000 employees. A design choice that breaks this gets flagged, not absorbed. [commercial-model]
- No Supabase Realtime; poll at 30s. Concurrent connections are billed and HRIS does not need them. [stack]
- All aggregate reporting goes through materialized views. Live aggregate queries are what force the Small → Medium → Large upgrade path. [stack]

**Process**

- Approvals target `position_id` and department path, never `user_id`. [data-model]
- Every migration that creates a table must, in the same file, enable RLS, force RLS, create the tenant policy, and create the `tenant_id`-leading index. Never loop over tenants in a migration. [conventions]
- Phase 0 completes before anything else. It is the only category of mistake that requires rewriting rather than extending. [roadmap]
- Self-serve is mandatory, not aspirational: no manual onboarding, no training sessions, no price negotiation. [commercial-model]
- A new configuration option is added only when **three separate clients** have asked for the same thing. One request is a custom demand, and the answer is no. [commercial-model]
- Overdue accounts degrade to read-only, never blocked. Withholding access to payroll data is the fastest way to lose reputation. [commercial-model]
- User-facing UI copy is English; documentation is English; Indonesian regulatory terms (PPh21, BPJS, PKWT, THR, lembur) stay in Indonesian. [conventions]

## Non-goals

- **Salary disbursement** — requires a licensed PJP partner. We generate the bank file; the client pays from it.
- **e-Bupot / e-Filing submission** — we export the data; HR uploads it.
- **Accounting integration** — journal CSV export only, no connector.
- **Formula builder for salary** — support cost exceeds ARPU.
- **Performance management, LMS** — different product.
- **Full ATS / recruitment pipeline** — deferred entirely; SMBs hire ~5 people/year via WhatsApp. If ever built, a paid add-on, not core.
- **Realtime dashboards** — polling is sufficient and realtime connections are billed.
- **Per-client database or per-tenant schema** — compute is billed per project and per-schema migrations are a 300-iteration loop that can fail midway.
- **Custom payslip layouts per client** — configuration, or no.
- **The enterprise segment** — BUMN, government, listed companies, and companies over ~300 employees. Data residency, ISO 27001 and procurement are out of scope, and the org complexity above ~300 is deliberately not modelled.
- **Migration tooling from an incumbent HRIS** — the realistic customer arrives from Excel + WhatsApp. Price alone will not move someone off an incumbent.
- **Local data residency as the default** — Singapore region is acceptable for SMB. A client demanding local residency is a separate paid tier on a self-hosted instance, not a migration and not the default.

## Success signal

**Technical:** one real client's payroll runs in parallel with their existing manual method for at least two consecutive periods and reconciles **to the rupiah** — every figure on every payslip traceable to its stored inputs. Until that holds, nobody relies on the calculation.

**Business:** a client signs up, configures, imports their employees, and reaches a completed payroll run with **zero human contact from Aira**. If that path does not exist, the Rp15.000/employee pricing does not work regardless of how good the software is.

## Assumptions

- The technical decisions in `docs/01`–`07` are ratified as-is. This spec distills them; it does not reopen settled calls (per-component rounding, `work_date` = shift start, pooled tenancy, no formula builder).
- Client is a PWA first, per `CLAUDE.md`; `docs/02` is silent on client platform.
- The tier split (Free ≤10 employees / Core Rp10.000 / Payroll Rp15.000, minimum Rp250.000/month) is load-bearing for CAP-29 and is taken as stated.
- Attendance photo retention is 6 months on paid tiers, 30 days on free.
- `docs/03`'s ban on email/password is scoped to the employee population — its stated rationale is warehouse staff, SPG and field workers. The signup and administrator path uses email auth per AD-7; the employee-facing rule stands.
- Phase 4 depth items (multi-PT consolidated reporting, face matching, fingerprint device integration, weekly payroll) are recorded in `roadmap.md` as rule-of-three gated. They are not committed capabilities in this contract.

## Open Questions

- **Statutory VERIFY register.** Every rate and rule marked `VERIFY` in `statutory-rules.md` needs a source check before seeding: TER category mapping, PTKP amounts, non-NPWP surcharge, biaya jabatan cap, all BPJS rates and caps, rest-day/holiday overtime multipliers for 5- vs 6-day weeks, THR treatment under TER, employer BPJS as taxable benefit, and the PPh21 / BPJS rounding **units**. Blocking for CAP-3, CAP-19, CAP-20, CAP-21, CAP-22.
- **Distribution — where do the first 100 clients come from?** `docs/06` names this the largest risk in the project and leaves it open. Strongest candidate is the existing outsourcing / staff-augmentation client base. Must resolve before Phase 2.
- **Mock-location detection vs PWA-first.** `docs/05` M2 requires flagging mock-location devices, but that is an Android native capability a PWA cannot reach. Does CAP-10 drop the check until a native shell exists, ship a weaker web-side heuristic, or does PWA-first change?
- **`attendances` uniqueness.** The key `(tenant_id, employee_id, work_date, client_uuid)` permits several rows per employee per `work_date` under different `client_uuid`s, which contradicts the `docs/04` rule that one shift is always one attendance row. Which invariant wins, and does the second punch of a day become an update rather than an insert?
- **Payment gateway** for CAP-29 is not chosen anywhere in the source docs, though gateway fees are part of the annual-billing rationale. The spine defers it explicitly to Phase 3, so it is owned rather than forgotten.
- **Notification channel provider.** AD-7 removes OTP from Phase 0 entirely, so what remains is only the digest channel and its cost model — `docs/05` warns per-message cost can rival infrastructure cost. If WhatsApp OTP ever returns, Supabase supports that channel only through Twilio or Twilio Verify, which would pick the vendor.
- **Bank bulk-transfer specs** for BCA, Mandiri, BNI and BRI need current-spec verification before CAP-26 is implementable.
- **Attendance photo retention is stated three ways.** `commercial-model.md` sets 6 months on paid tiers and 30 days on free; the dashboard mockup's sidebar says photos older than **90 days** are purged. Pick one, or make the notice render the tenant's configured value. Affects CAP-5 and CAP-29.
- **Dashboard design gaps that remain.** The three-document dashboard set now covers the loaded screen (`screen-dashboard.md`), its empty/loading/error/calculating/stale/read-only states (`screen-dashboard-states.md`), and its responsive, switcher, notification and accessibility behaviour (`screen-dashboard-interaction.md`). What is still undecided lives in those documents' own open sections: whether HR admin needs a true mobile experience rather than the documented floor, whether Nocturne needs a semantic status ramp, the `--ui-faint` contrast check at small sizes, the 24h stale threshold, offline behaviour, onboarding-checklist persistence, notification retention and read-state scoping, and digest scheduling and cost. **No other screen in the product has been designed.**
- **Weekly payroll.** `payroll_calendars.period_type` includes `weekly`, but weekly payroll is a Phase 4 build-on-demand item. Is it in scope for CAP-17 or schema-only for now?
