# 05 — Modules

Each module lists scope, key rules, and acceptance criteria. Criteria are the
contract — a module is not done until all of them pass.

---

## M1 — Employee Management

Employee data, documents, org structure, dated assignments, salary components.

**Rules**
- Assignment changes are new rows, never updates
- Salary changes are new `employee_salary_components` rows with `valid_from`
- Custom fields via JSONB, never `ALTER TABLE`
- NIK and salary are personal data — restricted by role, access logged

**Acceptance**
- [ ] Transferring an employee between departments in June leaves March payroll unchanged
- [ ] Excel import handles 200 employees with a validation report and preview before commit
- [ ] Import can be re-run idempotently after fixing errors
- [ ] Querying "position on date X" returns the historically correct value
- [ ] Org chart renders from `ltree` without a recursive query

---

## M2 — Attendance

Clock in/out with GPS and photo, offline sync, corrections, locking.

**Rules**
- Photo → R2 via signed URL, compressed client-side to 60–80 KB
- Thumbnail generated at upload; list views never load full images
- Geofence check against `branches` radius; out-of-range needs a reason and flag
- Offline queue with `client_uuid` idempotency key
- Night shift `work_date` per the rule in `docs/04`
- Locking attendance is a separate step from locking payroll

**Acceptance**
- [ ] Clock-in works offline and syncs without duplicates when reconnected
- [ ] Submitting the same `client_uuid` twice creates one row
- [ ] A shift 22:00–06:00 is attributed to one `work_date`, and overtime is correct
- [ ] Monthly recap for 500 employees renders under 2s from a materialized view
- [ ] After lock, corrections require an authorised role and are audit-logged
- [ ] Fake GPS detection flags mock-location devices

---

## M3 — Leave

Requests, multi-level approval, balances, conflict detection, carry-over.

**Rules**
- Approval routes to `position_id`, resolved to the current holder
- Balance is decremented on final approval, not on submission
- Conflict warning when team coverage drops below a threshold
- Paid leave feeds attendance as `status = 'leave'`, not absence

**Acceptance**
- [ ] Supervisor resignation does not break pending approval routing
- [ ] Overlapping requests for the same employee are rejected
- [ ] Cancelling an approved request restores the balance correctly
- [ ] Carry-over runs at year end per configured policy
- [ ] Approved leave does not reduce attendance-based allowances incorrectly

---

## M4 — Shift Scheduling

Templates, assignment, team and personal views, coverage.

**Rules**
- `crosses_midnight` must be explicit on the template
- Bulk assignment by department or branch, with a date range
- Late tolerance is per template

**Acceptance**
- [ ] Assigning a month of shifts to 100 employees is one operation
- [ ] Overnight shifts compute work minutes correctly across the date boundary
- [ ] Coverage view shows unassigned days for a selected week

---

## M5 — Payroll

The core. See `docs/04` for calculation rules.

**Rules**
- Periods generated from `payroll_calendars`, 24 months ahead
- Multiple runs per period: regular, THR, bonus, correction
- Locking a run snapshots config and freezes every payslip
- Corrections are a new run, never an edit
- Every `payroll_item` records its inputs in `meta`

**Acceptance**
- [ ] Both calendar-month and cut-off calendars produce correct tax months
- [ ] Two employees on different calendars in the same company both calculate correctly
- [ ] A locked run cannot be modified by any code path, including the worker
- [ ] Reprinting a January payslip in December produces byte-identical figures
- [ ] Payroll for 2.000 employees completes without timeout and is resumable
- [ ] Re-running a completed job does not double-post (idempotency)
- [ ] Every figure on a payslip can be traced to its inputs
- [ ] Mid-year YTD import produces a correct December reconciliation
- [ ] Bank transfer file validates against each bank's spec

---

## M6 — Approvals

Generic engine used by leave, overtime, and correction requests.

**Rules**
- Routes target positions and department paths, not users
- Configurable levels per request type
- Delegation when an approver is on leave
- Escalation after a configurable timeout

**Acceptance**
- [ ] Adding a new approvable entity requires no engine changes
- [ ] Approver on leave routes to their delegate automatically
- [ ] Full approval history is retained after the request closes

---

## M7 — Administration & Configuration

Users, roles, departments, positions, leave policies, holiday calendar, salary
component definitions, payroll calendars.

**Rules**
- Payroll-affecting config is dated, not mutable
- Templates for Retail, F&B, Manufaktur, Kantor
- Dry-run simulation before saving payroll config
- Holiday calendar seeded with national holidays, editable per company

**Acceptance**
- [ ] A new client completes configuration in under 30 minutes with no assistance
- [ ] Changing a policy in July leaves March payroll unaffected
- [ ] Dry-run shows sample payslips before config is committed
- [ ] Role changes take effect without re-login issues

---

## M8 — Billing & Subscription

**Rules**
- Billed at organization level; headcount summed across companies
- Active-employee count on a defined snapshot date
- Overdue → **read-only, never blocked.** Withholding access to payroll data is
  the fastest way to lose reputation.
- Annual billing reduces gateway fees to 1/12 and locks in retention

**Acceptance**
- [ ] Mid-month joiners and leavers prorate correctly
- [ ] Free tier enforces the 10-employee limit and 30-day photo retention
- [ ] Dunning sequence runs on payment failure
- [ ] Read-only mode still allows payslip download and export

---

## Cross-cutting

**Recruitment (M9)** — deliberately deferred. SMBs hire ~5 people/year via
WhatsApp. If built later, keep it as a paid add-on, not part of the core story.

**Notifications** — WhatsApp per-message cost can rival infrastructure cost.
Model it before enabling broadly. Batch and digest rather than per-event.

**Reports** — all aggregates from materialized views, refreshed nightly with
incremental current-day updates.
