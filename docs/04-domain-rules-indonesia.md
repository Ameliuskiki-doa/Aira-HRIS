# 04 — Indonesian Domain Rules

> **Rates in this document are indicative and MUST be verified against the
> current regulation before seeding.** They are here to define the *shape* of the
> data, not to be trusted as values. Every figure marked `VERIFY` needs a source
> check against DJP / BPJS / Kemnaker publications at implementation time.
>
> This is exactly why rates are seed data with `valid_from` and not constants in
> code — see rule 7 in `CLAUDE.md`.

## Rate tables are ours, not the tenant's

Statutory values are maintained by us, seeded, dated, and identical across all
tenants. Tenants cannot edit them.

If HR can type "12%" into a PPh21 field, their mistake becomes our system's
mistake, and we lose the only thing we actually sell: the guarantee that the
calculation is correct.

```sql
create table stat_tax_ter (          -- no tenant_id: global reference data
  id            uuid primary key,
  ter_category  text not null,       -- A|B|C
  income_from   bigint not null,
  income_to     bigint,
  rate          numeric(5,3) not null,
  valid_from    date not null,
  valid_to      date
);

create table stat_ptkp (
  id            uuid primary key,
  status_code   text not null,       -- TK/0, TK/1, K/0, K/1, K/2, K/3, ...
  annual_amount bigint not null,
  valid_from    date not null,
  valid_to      date
);

create table stat_bpjs_rates (
  id                uuid primary key,
  program           text not null,   -- jht|jkk|jkm|jp|kesehatan
  employer_rate     numeric(6,4) not null,
  employee_rate     numeric(6,4) not null,
  wage_cap          bigint,          -- null = uncapped
  valid_from        date not null,
  valid_to          date
);
```

Global reference tables are the only tables without `tenant_id`. They are
readable by all, writable by service role only.

## PPh21 — TER method

Since PMK 168/2023, monthly withholding uses **TER (Tarif Efektif Rata-rata)**,
which is a table lookup rather than the old annualised calculation.

**Monthly (Jan–Nov):**
1. Determine TER category (A / B / C) from PTKP status — `VERIFY` mapping
2. Take monthly gross (bruto)
3. Look up the TER rate for that category and income bracket
4. PPh21 = gross × TER rate

**December (or final month of employment):**
The annual reconciliation still uses the progressive method. Compute tax for the
full year properly, subtract PPh21 already withheld Jan–Nov, and the difference
is December's withholding. It can be negative (refund).

This is why `employee_ytd` is mandatory and why YTD import matters for mid-year
onboarding — without accumulated figures, December is simply wrong.

**Implementation notes:**
- Non-NPWP employees historically incurred a surcharge — `VERIFY` current rule
- Employees joining mid-year at a new employer: each employer issues its own
  1721-A1 for its own period. Do not attempt to combine.
- Round per current DJP rules — `VERIFY`

Indicative progressive brackets for the December calculation (`VERIFY` all):

| Annual taxable income (PKP) | Rate |
|---|---|
| up to 60jt | 5% |
| 60jt – 250jt | 15% |
| 250jt – 500jt | 25% |
| 500jt – 5M | 30% |
| above 5M | 35% |

Indicative PTKP (`VERIFY`): TK/0 = 54jt/year; +4,5jt for married; +4,5jt per
dependant, max 3.

Also required for the annual calculation: **biaya jabatan** — a deduction of 5%
of gross with an annual cap (`VERIFY` amount).

## BPJS

Two schemes, five programs. Indicative rates — `VERIFY` all:

| Program | Employer | Employee | Wage cap |
|---|---|---|---|
| JHT | 3,70% | 2,00% | none |
| JKK | 0,24%–1,74% (risk class) | — | none |
| JKM | 0,30% | — | none |
| JP | 2,00% | 1,00% | capped, adjusted annually |
| Kesehatan | 4,00% | 1,00% | capped |

Implementation points:

- JKK rate depends on the company's risk classification — store per company
- Employer contributions are **not** deductions from net pay, but they must
  appear in payroll cost reporting and some are taxable benefits — `VERIFY`
- The BPJS calculation base is determined by the `base_for_bpjs_*` flags on each
  salary component, not by a fixed definition
- Wage caps are dated values in `stat_bpjs_rates`

## Overtime (lembur)

Per KEP-102/MEN/2004 — `VERIFY` against current regulation.

- Hourly wage = monthly wage ÷ **173**
- Wage base = gaji pokok + tunjangan tetap (components flagged
  `base_for_overtime`)
- **Weekday:** first hour 1,5×; subsequent hours 2×
- **Rest day / public holiday:** different multiplier schedule, and it varies by
  whether the working week is 5 or 6 days — `VERIFY` and implement as a table

Overtime is a rate table too, not hardcoded multipliers.

Configurable per company: whether overtime is auto-calculated from attendance or
requires an approved request. Default should be *requires request* — auto
calculation from raw clock-out times produces disputes.

## THR

- Entitlement after 1 month of continuous service
- 12+ months service: 1 month's wage
- 1–12 months: proportional (months ÷ 12 × monthly wage)
- Base = gaji pokok + tunjangan tetap (components flagged `base_for_thr`)
- Paid as a separate `payroll_run` with `run_type = 'thr'`
- THR is taxable — `VERIFY` current treatment under TER

