# Statutory Rules — Indonesia

Companion to `SPEC.md`. The calculation contract for CAP-19 through CAP-22, plus the shared rules (rounding, `work_date`, proration, employment types) that every payroll capability depends on.

> **Every figure here is indicative and marked `VERIFY`.** These values define the *shape* of the data, not trustworthy amounts. Source-check each against DJP / BPJS / Kemnaker publications before seeding. This is exactly why rates are dated seed data and not constants in code.

## Ownership

Statutory values are maintained by us: seeded, dated, identical across all tenants, never tenant-editable. Global reference tables (`stat_tax_ter`, `stat_ptkp`, `stat_bpjs_rates`, overtime multipliers) are the **only** tables without `tenant_id`; they are readable by all and writable by service role only, and must be explicitly allowlisted in the isolation test.

Rationale: if HR can type "12%" into a PPh21 field, their mistake becomes our system's mistake — and the guarantee that the calculation is correct is the only thing we actually sell.

## PPh21 — TER method

Since PMK 168/2023, monthly withholding uses **TER (Tarif Efektif Rata-rata)** — a table lookup, not the old annualised calculation.

**Monthly (Jan–Nov):**
1. Determine TER category (A / B / C) from PTKP status — `VERIFY` mapping
2. Take monthly gross (bruto)
3. Look up the TER rate for that category and income bracket
4. PPh21 = gross × TER rate

**December, or the final month of employment:** annual reconciliation using the progressive method. Compute tax for the full year properly, subtract PPh21 already withheld Jan–Nov; the difference is December's withholding. **It can be negative (refund).**

This is why `employee_ytd` is mandatory and why YTD import matters for mid-year onboarding — without accumulated figures, December is simply wrong.

Indicative progressive brackets for the December calculation (`VERIFY` all):

| Annual taxable income (PKP) | Rate |
|---|---|
| up to 60jt | 5% |
| 60jt – 250jt | 15% |
| 250jt – 500jt | 25% |
| 500jt – 5M | 30% |
| above 5M | 35% |

Indicative PTKP (`VERIFY`): TK/0 = 54jt/year; +4,5jt for married; +4,5jt per dependant, max 3.

Also required for the annual calculation: **biaya jabatan** — 5% of gross with an annual cap (`VERIFY` amount).

**Implementation notes**
- Non-NPWP employees historically incurred a surcharge — `VERIFY` current rule
- An employee joining mid-year at a new employer: **each employer issues its own 1721-A1 for its own period.** Do not attempt to combine.
- Round per current DJP rules — `VERIFY` the rounding *unit*

## BPJS

Two schemes, five programs. Indicative rates — `VERIFY` all:

| Program | Employer | Employee | Wage cap |
|---|---|---|---|
| JHT | 3,70% | 2,00% | none |
| JKK | 0,24%–1,74% (risk class) | — | none |
| JKM | 0,30% | — | none |
| JP | 2,00% | 1,00% | capped, adjusted annually |
| Kesehatan | 4,00% | 1,00% | capped |

- JKK rate depends on the **company's** risk classification — store per company
- Employer contributions are **not** deductions from net pay, but must appear in payroll cost reporting; some are taxable benefits — `VERIFY`
- The calculation base is determined by the `base_for_bpjs_tk` / `base_for_bpjs_kes` flags on each salary component, not by a fixed definition
- Wage caps are dated values in `stat_bpjs_rates`
- `VERIFY` the BPJS rounding *unit*

## Overtime (lembur)

Per KEP-102/MEN/2004 — `VERIFY` against current regulation.

- Hourly wage = monthly wage ÷ **173**
- Wage base = gaji pokok + tunjangan tetap (components flagged `base_for_overtime`)
- **Weekday:** first hour 1,5×; subsequent hours 2×
- **Rest day / public holiday:** a different multiplier schedule that varies by whether the working week is 5 or 6 days — `VERIFY` and implement **as a table**, not as hardcoded multipliers

Configurable per company: whether overtime is auto-calculated from attendance or requires an approved request. **Default is *requires request*** — auto-calculation from raw clock-out times produces disputes.

## THR

- Entitlement after 1 month of continuous service
- 12+ months service: 1 month's wage
- 1–12 months: proportional (months ÷ 12 × monthly wage)
- Base = gaji pokok + tunjangan tetap (components flagged `base_for_thr`)
- Paid as a separate `payroll_run` with `run_type = 'thr'`
- THR is taxable — `VERIFY` current treatment under TER

## Employment types

Each type changes proration, BPJS eligibility, THR calculation and contract tracking. Adding a type later means reworking calculation logic, so **all of these exist from the start**:

| Type | Notes |
|---|---|
| `pkwtt` | Permanent |
| `pkwt` | Fixed-term; contract end date tracked, expiry alerts |
| `harian_lepas` | Daily; paid per present day; different BPJS treatment |
| `borongan` | Piece rate; quantity × rate |
| `magang` | Intern; often outside BPJS |

