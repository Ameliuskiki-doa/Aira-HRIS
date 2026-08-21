# Data Model

Companion to `SPEC.md`. The schema contract. All tables carry `tenant_id uuid not null` unless marked otherwise, and all tables have RLS enabled and forced. Money columns are `bigint` — integer rupiah (`conventions.md`).

## Organisational hierarchy

```
organizations        billing account, owner   [above tenant boundary]
  └── companies      legal entity (PT)        [= tenant_id, RLS boundary]
        └── branches locations, GPS geofence
              └── departments  (tree)
                    └── positions
```

```sql
-- Above the tenant boundary. Access controlled by ownership, not RLS tenant_id.
create table organizations (
  id            uuid primary key,
  name          text not null,
  owner_user_id uuid not null,
  plan          text not null,            -- free|core|payroll
  created_at    timestamptz not null default now()
);

create table companies (
  id              uuid primary key,
  organization_id uuid not null references organizations,
  legal_name      text not null,
  npwp            text,
  npp_bpjs_tk     text,
  bpjs_kes_code   text,
  address         text,
  timezone        text not null default 'Asia/Jakarta',  -- WIB|WITA|WIT
  created_at      timestamptz not null default now()
);
-- companies.id IS the tenant_id used everywhere else.

create table branches (
  id          uuid primary key,
  tenant_id   uuid not null references companies,
  name        text not null,
  latitude    numeric(10,7),
  longitude   numeric(10,7),
  radius_m    integer not null default 100,
  address     text
);

create table departments (
  id          uuid primary key,
  tenant_id   uuid not null,
  parent_id   uuid references departments,
  path        ltree not null,        -- indexed; avoids recursive CTE per request
  name        text not null,
  code        text
);

create table positions (
  id            uuid primary key,
  tenant_id     uuid not null,
  department_id uuid,
  title         text not null,
  level         smallint
);
```

**Why `path`:** approval routing constantly asks "everything under X". With `parent_id` alone that is a recursive CTE on every request.

**Build `organizations` now even for single-PT clients.** The relation is 1:1 and invisible to them. Inserting a layer above an existing hierarchy after production data exists is the expensive migration.

> Naming note: `docs/02` writes the cross-company policy example against `employees.company_id`, while this schema names that column `tenant_id`. They are the same value (`tenant_id` = `companies.id`). Pick one name and use it consistently in the implementation.

## Identity and membership

```sql
-- Global identity. Phone number is the primary identifier, not email.
-- auth.users is Supabase-managed; app_metadata carries active tenant_id.

create table memberships (
  id           uuid primary key,
  user_id      uuid not null,          -- auth.users.id
  company_id   uuid not null,
  employee_id  uuid,                   -- null for external accountants etc.
  role         text not null,          -- admin|hr_manager|hr_staff|supervisor|staff|accountant
  is_active      boolean not null default true,
  last_active_at timestamptz,          -- the active company; see AD-37
  created_at     timestamptz not null default now(),
  unique (user_id, company_id)
);
```

The role set is **fixed and not tenant-customisable** — see AD-33 for the tier table and the reasoning. `accountant` carries a null `employee_id`. `owner` is not a membership role: it lives above the tenant boundary on `organizations.owner_user_id`.

**Many-to-many is required from day one.** One person can sit in several companies (group HR, directors, outsourcing vendors). Converting a unique `employees.user_id` to many-to-many after production data exists is painful.

**Auth is phone + OTP (WhatsApp), or employee ID + PIN.** Not email/password. Warehouse staff, SPG and field workers do not have work email and will forget passwords. This is a leading cause of adoption failure in this segment.

## Employees and dated assignments

```sql
create table employees (
  id                  uuid primary key,
  tenant_id           uuid not null,
  user_id             uuid,                  -- links to auth.users when activated
  employee_no         text not null,
  full_name           text not null,
  nik                 text,                  -- KTP; personal data under UU PDP
  npwp                text,
  ptkp_status         text,                  -- TK/0, K/1, ...
  join_date           date not null,         -- at THIS company
  original_join_date  date,                  -- group-level, for inter-PT transfers
  termination_date    date,
  status              text not null,         -- active|inactive|terminated|transferred
  bank_name           text,
  bank_account        text,
  bpjs_tk_no          text,
  bpjs_kes_no         text,
  custom_fields       jsonb not null default '{}',
  unique (tenant_id, employee_no)
);

create table employee_assignments (
  id                  uuid primary key,
  tenant_id           uuid not null,
  employee_id         uuid not null,
  branch_id           uuid,
  department_id       uuid,
  position_id         uuid,
  manager_id          uuid,                  -- separate from department tree
  employment_type     text not null,         -- pkwtt|pkwt|harian_lepas|borongan|magang
  contract_start      date,
  contract_end        date,
  payroll_calendar_id uuid not null,
  valid_from          date not null,
  valid_to            date
);
```

**This is the table that cannot be retrofitted.** If department and position live directly on `employees` and someone transfers in June, recalculating March payroll uses June's structure. Cost allocation breaks and reprinted payslips no longer match the originals.

