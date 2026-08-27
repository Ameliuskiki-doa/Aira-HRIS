# CLAUDE.md

Context file for Claude Code. Read this before touching anything.

Docs are written in English because they sit next to code. Indonesian regulatory
terms (PPh21, BPJS, PKWT, THR, lembur) are kept in Indonesian on purpose — they
are legal terms, not translatable jargon. User-facing UI copy is English.

---

## What this is

A multi-tenant HRIS + simple payroll SaaS for Indonesian SMBs (roughly 20–150
employees per client). Self-serve. Target price Rp15.000/employee/month.

**Not** an enterprise HRIS. See `docs/01-product-scope.md` for what we
deliberately do not build. When a requirement is not in scope, say so instead of
building it.

## Stack

| Layer | Choice |
|---|---|
| Frontend + API | Next.js (App Router) on Vercel |
| Database + Auth | Supabase (Postgres, RLS, Auth) |
| Attendance photos | Cloudflare R2 (**not** Supabase Storage — egress cost) |
| Background jobs | Separate worker (Railway/Fly) — **not** Vercel functions |
| Mobile | PWA first; native later if needed |

## Non-negotiable rules

These come from decisions already made. Do not revisit them without being asked.
Violating any of them is a bug, not a style preference.

1. **`tenant_id` on every table.** No exceptions, including lookup and log tables.
2. **RLS on every table**, and `tenant_id` must be the leading column of every index.
3. **Wrap JWT claims in `(select ...)` inside policies.** `using (tenant_id = (select auth.tenant_id()))`. Without the subquery Postgres re-evaluates per row.
4. **`tenant_id` lives in `app_metadata`, never `user_metadata`.** `user_metadata` is user-writable.
5. **Workers never use `service_role`.** Use a dedicated role with `FORCE ROW LEVEL SECURITY` and set the tenant context per transaction.
6. **Money is integer rupiah, rounded per component.** Never float, never decimal-as-string. Every component result is rounded as it is written, so gross/net are exact sums of their stored lines. See `docs/07-conventions-and-testing.md`.
7. **Anything that affects payroll is versioned, never overwritten.** Tax rates, BPJS rates, salary components, org assignments, payroll config. All carry `valid_from` / `valid_to`.
8. **A locked payroll run is immutable.** Corrections happen via a new run in the same period, never by editing a locked one.
9. **Statutory rates are ours, not the tenant's.** TER, PTKP, BPJS, overtime multipliers are seed data we maintain. Tenants cannot edit them.
10. **No formula builder.** Salary components are parameterised types with boolean treatment flags. See `docs/04-domain-rules-indonesia.md`.
11. **Photos upload client → R2 directly via signed URL.** Never through a Next.js route handler.
12. **One Supabase project for all tenants.** Never one project per client.

## Where things are

```
docs/01-product-scope.md              positioning, pricing, out-of-scope list
docs/02-architecture.md               multi-tenancy, RLS, storage, jobs, cost limits
docs/03-data-model.md                 schema: org → company → branch → dept, employees, payroll
docs/04-domain-rules-indonesia.md     PPh21 TER, BPJS, lembur, THR, prorata, contract types
docs/05-modules.md                    per-module specs with acceptance criteria
docs/06-roadmap.md                    build order and milestones
docs/07-conventions-and-testing.md    code conventions, migrations, required tests
```

## Definition of done

A change is not done until all of these hold:

- [ ] Every new table has `tenant_id`, RLS enabled, and a policy
- [ ] The tenant isolation test suite passes (see `docs/07`)
- [ ] Money values are integers; no floats anywhere near a payroll path
- [ ] New config that affects payroll is dated, not mutable
- [ ] Migration is forward-only and reversible in principle
- [ ] User-facing strings are English (Indonesian regulatory terms excepted)

## When unsure

Ask rather than guess, specifically about:

- Anything involving a statutory rate or tax calculation
- Whether something belongs at `organization` or `company` level
- Whether a requested option should be configurable or hardcoded

Guessing wrong on statutory logic produces incorrect payslips, which is the one
failure mode this product cannot survive.

---

@AGENTS.md
