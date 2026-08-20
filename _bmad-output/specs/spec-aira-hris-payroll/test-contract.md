# Test Contract

Companion to `SPEC.md`. The tests a change must pass and the performance budgets it must not exceed. These are gates, not suggestions.

## Required: tenant isolation

**This is the most important test in the codebase.** A cross-tenant leak in a payroll product is not a bug — it ends the business. Runs in CI on every PR. Blocking.

```ts
// tests/isolation.test.ts
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

Discover the table list from the catalog rather than maintaining it by hand — the failure mode being defended against is *forgetting* to add a policy to a new table.

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

## Required: payroll golden files

A set of employee fixtures with known correct outputs, verified by hand once. Every calculation change runs against them. This is how you catch a regression before a client does.

Cover at minimum:

- single and married with dependants
- mid-period joiner
- mid-period leaver
- overtime on a weekday and on a public holiday
- THR
- December reconciliation
- non-NPWP
- each of the five employment types
- capped BPJS

## Required: behavioural gates

| Gate | Test |
|---|---|
| **Immutability** | Attempt to modify a locked run through every available path, including the worker role. All must fail. |
| **Determinism** | Run the same payroll twice from the same snapshot; outputs must be identical. |
| **Offline sync** | Same `client_uuid` submitted repeatedly produces one row. |
| **Dated config** | Change a policy with a future `valid_from`, recalculate a past period, confirm the old values were used. |

## Performance budgets

| Operation | Budget |
|---|---|
| Clock in/out API | < 500ms p95 |
| Monthly attendance recap, 500 employees | < 2s (materialized view) |
| Payroll run, 500 employees | < 5 min |
| Payslip PDF | < 3s |

Exceeding these is a **design problem, not a hardware problem.** The answer is a materialized view or a better index, not a compute upgrade — see the cost budget in `commercial-model.md`.

## Module acceptance criteria

Beyond the gates above, each capability carries acceptance criteria in `SPEC.md`. A module is not done until all of its criteria pass. Additional criteria that did not fit a single capability's `success` line:

**Employee management (CAP-6, CAP-7)**
- Import can be re-run idempotently after fixing errors
- Org chart renders from `ltree` without a recursive query

**Attendance (CAP-10–CAP-14)**
- Fake GPS detection flags mock-location devices *(see the PWA open question in `SPEC.md`)*
- After lock, corrections require an authorised role and are audit-logged

**Leave (CAP-15)**
- Supervisor resignation does not break pending approval routing
- Approved leave does not reduce attendance-based allowances incorrectly

**Payroll (CAP-17–CAP-26)**
- Two employees on different calendars in the same company both calculate correctly
- Payroll for 2.000 employees completes without timeout and is resumable
- Re-running a completed job does not double-post
- Reprinting a January payslip in December produces byte-identical figures
- Bank transfer file validates against each bank's spec

**Approvals (CAP-27)**
- Adding a new approvable entity requires no engine changes
- Full approval history is retained after the request closes

**Configuration (CAP-28)**
- A new client completes configuration in under 30 minutes with no assistance
- Changing a policy in July leaves March payroll unaffected
- Role changes take effect without re-login issues

**Billing (CAP-29)**
- Mid-month joiners and leavers prorate correctly
- Free tier enforces the 10-employee limit and 30-day photo retention
- Dunning sequence runs on payment failure
- Read-only mode still allows payslip download and export
