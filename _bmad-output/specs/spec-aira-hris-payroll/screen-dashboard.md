# Screen — HR Dashboard

Companion to `SPEC.md`. The specification for the HR manager's landing screen, taken from `HRIS Dashboard.dc.html` in Claude Design project `dcaaa7ad-e795-4fad-8b3e-223f30a4ad1d`. Visual tokens and component classes come from `design-system.md`.

**Status: documented, not implemented.** Non-happy states live in `screen-dashboard-states.md`; responsive, switcher, notification and accessibility behaviour in `screen-dashboard-interaction.md`. No code exists for this screen. Supabase `public` holds zero tables, so every figure below is fixture data.

> **Component layer superseded by AD-36.** Class references below (`.card`, `.btn-primary`, `.tag-accent`, `.table`, `.seg`) describe the intended component shape. Implementation uses shadcn components styled with Nocturne tokens — see the mapping table in `design-system.md`. Sizes, spacing, colours and behaviour in this document are unchanged and remain binding.

## Purpose and audience

The signed-in HR manager of one company (one PT = one `tenant_id`), landing after login. The screen answers three questions in one view:

1. Is today's attendance normal?
2. What is blocking the payroll run in flight, and does it add up?
3. What needs my decision right now?

Everything else is navigation. The screen commits no writes — every action is a link or a disclosure.

## Capability coverage

| Region | Capabilities served |
|---|---|
| Stat row, attendance-by-outlet table | CAP-14 (recap from materialized views), CAP-10 |
| Payroll run card, component breakdown | CAP-18 (traceable pipeline), CAP-17, CAP-19, CAP-20, CAP-21, CAP-23 |
| Needs action | CAP-27 (approval engine), CAP-15 |
| Compliance warnings | CAP-6 (PKWT tracking), CAP-24 (YTD), CAP-10 (geofence) |
| Audit trail | CAP-9, CAP-13, CAP-23 |
| Company switcher | CAP-2 (one active company per token) |
| Sidebar retention card | CAP-5 |

It introduces **no new capability**. It is a surface over existing ones.

## Frame

- Preview 1440 × 1080. Grid `236px / minmax(0, 1fr)`, `min-height: 100vh`.
- Base font size **13px** — the screen runs denser than the Nocturne 15px body default.
- Ground `--color-bg`; sidebar and cards `--color-surface`.
- No responsive behaviour is specified in the artboard. Breakpoint rules are an open decision (see below).

## Sidebar — 236px

`padding: 20px 14px`, `gap: 24px`, `box-shadow: 1px 0 0 var(--color-divider)`.

**Brand.** 26px square, `border-radius: 7px`, 1px accent border, accent `ph-pulse` at 15px, glow `0 0 18px rgba(145,132,217,0.28)`. Beside it "Aira" at 14px/500 over the active plan at 9px uppercase, `0.12em`, `--ui-faint`.

**Navigation.** Four labelled groups. Group labels 9px, `0.14em`, uppercase, `--ui-faint`. Items are `padding: 7px 8px`, `--radius-md`, `--ui-nav`, icon at 15px, `gap: 9px`. Hover takes `--ui-hover` + `--color-text`. The active item takes `--ui-active-bg` / `--ui-active-fg` plus an inset 1px ring of accent at 40%.

| Group (ID) | Items (ID) | Icon |
|---|---|---|
| Ringkasan | **Dasbor** *(active)* | `squares-four` |
| | Laporan | `chart-line` |
| Karyawan | Data Karyawan | `users-three` |
| | Absensi | `fingerprint` |
| | Cuti | `airplane-takeoff` |
| | Jadwal Shift | `calendar-dots` |
| Payroll | Proses Payroll | `receipt` |
| | Persetujuan `[22]` | `check-square-offset` |
| Pengaturan | Konfigurasi | `sliders-horizontal` |
| | Langganan | `credit-card` |

Approvals carries a `.tag-accent` count badge at 10px, `padding: 1px 7px`, bound to the same `approvalTotal` as the Needs-action card. One source, two placements.