## Employment types

Each type changes proration, BPJS eligibility, THR calculation, and contract
tracking. Adding a type later means reworking calculation logic, so all of these
exist from the start:

| Type | Notes |
|---|---|
| `pkwtt` | Permanent |
| `pkwt` | Fixed-term; contract end date tracked, expiry alerts |
| `harian_lepas` | Daily; paid per present day; different BPJS treatment |
| `borongan` | Piece rate; quantity × rate |
| `magang` | Intern; often outside BPJS |

## Proration

Two independent cases, both configurable:

**Join / leave mid-period** — divisor is calendar days or working days in the
period, set by `payroll_calendars.proration_basis`. Must be explicit, never
assumed.

**Absence** — applies only to components flagged `prorate_on_absence`. Typically
meal and transport allowances are per-present-day rather than prorated.

A known trap from prior analysis: **WFH days must not be treated as absence**
when reducing attendance incentives. Define the attendance-incentive base
explicitly.

## Night shift crossing midnight

Clock in 22:00 on the 5th, clock out 06:00 on the 6th. **Which `work_date`?**

**Decided: `work_date` = the date the shift STARTS**, with
`shift_templates.crosses_midnight = true` driving the end-time comparison. One
shift is always one `attendances` row.

```
work_date    = 2026-07-05
clock_in_at  = 2026-07-05 22:00 WIB
clock_out_at = 2026-07-06 06:00 WIB
```

Why the start date and not the end date or a majority-of-hours rule: `work_date`
then lines up with `shift_assignments.work_date`, so the schedule and the
realised attendance are keyed identically. A majority-of-hours rule was rejected
outright — overtime on the front of a shift would silently move a row to a
different date, which is not a property you want in a payroll input.

Everything about overtime and attendance depends on this. Changing it after
production data exists means recalculating every attendance row.

Also handle: WIB / WITA / WIT. Store all timestamps as `timestamptz`; use
`companies.timezone` for display and for day-boundary logic.

## Calculation order (gross to net)

Implement as an explicit ordered pipeline, each step writing `payroll_items` with
its inputs recorded in `meta`. Every step must be inspectable — "why is this
number what it is" has to be answerable from stored data.

```
1.  Resolve assignment valid on the period (position, type, calendar)
2.  Resolve salary components valid on the period
3.  Read locked attendance: present days, absences, leave, late
4.  Compute overtime hours (from approved requests or attendance)
5.  Fixed earnings          → prorate if join/leave mid-period
6.  Variable earnings       → per present day / per hour / per unit
7.  Overtime pay            → base from base_for_overtime components
8.  = GROSS
9.  BPJS employee portion   → base from base_for_bpjs_* flags, apply caps
10. BPJS employer portion   → recorded as cost, not a deduction
11. PPh21                   → TER on gross (Dec: annual reconciliation)
12. Other deductions        → loans, cooperative, advances
13. = NET
14. Write payslip snapshot, update employee_ytd
```

Steps 9–11 are order-sensitive and must not be reordered without a rate check.

## Outputs

- **Payslip PDF** — immutable once issued
- **Bank transfer file** — CSV/TXT in BCA, Mandiri, BNI, BRI bulk formats. `VERIFY`
  each bank's current spec.
- **1721-A1 data export** — for HR to file. We do not submit.
- **BPJS reporting export**
- **Journal CSV** — for accounting

We do not do disbursement or e-Filing. Export the file; HR uploads it.

## Rounding

**Decided: round per component, immediately.** Full statement of the rule and its
rationale lives in `docs/07`. In summary:

- All money is integer rupiah — no sub-rupiah value ever persists or crosses a
  pipeline step
- Every component result is rounded as it is written to `payroll_items`, so
  `gross`, `total_deduction`, and `net` are exact sums of their stored lines
- Rounding at the end was rejected — it lets payslip lines disagree with the
  printed total
- PPh21 rounding *unit* per DJP rules — `VERIFY`
- BPJS rounding *unit* — `VERIFY`

The two `VERIFY` items ask whether either statutory figure rounds to a unit
coarser than the nearest rupiah. They do not reopen where rounding happens.

Changing this rule after thousands of payslips are issued is very expensive.

## No formula builder

Salary components are the parameterised types listed in `docs/03`, plus the seven
boolean treatment flags. That covers roughly 90% of real requirements.

A formula builder means building a small programming language and then debugging
other people's formulas over WhatsApp. At Rp450.000/month per client, one such
ticket consumes a year of margin.

Competitors at this price point lose by being *too* flexible to use, not by being
too rigid. Curated flexibility is the advantage.

## Configuration templates

An empty configuration screen will kill self-serve onboarding. Ship presets:
Retail/Toko, F&B, Manufaktur (shift), Kantor. Client picks one, adjusts a little,
done in 15 minutes.

Before saving configuration, run a **dry-run against 3–5 sample employees and
show the resulting payslips.** Most misconfiguration is caught here rather than
becoming a support ticket. Cheap to build, high impact.
