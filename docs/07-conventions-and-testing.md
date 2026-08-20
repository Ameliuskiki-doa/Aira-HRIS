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
payroll product is not a bug — it ends the business.

```ts
// tests/isolation.test.ts
// Runs in CI on every PR. Blocking.

const TABLES = await getAllTablesWithTenantId();   // discovered, not hardcoded

for (const table of TABLES) {
  test(`${table} isolates tenants`, async () => {
    const asA = clientForTenant(TENANT_A);
    const rows = await asA.from(table).select('tenant_id');

    expect(rows.length).toBeGreaterThan(0);              // fixture sanity
    expect(rows.every(r => r.tenant_id === TENANT_A)).toBe(true);
  });
}
```

Discover the table list from the catalog rather than maintaining it by hand — the
failure mode being defended against is *forgetting* to add a policy to a new
table.

Companion test that must also run:

```ts
test('every table has RLS enabled and a policy', async () => {
  const unprotected = await query(`
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and (c.relrowsecurity = false
           or not exists (
             select 1 from pg_policies p
             where p.tablename = c.relname))
  `);
  expect(unprotected).toEqual([]);   // allowlist global stat_* tables explicitly
});
```

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