Payroll always asks "where was this person on date X", never "where are they now".

- **`manager_id` is separate from `department_id`** — reporting lines and org lines diverge routinely. Never derive the approver from the department tree.
- **Approvals target `position_id`, not `user_id`.** When a supervisor resigns, every routing pointing at their user id breaks and HR fixes it by hand.
- **Custom fields via JSONB.** Never `ALTER TABLE` for one tenant's extra column.

## Payroll calendar and periods

Two period models must both work: calendar month, and mid-month cut-off (e.g. 21–20). The key is that **work period, payment date, and tax month are three different things.**

| | Calendar month | Cut-off 21–20 |
|---|---|---|
| Attendance period | 1–31 Jul | 21 Jun – 20 Jul |
| Payment date | 31 Jul | 25 Jul |
| **Tax month** | **July** | **July** |

Tax month and BPJS period always follow the **payment date**, not the work period. Store the period as a date range plus a separate payment date, and derive the tax month. Both models then become instances of one structure.

```sql
create table payroll_calendars (
  id                uuid primary key,
  tenant_id         uuid not null,
  name              text not null,         -- 'Staff Bulanan', 'Harian Cut-off'
  period_type       text not null,         -- calendar_month|cutoff|weekly
  cutoff_start_day  smallint,              -- 21, null for calendar_month
  cutoff_end_day    smallint,              -- 20
  payment_day       smallint not null,     -- 25
  payment_offset    smallint not null default 0,
  month_end_rule    text not null default 'clamp',   -- clamp|last_day
  holiday_rule      text not null default 'before',  -- before|after
  proration_basis   text not null,         -- calendar_days|working_days
  valid_from        date not null,
  valid_to          date
);

create table payroll_periods (
  id                   uuid primary key,
  tenant_id            uuid not null,
  calendar_id          uuid not null,
  code                 text not null,      -- '2026-07'
  work_start_date      date not null,
  work_end_date        date not null,
  payment_date         date not null,
  tax_year             smallint not null,  -- derived from payment_date
  tax_month            smallint not null,
  attendance_locked_at timestamptz,
  status               text not null,      -- draft|attendance_locked|calculating|
                                           -- review|approved|paid|closed
  unique (tenant_id, calendar_id, code)
);
```

`payroll_calendar_id` attaches to **`employee_assignments`, not to the company** — one PT routinely has office staff on calendar month and daily workers on cut-off.

Generate periods 24 months ahead.

## Salary components

Parameterised types, not free-form formulas. Reasoning in `statutory-rules.md`.

```sql
create table salary_component_defs (
  id                     uuid primary key,
  tenant_id              uuid not null,
  code                   text not null,
  name                   text not null,
  kind                   text not null,   -- earning|deduction
  calc_type              text not null,   -- fixed|per_present_day|per_hour|
                                          -- per_unit|percent_of_base
  taxable                boolean not null,
  base_for_bpjs_tk       boolean not null,
  base_for_bpjs_kes      boolean not null,
  base_for_overtime      boolean not null,  -- "tunjangan tetap" or not
  base_for_thr           boolean not null,
  prorate_on_join_leave  boolean not null,
  prorate_on_absence     boolean not null,
  show_on_payslip        boolean not null default true,
  valid_from             date not null,
  valid_to               date,
  unique (tenant_id, code, valid_from)
);

create table employee_salary_components (
  id            uuid primary key,
  tenant_id     uuid not null,
  employee_id   uuid not null,
  component_id  uuid not null,
  amount        bigint,          -- integer rupiah
  rate          bigint,          -- per day/hour/unit
  percentage    numeric(5,2),
  valid_from    date not null,
  valid_to      date
);
```

Those seven boolean treatment flags are what actually differ between companies — **not the arithmetic.** They are configurable via checkbox.

## Payroll runs and payslips

```sql
create table payroll_runs (
  id            uuid primary key,
  tenant_id     uuid not null,
  period_id     uuid not null,
  run_type      text not null,      -- regular|thr|bonus|correction
  sequence      smallint not null,  -- multiple runs per period
  status        text not null,      -- draft|calculating|review|locked|paid
  config_snapshot jsonb,            -- config as used, not a reference
  locked_at     timestamptz,
  locked_by     uuid,
  unique (tenant_id, period_id, run_type, sequence)
);

create table payroll_items (
  id            uuid primary key,
  tenant_id     uuid not null,
  run_id        uuid not null,
  employee_id   uuid not null,
  component_code text,
  category      text not null,      -- earning|deduction|employer_contribution|tax
  amount        bigint not null,
  meta          jsonb               -- inputs used: days, hours, rate, base
);

create table payslips (
  id            uuid primary key,
  tenant_id     uuid not null,
  run_id        uuid not null,
  employee_id   uuid not null,
  gross         bigint not null,
  total_deduction bigint not null,
  net           bigint not null,
  snapshot      jsonb not null,     -- immutable full breakdown
  pdf_url       text,
  issued_at     timestamptz
);
```