**Footer card.** `margin-top: auto`, `padding: 11px`, `--radius-md`, `--ui-hover` ground, `--shadow-sm`. Kicker 10px uppercase `0.1em`; body 12px `--ui-body`. Carries the photo-retention notice (CAP-5).

## Header

`padding: 14px 28px`, `gap: 16px`, `box-shadow: 0 1px 0 var(--color-divider)`.

- **Company switcher** — `padding: 5px 10px`, `--radius-md`, `--shadow-sm`. Accent `ph-buildings` at 14px, legal name at weight 500, branch count in `--ui-muted`, `ph-caret-up-down` at 13px. The caret implies a menu the artboard does not draw. Per CAP-2, choosing another company **reissues the token**; it is not a client-side filter.
- **Range segmented control** — `.seg` with three options at `padding: 5px 11px`, 12px: Hari ini · Bulan ini · Periode payroll. Active takes `--ui-active-bg` / `--ui-active-fg`.
- **Right cluster** — current date and timezone at 12px `--ui-muted`, rendered from `companies.timezone`; theme toggle (`.btn .btn-secondary`, icon and label swap with the active theme); notification bell (`.btn .btn-icon .btn-secondary`); then a 28px circular avatar on `--color-accent-800` / `--color-accent-100` carrying initials, with name at 12px and role at 10px `--ui-muted`, separated by an inset left rule.

## Content

`padding: 24px 28px 40px`, `gap: 20px`.

### Hero row

`h1` at 26px/500 greeting the user by first name, with a one-line status beneath in `--ui-body` naming the period in flight and its payment date. Right-aligned: **Ekspor** (`.btn-secondary`, `download-simple`) and **Lanjutkan proses payroll** (`.btn-primary`, `play`).

### Stat row — 5 columns, `gap: 12px`

Each is `.card .elev-sm`, `padding: 14px`, `gap: 8px`: label 10px uppercase `0.1em` `--ui-body`; value 27px/500 `-0.02em` beside a unit at 12px `--ui-muted`; note at 11px `--ui-body`.

| Label | Value | Unit | Note |
|---|---|---|---|
| Karyawan aktif | 84 | orang | +3 masuk bulan ini · 1 PKWT berakhir |
| Hadir hari ini | 71 | dari 84 | 84,5% · rekap dari materialized view |
| Terlambat | 6 | orang | Toleransi per template shift |
| Cuti & izin | 4 | orang | Semua cuti berbayar |
| Belum absen | 3 | orang | 2 di luar geofence outlet |

### Two-column grid — `1.62fr / 1fr`, `gap: 20px`, `align-items: start`

## Payroll run card *(left column, primary)*

`.card .elev-sm`, `padding: 0`, `overflow: hidden`. Four stacked bands.

**1 — Head** (`padding: 16px 18px`). Kicker 10px uppercase `--ui-accent-text`; `h2` 17px/500 naming period, run type and sequence; meta line 11px `--ui-muted` carrying calendar name, work period, payment date and **tax month**. Right: a `.tag-accent` stage chip and a `.tag-outline` payslip count.

The meta line is doing real work. It shows a July work period paying on 25 August with tax month **August** — the CAP-17 rule that tax month follows the *payment date*, not the work period, made visible. Keep it.

**2 — Pipeline** (`padding: 0 18px 14px`, wrap, `column-gap: 10px`, `row-gap: 8px`). Five steps, each an icon at 14px plus a label at 11px, separated by `ph-caret-right` at 11px `--ui-faint` on all but the last.

| # | Step | Icon | When run is locked |
|---|---|---|---|
| 1 | Absensi dikunci | `lock-simple` | unchanged |
| 2 | Snapshot konfigurasi | `camera` | unchanged |
| 3 | Perhitungan selesai | `check-circle` | unchanged |
| 4 | Review HR / `eye` | `eye` | Review selesai / `check-circle` |
| 5 | Kunci proses / `lock-key-open` | `lock-key-open` | Terkunci / `lock-key` |

