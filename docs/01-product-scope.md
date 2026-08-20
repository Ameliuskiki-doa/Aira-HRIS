# 01 — Product Scope

## Who this is for

Indonesian SMBs, 20–150 employees. Sweet spot 30–80. Sectors where attendance is
non-trivial: retail multi-outlet, F&B, light manufacturing with shifts,
distribution, service companies with field staff.

The realistic customer is **currently using Excel + WhatsApp**, not switching
from a competitor. Migration from an incumbent will be rare — price alone will
not motivate it. Product messaging targets the cost of manual payroll error, not
a feature comparison.

## Who this is NOT for

- BUMN, government, listed enterprises — data residency, ISO 27001, procurement
- Companies over ~300 employees — org complexity we deliberately do not model
- Companies needing payroll disbursement, e-Filing, or accounting integration

If a prospect needs those, the answer is "not yet", not a custom build.

## Pricing model

| Tier | Price | Contents |
|---|---|---|
| Free | Rp0, up to 10 employees | Attendance, leave, shift, employee data. Photo retention 30 days. |
| Core | Rp10.000/employee/month | + multi-branch, approvals, reports, export |
| Payroll | Rp15.000/employee/month | + overtime, PPh21, BPJS, payslip, bank transfer file |

Minimum billing Rp250.000/month. Annual: pay 12, get 14 months.

Commercial differentiators are **no setup fee, monthly billing, self-serve
onboarding** — not price per seat. Incumbents charge Rp5–15jt implementation and
require annual contracts.

## Infrastructure budget

Infra must stay under 6% of revenue. At 100 clients / 4.000 employees that is
roughly USD 180/month total. If a design choice pushes past this, flag it.

The dominant cost driver is attendance photo egress. This is why photos live on
R2 and why compression, thumbnails, and retention rules are requirements rather
than optimisations.

## Explicitly out of scope

Do not build these. If asked, point back here.

| Excluded | Why |
|---|---|
| Salary disbursement | Requires a licensed PJP partner |
| e-Bupot / e-Filing submission | Export the file; HR uploads it |
| Accounting integration | CSV journal export only |
| Formula builder for salary | Support cost exceeds ARPU |
| Performance management, LMS | Different product |
| Full ATS / recruitment pipeline | SMBs hire ~5 people/year via WhatsApp |
| Realtime dashboards | Polling is sufficient; realtime connections are billed |
| Per-client database | Compute is billed per project |
| Custom payslip layouts per client | Configuration, or no |

## The rule for new options

Add a configuration option only when **three separate clients** have asked for
the same thing. One request is a custom demand, and the answer is no.

Every option is a permanent support liability: one more doc line, one more path
that can break, one more combination to test. At Rp450.000/month per client, a
single support call can consume a year of margin.

## Constraints that shape everything

- **Self-serve is mandatory, not aspirational.** No manual onboarding, no
  training sessions, no price negotiation. Excel import wizard is a core feature,
  not a nice-to-have.
- **Support is deflected, not staffed.** Knowledge base, short videos, WhatsApp
  bot for repeat questions.
- **Most clients arrive mid-year.** YTD import (accumulated gross and PPh21 since
  January) must work from day one or you can only onboard every January.
