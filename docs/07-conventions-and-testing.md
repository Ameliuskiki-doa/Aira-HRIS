# 07 — Conventions & Testing

## Money

```ts
// Integer rupiah. Always.
type Rupiah = number;   // bigint in Postgres, integer in TS

const gross: Rupiah = 5_500_000;
```

Never `float`. Never `Decimal` as a string. Never a currency library. Rupiah has
no minor unit in practice, so integers are exact and comparisons are safe.

### Rounding policy — decided, do not vary

**Round per component, immediately, before the value is stored.** Every
percentage or rate calculation is rounded to integer rupiah at the moment it
produces a `payroll_items.amount`. Nothing sub-rupiah is ever carried forward
into a later step.

```ts
// The only rounding call in the pipeline. Applied per component, never deferred.
const bpjsEmployee = Math.round(base * rate);
const overtimePay  = Math.round(hourlyWage * multiplier * hours);
```

The consequence that makes this the right choice: **`gross` is the exact sum of
its stored lines**, and so is `total_deduction` and `net`. A payslip always adds
up, and every printed figure traces to one stored row.

```ts
// Holds by construction, not by luck:
gross === items.filter(i => i.category === 'earning')
               .reduce((a, i) => a + i.amount, 0);
```

Rounding only at the end was rejected: intermediate precision means the payslip
lines no longer sum to the printed total, which is the classic source of the
Rp1-discrepancy support call.

Still open, and marked `VERIFY` in `docs/04`: the statutory *rounding unit* for
PPh21 and BPJS — whether either rounds to something coarser than the nearest
rupiah under current DJP / BPJS rules. That question is about the unit, not about
where rounding happens; the per-component rule above holds either way.

## Dates and time

- All timestamps `timestamptz`, stored UTC
- Business dates (`work_date`, `valid_from`) are `date`, no timezone
- Display and day-boundary logic use `companies.timezone`
- Period boundaries come from `payroll_periods`, never computed ad hoc

## Naming

- Tables plural snake_case: `employee_assignments`
- Every table: `id uuid`, `tenant_id uuid`, `created_at timestamptz`
- Dated tables: `valid_from date not null`, `valid_to date` (null = open)
- Money columns suffixed `_amount` or plainly named, always `bigint`
- Enums as `text` with a check constraint, not Postgres enum types (migrating
  Postgres enums is painful)

## Migrations

- Forward-only, sequential, in version control
- One concern per migration
- Every migration that creates a table must, in the same file:
  1. `enable row level security`
  2. `force row level security`
  3. create the tenant policy
  4. create the `tenant_id`-leading index
- Never write a migration that loops over tenants

## API

- Route handlers are thin: authenticate, validate, delegate, return
- All business logic in `lib/domain/` — pure functions, unit-testable without a
  database
- Payroll calculation is a pure function of its inputs. Given the same snapshot,
  it must always produce the same output. This is what makes it testable and
  auditable.
- Never `service_role` in a request path
- Zod validation on every input boundary

## Jobs

- Every job carries an idempotency key
- Every job is resumable: record progress, do not restart from zero
- Concurrency limits per queue — payroll runs must not all fire on the 25th
- Failures are retried with backoff and surfaced, never silently swallowed

---

## Required test: tenant isolation

**This is the most important test in the codebase.** A cross-tenant leak in a
payroll product is not a bug — it ends the business. It is blocking in CI, in
its own job, on every push and every pull request.

### Where it lives

```text
tests/isolation/catalog-sweep.test.ts    the structural gate — reads the catalog
tests/isolation/tenant-purity.test.ts    what a request can actually see and write
tests/isolation/globalSetup.ts           drop → migrate → seed two tenants
tests/isolation/support/                 catalog reads, exemptions, fixtures, connections
tests/isolation-guards.test.ts           the harness's own pure functions (runs in `unit`)
tests/isolation-registration.test.ts     fails if the gate stops being run (runs in `unit`)
scripts/isolation-db.mjs                 the postgres:17 it runs against
```

Run it with `npm run test:isolation`; it starts its own Postgres in Docker.
Point `ISOLATION_DATABASE_URL` at one you already have to skip Docker — that is
what CI does. The substrate is a bare `postgres:17` container, **not**
`supabase start`: ~20× cheaper, and every criterion the suite checks is a
catalog or SQL fact. What bare Postgres cannot prove is that a migration will
*apply* to Supabase, because it grants more; see `deferred-work.md`.