**3 — Totals** — 3 columns at `gap: 1px` over a `--color-divider` ground, each cell `padding: 13px 18px` on `--color-surface`, so the divider shows through as hairlines. Label 10px uppercase, value 19px/500.

| Cell | Value | Treatment |
|---|---|---|
| Bruto | Rp 427.360.000 | — |
| Potongan | Rp 27.512.000 | — |
| Gaji bersih | Rp 399.848.000 | `box-shadow: inset 3px 0 0 var(--color-accent)`, accent label |

**4 — Component breakdown** (`padding: 6px 18px 16px`). A section label at 11px uppercase `0.08em` with a hint at 11px `--ui-faint` on the right, then one row per component.

Row grid is `18px minmax(0,1fr) auto 16px`, `gap: 10px`, `padding: 9px 8px`, `margin: 0 -8px`, `--radius-sm`, hover `--ui-hover`, `cursor: pointer`. Icon 14px `--ui-muted`; label 13px; amount 13px **tabular-nums**, deductions prefixed `−` and coloured `--ui-body` while earnings take `--color-text`; caret 13px `--ui-faint`.

Expanding a row reveals a panel at `margin: 2px 0 8px 28px`, `padding: 11px 13px`, `--radius-md`, `--ui-tint` ground, inset 1px ring of accent at 22%. Inside: key/value pairs at 12px with the value tabular and `white-space: nowrap`, then a provenance line at 11px `--ui-muted`.

**Exactly one row is open at a time** — clicking an open row closes it. Overtime is open on load.

| # | Component | Amount | Provenance line |
|---|---|---|---|
| 1 | Gaji pokok & tunjangan tetap | +358.400.000 | 84 penugasan aktif per 31 Jul 2026 · komponen dengan `valid_from` ≤ periode |
| 2 | Tunjangan variabel (per hari hadir) | +47.320.000 | Dari absensi terkunci · komponen bertanda `prorate_on_absence` |
| 3 | Lembur | +21.640.000 | Sumber: permohonan lembur disetujui, bukan jam pulang mentah · KEP-102/MEN/2004 |
| 4 | BPJS bagian karyawan | −12.960.000 | Basis dari flag `base_for_bpjs_tk` / `base_for_bpjs_kes` · batas upah bertanggal |
| 5 | PPh21 — metode TER | −9.402.000 | Tarif TER adalah data acuan bertanggal, tidak bisa diubah tenant · rekonsiliasi tahunan di Desember |
| 6 | Potongan lain | −5.150.000 | Kasbon dan koperasi · input tercatat di `meta` tiap `payroll_item` |

Detail rows carried by each component:

- **Gaji pokok** — basic salary (84 employees) 296.100.000 · position allowance 41.300.000 · other fixed 21.000.000 · proration for 3 July joiners −6.420.000 (calendar days)
- **Variabel** — meal Rp 25.000 × 1.612 present days = 40.300.000 · transport Rp 20.000 × 351 field days = 7.020.000 · **WFH days not counted as absence: 12**
- **Lembur** — 1.284 approved hours · hourly wage (base ÷ 173) Rp 24.162 · weekday first hour 1,5× = 7.412.000 · weekday subsequent 2× = 10.128.000 · rest day / public holiday 4.100.000
- **BPJS** — JHT 2,00% = 6.480.000 · JP 1,00% (cap applied) = 2.980.000 · Kesehatan 1,00% (cap applied) = 3.500.000
- **PPh21** — TER A (58 employees) 4.126.000 · TER B (21) 3.874.000 · TER C (5) 1.402.000 · **no NPWP (3) Rp 0 — rule needs verification**
- **Potongan lain** — advances (9 people) 3.400.000 · cooperative 1.750.000

Below the rows: a fading 1px rule, then the net line — "Gaji bersih untuk 84 karyawan" at 13px/500 with the amount at 14px/500 — and, when enabled, an employer-cost line at 12px `--ui-body` labelled as **cost, not a deduction**.

