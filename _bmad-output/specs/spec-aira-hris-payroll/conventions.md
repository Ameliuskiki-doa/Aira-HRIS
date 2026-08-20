# Conventions

Companion to `SPEC.md`. Code and migration rules that every implementation must follow. The test obligations live in `test-contract.md`.

## Money

```ts
// Integer rupiah. Always.
type Rupiah = number;   // bigint in Postgres, integer in TS

const gross: Rupiah = 5_500_000;
```

Never `float`. Never `Decimal` as a string. Never a currency library. Rupiah has no minor unit in practice, so integers are exact and comparisons are safe.

### Rounding policy — decided, do not vary

**Round per component, immediately, before the value is stored.** Every percentage or rate calculation is rounded to integer rupiah at the moment it produces a `payroll_items.amount`. Nothing sub-rupiah is ever carried forward into a later step.

```ts
// The only rounding call in the pipeline. Applied per component, never deferred.
const bpjsEmployee = Math.round(base * rate);
const overtimePay  = Math.round(hourlyWage * multiplier * hours);
```

The consequence that makes this the right choice: **`gross` is the exact sum of its stored lines**, and so is `total_deduction` and `net`. A payslip always adds up, and every printed figure traces to one stored row.

```ts
// Holds by construction, not by luck:
gross === items.filter(i => i.category === 'earning')
               .reduce((a, i) => a + i.amount, 0);
```

Rounding only at the end was rejected: intermediate precision means the payslip lines no longer sum to the printed total, which is the classic source of the Rp1-discrepancy support call.

Still open (`VERIFY` register in `statutory-rules.md`): the statutory *rounding unit* for PPh21 and BPJS. That question is about the unit, not about where rounding happens; the per-component rule holds either way.

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
- Enums as `text` with a check constraint, **not** Postgres enum types (migrating Postgres enums is painful)

## Migrations

- Forward-only, sequential, in version control
- One concern per migration
- Every migration that creates a table must, **in the same file**:
  1. `enable row level security`
  2. `force row level security`
  3. create the tenant policy
  4. create the `tenant_id`-leading index
- **Never write a migration that loops over tenants**

## API

- Route handlers are thin: authenticate, validate, delegate, return
- All business logic in `lib/domain/` — pure functions, unit-testable without a database
- **Payroll calculation is a pure function of its inputs.** Given the same snapshot it must always produce the same output. This is what makes it testable and auditable.
- Never `service_role` in a request path
- Zod validation on every input boundary

## Jobs

- Every job carries an idempotency key
- Every job is resumable: record progress, do not restart from zero
- Concurrency limits per queue — payroll runs must not all fire on the 25th
- Failures are retried with backoff and surfaced, never silently swallowed

## Language

- Documentation is English, because it sits next to code
- **User-facing UI copy is Indonesian**
- Indonesian regulatory terms stay in Indonesian: PPh21, BPJS, PKWT, THR, lembur. They are legal terms, not translatable jargon.

## Security and UU PDP

- No secrets in client code
- Signed URLs with short TTL for all storage access; no public buckets
- Rate limit auth endpoints
- Audit-log every payroll-affecting mutation
- NIK and salary access restricted by role and logged
- UU PDP: DPA with clients, a stated retention policy, and a working data deletion flow