## Proration

Two independent cases, both configurable:

**Join / leave mid-period** — divisor is calendar days or working days in the period, set by `payroll_calendars.proration_basis`. Must be explicit, never assumed.

**Absence** — applies only to components flagged `prorate_on_absence`. Meal and transport allowances are typically per-present-day rather than prorated.

Known trap: **WFH days must not be treated as absence** when reducing attendance incentives. Define the attendance-incentive base explicitly.

## Night shift crossing midnight

Clock in 22:00 on the 5th, clock out 06:00 on the 6th.

**Decided: `work_date` = the date the shift STARTS**, with `shift_templates.crosses_midnight = true` driving the end-time comparison. One shift is always one `attendances` row.

```
work_date    = 2026-07-05
clock_in_at  = 2026-07-05 22:00 WIB
clock_out_at = 2026-07-06 06:00 WIB
```

Why start date and not end date or majority-of-hours: `work_date` then lines up with `shift_assignments.work_date`, so the schedule and the realised attendance are keyed identically. Majority-of-hours was rejected outright — overtime on the front of a shift would silently move a row to a different date, which is not a property you want in a payroll input.

Everything about overtime and attendance depends on this. Changing it after production data exists means recalculating every attendance row.

Timezones: WIB / WITA / WIT. All timestamps `timestamptz`; use `companies.timezone` for display and for day-boundary logic.

## Calculation order — gross to net

An explicit ordered pipeline. Each step writes `payroll_items` with its inputs recorded in `meta`. Every step must be inspectable — "why is this number what it is" has to be answerable from stored data.

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

**Steps 9–11 are order-sensitive and must not be reordered without a rate check.**

## Rounding

**Decided: round per component, immediately, before the value is stored.** Full rationale in `conventions.md`. In summary:

- All money is integer rupiah — no sub-rupiah value ever persists or crosses a pipeline step
- Every component result is rounded as it is written to `payroll_items`, so `gross`, `total_deduction` and `net` are exact sums of their stored lines
- Rounding at the end was rejected — it lets payslip lines disagree with the printed total
- PPh21 rounding **unit** per DJP rules — `VERIFY`
- BPJS rounding **unit** — `VERIFY`

The two `VERIFY` items ask whether either statutory figure rounds to a unit coarser than the nearest rupiah. They do **not** reopen where rounding happens.

Changing this rule after thousands of payslips are issued is very expensive.

## No formula builder

Salary components are the parameterised types in `data-model.md` plus the seven boolean treatment flags. That covers roughly 90% of real requirements.

A formula builder means building a small programming language and then debugging other people's formulas over WhatsApp. At Rp450.000/month per client, one such ticket consumes a year of margin. Competitors at this price point lose by being *too* flexible to use, not by being too rigid. Curated flexibility is the advantage.

## Configuration templates

An empty configuration screen will kill self-serve onboarding. Ship presets: **Retail/Toko, F&B, Manufaktur (shift), Kantor.** Client picks one, adjusts a little, done in 15 minutes.

Before saving configuration, run a **dry-run against 3–5 sample employees and show the resulting payslips.** Most misconfiguration is caught here rather than becoming a support ticket. Cheap to build, high impact.

## Outputs

- **Payslip PDF** — immutable once issued
- **Bank transfer file** — CSV/TXT in BCA, Mandiri, BNI, BRI bulk formats. `VERIFY` each bank's current spec.
- **1721-A1 data export** — for HR to file. We do not submit.
- **BPJS reporting export**
- **Journal CSV** — for accounting

We do not do disbursement or e-Filing. Export the file; HR uploads it.

## VERIFY register

Every item below blocks the capability named. Resolve before seeding.

| # | Item | Blocks |
|---|---|---|
| 1 | TER category (A/B/C) mapping from PTKP status | CAP-20 |
| 2 | TER bracket table values | CAP-20 |
| 3 | PTKP amounts per status code | CAP-20 |
| 4 | Progressive bracket boundaries and rates | CAP-20 |
| 5 | Biaya jabatan rate and annual cap | CAP-20 |
| 6 | Non-NPWP surcharge — current rule | CAP-20 |
| 7 | PPh21 rounding unit | CAP-20 |
| 8 | BPJS rates and employer/employee split, all five programs | CAP-21 |
| 9 | JP and Kesehatan wage caps (adjusted annually) | CAP-21 |
| 10 | JKK risk-class rate band | CAP-21 |
| 11 | Employer BPJS as taxable benefit — which programs | CAP-21, CAP-20 |
| 12 | BPJS rounding unit | CAP-21 |
| 13 | Rest-day / holiday overtime multipliers, 5-day vs 6-day week | CAP-19 |
| 14 | THR treatment under TER | CAP-22 |
| 15 | Bank bulk-transfer file specs (BCA, Mandiri, BNI, BRI) | CAP-26 |