- **Multiple runs per period is the default assumption**, not an edge case. Regular, THR, bonus and correction runs all point at the same period. This is what makes corrections possible without unlocking a closed run.
- **`config_snapshot` stores the config as used, not a reference to it.** A payslip must remain explainable regardless of later configuration changes.

## Year-to-date

```sql
create table employee_ytd (
  id                uuid primary key,
  tenant_id         uuid not null,
  employee_id       uuid not null,
  tax_year          smallint not null,
  gross_ytd         bigint not null default 0,
  pph21_ytd         bigint not null default 0,
  bpjs_tk_ytd       bigint not null default 0,
  bpjs_kes_ytd      bigint not null default 0,
  source            text not null,   -- calculated|imported
  unique (tenant_id, employee_id, tax_year)
);
```

`source = 'imported'` covers mid-year migration. Without it, December reconciliation and 1721-A1 are wrong. **Most clients arrive mid-year, so this is a launch requirement, not a later feature.**

## Attendance

```sql
create table attendances (
  id            uuid primary key,
  tenant_id     uuid not null,
  employee_id   uuid not null,
  work_date     date not null,      -- shift START date; see statutory-rules.md
  shift_id      uuid,
  clock_in_at   timestamptz,
  clock_out_at  timestamptz,
  clock_in_lat  numeric(10,7),
  clock_in_lng  numeric(10,7),
  branch_id     uuid,
  photo_key     text,               -- R2 object key
  thumb_key     text,
  status        text not null,      -- present|late|absent|leave|holiday
  late_minutes  integer,
  work_minutes  integer,
  is_locked     boolean not null default false,
  client_uuid   uuid,               -- idempotency key for offline sync
  unique (tenant_id, employee_id, work_date, client_uuid)
) partition by range (work_date);
```

`client_uuid` makes offline sync idempotent — the device generates it, so a retry cannot double-post.

> **Open (see SPEC.md):** this unique key permits several rows per employee per `work_date` under different `client_uuid`s, which conflicts with the one-shift-one-row rule in `statutory-rules.md`. Resolve before implementing CAP-11 / CAP-12.

## Leave

```sql
create table leave_types (
  id                uuid primary key,
  tenant_id         uuid not null,
  name              text not null,
  is_paid           boolean not null,
  quota_days        numeric(4,1),
  carry_over_months smallint,
  requires_document boolean not null default false
);

create table leave_balances (
  id           uuid primary key,
  tenant_id    uuid not null,
  employee_id  uuid not null,
  leave_type_id uuid not null,
  period_year  smallint not null,
  allocated    numeric(4,1) not null,
  used         numeric(4,1) not null default 0,
  carried_over numeric(4,1) not null default 0
);

create table leave_requests (
  id           uuid primary key,
  tenant_id    uuid not null,
  employee_id  uuid not null,
  leave_type_id uuid not null,
  start_date   date not null,
  end_date     date not null,
  days         numeric(4,1) not null,
  reason       text,
  document_url text,
  status       text not null,    -- draft|submitted|supervisor_approved|
                                 -- approved|rejected|cancelled
  created_at   timestamptz not null default now()
);
```

## Shifts

```sql
create table shift_templates (
  id              uuid primary key,
  tenant_id       uuid not null,
  name            text not null,
  start_time      time not null,
  end_time        time not null,
  crosses_midnight boolean not null default false,
  break_minutes   integer not null default 0,
  late_tolerance_minutes integer not null default 0
);

create table shift_assignments (
  id           uuid primary key,
  tenant_id    uuid not null,
  employee_id  uuid not null,
  shift_id     uuid not null,
  work_date    date not null,
  unique (tenant_id, employee_id, work_date)
);
```

## Audit

```sql
create table audit_logs (
  id          uuid primary key,
  tenant_id   uuid not null,
  actor_id    uuid,
  entity      text not null,
  entity_id   uuid,
  action      text not null,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now()
) partition by range (created_at);
```

Payroll-affecting mutations must be logged. This is both a compliance need and a sales credibility signal.

`audit_logs` is **mutation-shaped**. Reads are logged separately, below.

## PII access log

```sql
create table pii_access_logs (
  id           uuid primary key,
  tenant_id    uuid not null,
  actor_id     uuid,
  field_class  text not null,      -- nik|salary
  scope        text not null,      -- what was queried
  record_count integer not null,   -- how many records were exposed
  created_at   timestamptz not null default now()
) partition by range (created_at);
```

**One row per request, not per record.** A 200-employee list view writes one row naming the field class and a count of 200. Logging per record would put 200 writes on a read path and swamp the table mutations depend on. See AD-38.

## Global reference tables

The only tables **without** `tenant_id`. Readable by all, writable by service role only, explicitly allowlisted in the isolation test.

```sql
create table stat_tax_ter (
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

Overtime multipliers are a table of the same shape (`statutory-rules.md`), not hardcoded constants.
