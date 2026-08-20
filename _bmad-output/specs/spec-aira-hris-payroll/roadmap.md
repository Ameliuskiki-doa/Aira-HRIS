# Roadmap

Companion to `SPEC.md`. Build order, milestones, and the risks that shape both. **Build order is load-bearing**: several foundations cannot be retrofitted, and the sequence front-loads exactly those.

## Phase 0 — Foundation (cannot be retrofitted)

Nothing else starts until these are in place. Covers **CAP-1 – CAP-5** plus the schema spine in `data-model.md`.

- Multi-tenant schema: `organizations → companies → branches → departments → positions`
- `memberships` many-to-many
- `employee_assignments` with `valid_from` / `valid_to`
- RLS policies on every table, with the `(select ...)` pattern
- **Tenant isolation test suite running in CI** (`test-contract.md`)
- Auth: phone + OTP, `tenant_id` in `app_metadata`
- Money as `bigint`, with the rounding policy written down
- Dated statutory rate tables, seeded and verified
- R2 storage with signed URLs
- Worker + job queue skeleton with idempotency

**Getting Phase 0 wrong is the only category of mistake that requires rewriting rather than extending.**

## Phase 1 — Attendance MVP

**CAP-6 – CAP-16.** Employee management, attendance with GPS and photo, offline sync, shifts, leave, approvals, supervisor dashboard, Excel import.

Shippable as the free tier. Enough to onboard real users and learn.

## Phase 2 — Payroll

**CAP-17 – CAP-26.** Payroll calendars (both period models), salary components with treatment flags, the gross-to-net pipeline, overtime, PPh21 TER, BPJS, payslip PDF, bank transfer file, YTD import, config templates and dry-run.

This is where the product becomes sellable at Rp15.000.

## Phase 3 — Commercial

**CAP-29 – CAP-31.** Billing and subscription, dunning, self-serve signup, knowledge base, WhatsApp support bot, onboarding wizard.

Phase 3 is **not optional polish.** At this ARPU, self-serve onboarding and support deflection are what make the unit economics work at all.

## Phase 4 — Depth (rule-of-three gated, not committed scope)

Build on demand, when three clients ask. Not capabilities in this contract.

- Group / multi-PT features: context switcher, consolidated reporting, inter-PT transfer flow
- Face matching
- Fingerprint device integration
- Journal export beyond the CSV in CAP-26
- Weekly payroll *(schema already allows `period_type = 'weekly'` — see the open question in `SPEC.md`)*

## Milestones

| | Definition of reached |
|---|---|
| M1 | Phase 0 complete, isolation tests green |
| M2 | One real pilot client running attendance for a full month |
| M3 | One real client's payroll calculated in parallel with their existing method, figures matching |
| M4 | First self-serve signup that reaches a completed payroll with zero human contact |
| M5 | 20 paying clients |
| M6 | 100 paying clients (approximate break-even) |

**M3 is the real technical validation.** Run parallel with the client's existing payroll for at least two periods and reconcile to the rupiah before anyone relies on it. **Do not skip this.**

**M4 is the real business validation.** If a client cannot get from signup to a finished payroll without you, the pricing model does not work regardless of how good the software is.

M3 and M4 are the two halves of the success signal in `SPEC.md`.

## Risks

| Risk | Mitigation |
|---|---|
| **Distribution** — where do the first 100 clients come from? | **Unresolved.** Strongest candidate: the existing outsourcing / staff-augmentation client base. Resolve before Phase 2. |
| Service-business pull — developers pulled to client projects | Explicit locked capacity, agreed up front |
| Payroll calculation error | Parallel run at M3; every figure traceable; versioned rates |
| Cross-tenant leak | Isolation tests in CI; workers without `service_role` |
| Bandwidth incident | R2; hard spend cap; WAF |
| Churn at 3–5%/month | Payroll is sticky; annual billing |

**The first row is the largest risk in the project and is not a technical one.** No amount of architecture compensates for it. It is carried as an open question in `SPEC.md`.