### The card is a correctness argument

Three things about this card are load-bearing, not decorative, and must survive implementation:

- **The figures reconcile exactly.** 358.400.000 + 47.320.000 + 21.640.000 = 427.360.000 gross. 12.960.000 + 9.402.000 + 5.150.000 = 27.512.000 deductions. That is the per-component rounding rule from `conventions.md` — gross and total_deduction are exact sums of their stored lines — demonstrated in the mockup's own arithmetic. Any fixture or query that breaks this breaks the screen's premise.
- **Every row discloses its inputs.** This is CAP-18's "every figure traces to its inputs" rendered as an interaction. The detail panel is the `payroll_items.meta` payload; the provenance line is where the number came from.
- **The employer BPJS line is separated from deductions** and labelled as cost. Per `statutory-rules.md` employer contributions are never deducted from net.

## Attendance by outlet *(left column, secondary)*

`.card .elev-sm`, `padding: 16px 18px`, `gap: 12px`. `h2` 15px/500 with a "Lihat rekap bulanan" link at 12px on the right. Then a `.table` at 12px.

Columns: Outlet (34%) · Hadir · Terlambat · Cuti · Belum absen · Kehadiran (22%). Numeric cells are tabular-nums. The outlet cell stacks name over a meta line at 10px `--ui-faint` (headcount and shift pattern).

The Kehadiran cell is a 4px track (`--ui-track`, `border-radius: 2px`) with an accent fill at the attendance percentage, and the percentage beside it in `--ui-body`.

| Outlet | Meta | Hadir | Terlambat | Cuti | Belum absen | % |
|---|---|---|---|---|---|---|
| Kelapa Gading | 18 karyawan · 2 shift | 15 | 2 | 1 | 0 | 94% |
| Bintaro | 14 karyawan · 2 shift | 12 | 1 | 1 | 0 | 93% |
| Bandung Dago | 12 karyawan · 1 shift | 9 | 2 | 0 | 1 | 92% |
| Surabaya Tunjungan | 16 karyawan · 2 shift | 14 | 1 | 1 | 0 | 94% |
| Semarang Simpang Lima | 11 karyawan · 1 shift | 8 | 0 | 1 | 2 | 73% |
| Cakung warehouse | 13 karyawan · shift malam | 13 | 0 | 0 | 0 | 100% |

Percentage is `(hadir + terlambat) / total`, rounded — late still counts as attendance. Rows sum to the outlet headcount, and the six outlets sum to the 84 in the stat row.

Per CAP-14 this table reads from a **materialized view**, not a live aggregate over `attendances`, and must render under 2s at 500 employees.

## Needs action *(right column)*

`.card .elev-sm`, `padding: 16px 18px`. `h2` 15px/500 with a `.tag-accent` total. Each row is `padding: 9px 0` with `box-shadow: inset 0 -1px 0 var(--color-divider)`: accent icon at 16px, label 13px over a note at 11px `--ui-muted`, count at 15px/500 tabular, `ph-arrow-right` at 13px `--ui-faint`. Closes with a `.btn-primary .btn-block`.

| Icon | Label | Note | Count |
|---|---|---|---|
| `airplane-takeoff` | Permohonan cuti | 3 bentrok dengan jadwal shift | 7 |
| `clock-clockwise` | Permohonan lembur | Periode 1–31 Agu | 12 |
| `pencil-simple` | Koreksi absensi | Setelah dikunci — tercatat di audit log | 3 |

7 + 12 + 3 = 22, matching the badge and the sidebar. Routing is by `position_id` per CAP-27, so this list survives an approver resigning.

## Compliance warnings *(right column)*

`.card .elev-sm`, `padding: 16px 18px`, `gap: 11px`. Items are `padding: 10px 11px`, `--radius-md`, `--ui-hover` ground; icon 15px `--ui-accent-text` with `margin-top: 1px`; title 12px `line-height: 1.45` over a note at 11px `--ui-muted`.