### The property

Not a checklist of things that must be present — **no surface in `public` may
return a row belonging to another tenant, by any means.** A checklist cannot
fail on a leak surface that was *added*, and three were found that way: a plain
view (RLS is skipped because views default to `security_invoker = false`), a
`security definer` function, and a policy `to anon using (true)`. All three
satisfied "RLS enabled, policy present, tenant_id column present, index
present" while returning both tenants' rows.

So the sweep discovers **relations**, not tables — `relkind in ('r','p','v','m','f')`
— and asserts, per kind:

| Kind | Rule |
|---|---|
| table, partition, foreign table | RLS enabled **and** forced, ≥1 permissive policy, `tenant_id uuid not null`, an index leading with it |
| view | `security_invoker = true` |
| materialized view | selectable by no request role — a matview cannot carry RLS at all |
| every kind | not selectable by `anon`; present in the fixture registry |

and, across policies and functions:

- every policy expression that calls a claim function wraps it as
  `(select public.tenant_id())` — unwrapped costs ~7.4× on a tenant-wide scan
  and isolates perfectly, so only the catalog can see it;
- every permissive policy expression *references* a claim function, which is
  how `using (true)` is caught without guessing its spellings;
- no policy reaches `anon` or `public`;
- claim functions are `parallel safe` — one parallel-unsafe function disables
  parallel query for the whole statement;
- no `security definer` function in `public` without a justified exemption.

### The two rules that make it non-vacuous

**Prove the fixture is non-empty before asserting purity.** A table with RLS
enabled and no policy returns zero rows, which is byte-identical to a fixture
that failed to seed. `assertTenantPurity` throws on an empty result for exactly
this reason.

**Every discovered relation must have a fixture entry.** That is what makes a
table added in a later story fail loudly instead of going unmentioned.

```ts
// tests/isolation/tenant-purity.test.ts, in shape
const rows = await asPrincipal(PRINCIPAL_A, (c) => c.query(`select * from ${relation}`));
assertTenantPurity(rows, fixture.isolationColumn, fixture.expected(PRINCIPAL_A), label);
```

Three passes per relation, not one: as tenant A, as tenant B, and as `anon`.
Reads run over TCP as a non-superuser (`authenticator` → `set local role
authenticated`) because **a superuser bypasses RLS even with FORCE**, which
would make every assertion vacuous. The suite asserts that about itself.

### Exemptions

Exactly three, each carrying a justification the suite checks: global `stat_*`
tables, the pg-boss schema, and the two relations at or above the tenant
boundary (`organizations`, `companies`). The last waives the `tenant_id`
*column* rule only — RLS, force, a policy and an index are still required. A
fourth is a decision, not a commit.

## Other required tests

**Payroll golden files** — a set of employee fixtures with known correct outputs,
verified by hand once. Every calculation change runs against them. This is how
you catch a regression before a client does.

Cover at minimum: single/married with dependants, mid-period joiner, mid-period
leaver, overtime on weekday and holiday, THR, December reconciliation, non-NPWP,
each employment type, capped BPJS.

**Immutability** — attempt to modify a locked run through every available path,
including the worker role. All must fail.

**Determinism** — run the same payroll twice from the same snapshot; outputs must
be identical.

**Offline sync** — same `client_uuid` submitted repeatedly produces one row.

**Dated config** — change a policy with `valid_from` in the future, recalculate a
past period, confirm the old values were used.

## Performance budgets

| Operation | Budget |
|---|---|
| Clock in/out API | < 500ms p95 |
| Monthly attendance recap, 500 employees | < 2s (materialized view) |
| Payroll run, 500 employees | < 5 min |
| Payslip PDF | < 3s |

Exceeding these is a design problem, not a hardware problem. The answer is a
materialized view or a better index, not a compute upgrade — see the cost budget
in `docs/01`.

## Security

- No secrets in client code
- Signed URLs with short TTL for all storage access; no public buckets
- Rate limit auth endpoints
- Audit-log every payroll-affecting mutation
- NIK and salary access restricted by role and logged
- UU PDP: DPA with clients, retention policy, data deletion flow