| Icon | Title | Note |
|---|---|---|
| `file-text` | 4 kontrak PKWT berakhir dalam 30 hari | Kelapa Gading (2), Bandung Dago (1), gudang Cakung (1) |
| `database` | 12 karyawan belum punya angka YTD 2026 | Tanpa YTD, rekonsiliasi PPh21 Desember akan salah |
| `map-pin-simple-area` | 2 absensi di luar radius geofence | Alasan sudah diisi, menunggu verifikasi supervisor |

These are the three failure modes the product cannot afford, surfaced before they bite: contract expiry (CAP-6), missing YTD that silently corrupts December (CAP-24), and unverified out-of-geofence punches (CAP-10).

## Audit trail *(right column)*

`.card .elev-sm`, `padding: 16px 18px`, `gap: 10px`. Rows are `grid-template-columns: 52px minmax(0,1fr)`, `gap: 10px`, `padding: 6px 0`: time at 11px tabular `--ui-faint`, then text at 12px over an actor line at 10px `--ui-faint`.

| Time | Event | Actor |
|---|---|---|
| 08:42 | Absensi periode 2026-07 dikunci | HR Manager |
| 08:15 | Snapshot konfigurasi diambil untuk proses Regular #1 | Sistem · worker |
| 07:58 | Versi baru "Tunjangan Transport" berlaku 1 Agu 2026 | HR Staff |
| Kemarin | Slip gaji Juni 2026 dicetak ulang — angka identik | HR Manager |

Every entry is a payroll-affecting mutation, which is what `data-model.md` requires be logged. The last two are the versioning rule and the reprint-identity rule made visible — the audit trail is a sales credibility signal as much as a compliance one.

## State and parameters

The artboard exposes three authoring props and holds two pieces of runtime state.

| Name | Kind | Values | Default |
|---|---|---|---|
| `theme` | prop, enum | `dark` · `light` | `dark` |
| `payrollStage` | prop, enum | `Review` · `Locked` | `Review` |
| `showEmployerCost` | prop, boolean | — | `true` |
| `open` | state | id of the expanded breakdown row, or none | `overtime` |
| `theme` | state | overrides the prop, persisted to `localStorage` under `aira-theme` | — |

`payrollStage` drives the stage chip, pipeline steps 4 and 5, and their icons. In the app it is not a prop — it is `payroll_runs.status`, and a locked run must additionally disable the "Lanjutkan proses payroll" action (CAP-23).

## Copy

The artboard is written in English. `conventions.md` makes **Indonesian user-facing copy** a definition-of-done item, so the tables above specify Indonesian strings while this document stays English. Indonesian regulatory terms — PPh21, BPJS, PKWT, THR, lembur — stay in Indonesian, which they already are.

Rupiah renders as `"Rp " + n.toLocaleString("id-ID")` over integer rupiah — dot thousands separators, no decimals. That matches the money rule in `conventions.md`; keep the integer all the way to the formatter and never through a float.

## Open decisions

- **Photo retention.** The sidebar card states photos older than **90 days** are purged tonight. `commercial-model.md` sets retention at 6 months on paid tiers and 30 days on free. 90 days matches neither — pick one, or make the card render the tenant's actual configured value.
- **Small accent text contrast.** See the compliance note in `design-system.md`; affects the sidebar kicker, the payroll-run kicker, the net-pay label and the warning icons.
- **Responsive behaviour is unspecified.** The artboard is a fixed 1440px composition. The 5-across stat row and the `1.62fr / 1fr` split need breakpoint rules, and the sidebar needs a collapsed state. Worth settling before build, since `SPEC.md` assumes a PWA-first client.
- **Company switcher menu** is implied by the caret but not drawn. Needs a design pass covering the multi-company case from CAP-2.
- **Empty, loading and error states** are specified in `screen-dashboard-states.md`, along with the calculating, stale-data and read-only modes. None of them are drawn in the artboard.
- **Notification bell** has no drawn panel or badge behaviour.
