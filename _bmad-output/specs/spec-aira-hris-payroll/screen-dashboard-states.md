# Screen — HR Dashboard, non-happy states

Companion to `SPEC.md`, sibling to `screen-dashboard.md` (which specifies the loaded, populated screen). Tokens and component classes from `design-system.md`.

The source artboard draws one state: everything present and correct. This document specifies the rest; `screen-dashboard-interaction.md` covers responsive, switcher, notification and accessibility behaviour. **Status: documented, not implemented.**

> **Component layer superseded by AD-36.** Class references below (`.card`, `.btn-primary`, `.tag-accent`, `.table`, `.seg`) describe the intended component shape. Implementation uses shadcn components styled with Nocturne tokens — see the mapping table in `design-system.md`. Sizes, spacing, colours and behaviour in this document are unchanged and remain binding.

## Governing principle

**Never render a number you cannot stand behind.**

The one failure this product cannot survive is a wrong figure presented as right. That makes the non-happy states a correctness surface, not decoration:

- **Unknown is not zero.** A value not yet known renders as an em dash `—`, never `0`. "Hadir hari ini: 0 dari 84" at 06:00 is technically true and reads as a catastrophe; "—" with a note is honest.
- **Stale is labelled stale.** Aggregate regions read from nightly materialized views. If a refresh failed, the numbers are yesterday's, and serving them unmarked in a payroll surface is the same class of error as a wrong payslip.
- **A failed region says it failed.** It never collapses to an empty state, because empty means "nothing to show" and failed means "we don't know".
- **Empty in steady state is good news.** No pending approvals is an achievement, not a void. It reads as a confirmation, not a hole.

## State matrix

Which states each region can occupy. `—` means the region does not have that state.

| Region | Loading | Empty (day 0) | Empty (clear) | Partial | Error | Stale |
|---|---|---|---|---|---|---|
| Header — company switcher | skeleton | ✓ | — | — | **fails closed** | — |
| Sidebar — approval badge | hidden | hidden | hidden | — | hidden | — |
| Sidebar — retention card | static | static | — | — | — | — |
| Stat row | skeleton ×5 | replaced by checklist | — | ✓ | ✓ | ✓ |
| Payroll run card | skeleton | replaced by checklist | between-periods | **calculating** | ✓ / **job failed** | — |
| Attendance by outlet | skeleton | replaced by checklist | — | ✓ | ✓ | ✓ |
| Needs action | skeleton | replaced by checklist | ✓ | — | ✓ | — |
| Compliance warnings | skeleton | replaced by checklist | ✓ | — | ✓ | — |
| Audit trail | skeleton | replaced by checklist | ✓ | — | ✓ | — |

Regions load and fail **independently**. One region failing never blanks the page — with the single exception of tenant resolution, below.

---

## Loading

### Timing

| Elapsed | Behaviour |
|---|---|
| 0–200ms | Render nothing. Most reads land inside this and a skeleton would only flash. |
| 200ms–10s | Skeleton. Once shown, hold a **400ms minimum** so a fast-arriving response does not flicker. |
| > 10s | Skeleton plus one line beneath the region: *"Lebih lama dari biasanya…"* at 11px `--ui-muted`. |
| > 30s | Treat as a region error and show the error block with retry. |

The payroll run in `calculating` status is **not** covered by this table — it is a designed progress state, below.

### Skeleton spec

- Fill `--ui-track`, `border-radius: var(--radius-sm)`.
- Animation: opacity `1 → 0.55 → 1` over 1.6s, `ease-in-out`, infinite. **No sweeping shimmer gradient and never the accent** — the Nocturne rule is that the accent is a line and a glow, never a flood.
- Under `prefers-reduced-motion: reduce`, drop the animation and hold a static fill.
- Bars take the **line-box height of the text they stand in for**, not the font size: a 27px/500 stat value becomes a 20px bar, a 13px label a 9px bar, a 10px kicker a 7px bar. Widths vary per item (55–85%) so a column of skeletons does not read as a printed grid.
- Card frames, padding, `--shadow-sm` and headings are **real, not skeletons**. Only the data is unknown. This keeps the layout from reflowing when content arrives.
- Every skeleton region carries `aria-busy="true"` and a visually-hidden label naming what is loading.

### Per region

| Region | Skeleton |
|---|---|
| Company switcher | 120×13 bar in place of the legal name; icon and caret render normally |
| Stat card | 7px kicker bar (60%), 20px value bar (45%), 9px note bar (80%) |
| Payroll run head | 9px kicker (30%), 15px title (55%), 9px meta (75%); stage chip is a 20×64 pill |
| Pipeline | five 11px bars at 60–90px, carets render normally |
| Totals | three cells, 9px label bar (50%) + 15px value bar (70%); the net cell keeps its 3px accent inset |
| Breakdown | six rows at the real row height, each 13px label bar (55%) + 13px amount bar (90px, right-aligned); no carets, rows not interactive |
| Attendance table | header row real; six body rows of bars; the progress track renders at full width with **no fill** |
| Needs action | three rows: icon circle 16px, 13px label bar (50%), 11px note bar (70%), 15px count bar (24px). Button renders real but `disabled` |
| Compliance / audit | three or four rows of two stacked bars at the real spacing |

The sidebar approval badge is **hidden while loading, never `0`** — a badge reading zero is a claim.

---

## Empty

Three different causes. Collapsing them into one state is the most common way this goes wrong.

### 1 — Day 0: a brand-new tenant

The tenant has signed up and no data exists. This is the CAP-30 self-serve path and, per `commercial-model.md`, the state most likely to decide whether the trial converts. It is the highest-stakes screen in the product and the artboard does not draw it.

**Sidebar and header render normally.** The company switcher shows the legal name captured at signup. Navigation stays fully enabled — nothing is locked behind onboarding.

**The hero row changes.** Greeting stays; the status line becomes a first-run line, and the actions collapse to a single primary: **Impor karyawan**.

**The stat row and the two-column grid are replaced entirely** by an onboarding checklist. Do not render five zeroed stat cards — a wall of `0` is not a status report, it is discouragement, and it makes the product look broken rather than new.

The checklist is a single `.card .elev-sm` spanning the content width, `padding: 20px 22px`, `gap: 14px`. Head: `h2` at 17px/500 plus a progress line at 12px `--ui-body` (*"0 dari 5 selesai · sekitar 30 menit"* — the 30-minute figure is CAP-28's acceptance criterion, so state it and mean it). Each step is a row at `padding: 12px 0` with `inset 0 -1px 0 var(--color-divider)`:

- a 20px status marker — `ph-circle-dashed` `--ui-faint` when pending, `ph-circle-notch` accent when in progress, `ph-check-circle` accent when done
- title 13px, description 11px `--ui-muted`
- a `.btn-secondary` at 12px on the right; the first incomplete step's button is `.btn-primary`

| # | Step | Description | Capability |
|---|---|---|---|
| 1 | Impor data karyawan | Unggah file Excel — divalidasi dan ditampilkan sebelum disimpan | CAP-7 |
| 2 | Atur cabang & radius geofence | Lokasi outlet dan titik absensi | CAP-10 |
| 3 | Pilih template konfigurasi | Retail/Toko, F&B, Manufaktur, atau Kantor — bisa disesuaikan | CAP-28 |
| 4 | Atur kalender payroll | Bulanan atau cut-off, dan tanggal pembayaran | CAP-17 |
| 5 | Impor YTD *(conditional)* | Bruto dan PPh21 terkumpul sejak Januari | CAP-24 |
| 6 | Uji coba 3–5 karyawan | Lihat contoh slip gaji sebelum konfigurasi disimpan | CAP-28 |

**Step 5 renders only when the tenant is onboarding after January.** Per `commercial-model.md` most clients arrive mid-year, and without YTD the December reconciliation is simply wrong — so when it does render it is **not optional** and is marked as such. Hiding it for a January signup keeps the list honest at five steps.

Steps unlock in order but are not gated: a client who wants to jump to step 3 can. The order is guidance, not a wizard.

### 2 — Partially onboarded

Employees exist; some regions have data and some do not. Regions fill in as their prerequisites are met.

| Condition | Region behaviour |
|---|---|
| Before the clock-in window opens | Attendance stats render `—` with note *"Jendela absensi mulai 07:00"*. Headcount renders normally. |
| Employees imported, no branches yet | Attendance table shows *"Belum ada cabang terdaftar"* + link to branch setup |
| No payroll calendar configured | Payroll card shows *"Kalender payroll belum diatur"* + `.btn-primary` to configuration |
| Calendar set, no run started | Between-periods state, below |

The rule throughout: **a region with unmet prerequisites points at the prerequisite.** It never shows a zero and never shows a generic "no data".

### 3 — Steady state, nothing pending

Real tenant, working normally, and a region legitimately has nothing in it. These read as confirmations.

Layout: centred block, `padding: 22px 12px`, `gap: 7px` — icon 20px `--ui-faint`, line 12px `--ui-body`, optional sub-line 11px `--ui-muted`. **Card height must not collapse below its populated minimum** or the right column jumps as data loads.

| Region | Icon | Copy |
|---|---|---|
| Needs action | `ph-check-circle` | *"Tidak ada yang menunggu persetujuan"* · *"Semua permohonan sudah diproses"* |
| Compliance warnings | `ph-shield-check` | *"Tidak ada peringatan"* · *"Kontrak, YTD, dan geofence semua aman"* |
| Audit trail | `ph-clock-counter-clockwise` | *"Belum ada aktivitas hari ini"* |
| Attendance table (holiday) | `ph-confetti` | *"Hari libur nasional — {nama hari libur}"* · *"Tidak ada jadwal shift hari ini"* |

The Needs-action button becomes `.btn-secondary` and reads *"Lihat riwayat persetujuan"* — the card stays useful when it is empty.

### 4 — Between payroll periods

No run in flight, which is the normal condition for most of the month. The payroll card is the largest element on the screen and must not vanish or collapse to an empty box.

Keep the card frame and head. Replace kicker and title with the **next** period (name, work period, payment date, derived tax month — the CAP-17 rule stays visible even with no run). Replace the stage chip with a `.tag-outline` reading *"Belum dimulai"*. Replace pipeline, totals and breakdown with:

- a one-line summary of the **last completed run** — period, net total, payslip count, lock timestamp — at 12px `--ui-body`, with *"Lihat detail"* linking to it
- a `.btn-primary` reading *"Mulai proses payroll {periode}"*, enabled only once attendance for the period is locked; otherwise `.btn-secondary` reading *"Kunci absensi dulu"* pointing at CAP-13

---

## Calculating

`payroll_runs.status = 'calculating'`. Not a loading state — the job is running, it is resumable, and it records progress (`conventions.md`), so the screen shows **determinate** progress.

- Stage chip becomes `.tag-accent` reading *"Sedang dihitung"*
- Pipeline step 3 takes `ph-circle-notch` with a slow rotation; steps 4–5 drop to `--ui-faint`
- Beneath the pipeline, a progress bar at the card width: 4px, `--ui-track`, accent fill, with a count at 11px `--ui-body` — *"{n} dari {total} karyawan"*. Never a percentage alone; the employee count is what the user can reason about.
- Totals render as **skeleton, not zeros**. A partial gross presented as gross is exactly the failure the governing principle forbids.
- The breakdown section is hidden — not skeletoned. There is nothing to disclose yet.
- Poll at 30s per the no-Realtime constraint in `stack.md`.
- Past the CAP-18 budget (5 min at 500 employees), append *"Lebih lama dari perkiraan"* at 11px `--ui-muted`. Do not treat as failure — a 2.000-employee run is expected to take longer.

---

## Error

### Page level — tenant resolution failure

`tenant_id` cannot be resolved from `app_metadata`, or the active membership is inactive or revoked.

**Fail closed.** No sidebar navigation, no company name, no cached figures, no partial render of any region. This is a security posture from the cross-tenant leak risk in `roadmap.md`, not a UX preference: a dashboard that renders *anything* when it cannot prove which tenant it is showing is the exact bug the isolation suite exists to prevent.

Full-page centred block on `--color-bg`: `ph-shield-warning` at 28px `--ui-faint`; heading 17px/500 *"Sesi tidak bisa diverifikasi"*; body 13px `--ui-body` *"Masuk ulang untuk melanjutkan. Data tidak ditampilkan sampai sesi terverifikasi."*; `.btn-primary` *"Masuk ulang"*. A support reference code at 11px `--ui-faint`. **No retry button** — retrying an unresolvable session just loops.

### Region level

The card keeps its frame, `--shadow-sm` and heading. Only the body is replaced, so the page does not reflow.

Block: `padding: 20px 12px`, centred, `gap: 8px` — `ph-warning-circle` at 18px `--ui-faint`; line 12px `--ui-body`; `.btn-secondary` at 12px *"Coba lagi"*; error reference at 10px `--ui-faint`.

Do **not** use accent or red for the icon. Nocturne carries no semantic error colour, and inventing one violates the mono-scheme rule in `design-system.md`. Weight carries the message; if a semantic status ramp is wanted, that is a change to the design system, made there and once — see open decisions.

| Cause | Copy |
|---|---|
| Query timeout (`statement_timeout` fired) | *"Perhitungan terlalu lama. Coba lagi atau persempit rentang."* |
| Materialized view unavailable | *"Rekap belum siap. Data sedang disegarkan."* |
| Generic fetch failure | *"Gagal memuat. Coba lagi."* |
| Network offline | *"Tidak ada koneksi."* — retry hidden, auto-retry on reconnect |

The timeout copy names a **user action that actually helps**, because `stack.md` sets `statement_timeout` per role deliberately: one tenant's annual report must not freeze everyone else. A timeout here is the system working, not breaking.

### Payroll job failure

`payroll_runs` job failed after its retries. `conventions.md`: failures are retried with backoff and **surfaced, never silently swallowed** — so this state is required, not optional.

- Stage chip becomes `.tag-outline` reading *"Perhitungan gagal"*
- The failed pipeline step takes `ph-x-circle` at `--ui-body`; later steps stay `--ui-faint`
- A block below the pipeline on `--ui-hover` ground, `--radius-md`, `padding: 12px 14px`: what failed at 12px, the job reference at 11px `--ui-faint`, and `.btn-primary` *"Jalankan ulang"*
- Rerun is **safe and must say so**: jobs carry an idempotency key and resume from recorded progress, so a rerun cannot double-post and does not start from zero. Sub-line at 11px `--ui-muted`: *"Aman dijalankan ulang — lanjut dari progres terakhir, tidak akan dihitung ganda."*
- Totals and breakdown are **hidden**, not zeroed

### Stale data

The nightly materialized-view refresh failed or has not run, so aggregate regions hold yesterday's figures.

Show the data — it is better than nothing and probably close to right — but **stamp it**. On the affected card head, a `.tag-outline` at 10px reading *"Data per {timestamp}"*, and a sub-line at 11px `--ui-muted`: *"Rekap belum disegarkan sejak {waktu}."*

Applies to the stat row and the attendance table (both CAP-14 surfaces). It never applies to the payroll run card, which reads `payroll_items` directly and is always current.

Beyond a threshold — proposed **24 hours** — escalate from stamp to region error. Attendance figures more than a day stale are not a caveat, they are wrong.

---

## Read-only mode

Not an error, but it changes exactly the affordances these states do, so it is specified here. Billing is overdue (CAP-29). The rule from `commercial-model.md` is **degrade, never block** — withholding access to payroll data is the fastest way to lose reputation.

- A full-width banner above the hero: `--ui-hover` ground, `--radius-md`, `padding: 11px 14px`, `ph-credit-card` at 15px `--ui-accent-text`, text 12px, `.btn-primary` at 12px *"Perbarui pembayaran"* on the right
- **All data renders normally.** Every figure, every card, no blur, no lock overlay, no teaser
- Mutating actions become `disabled` at the DS's 45% opacity: *Lanjutkan proses payroll*, approval actions, the checklist buttons
- **Export and payslip download stay enabled** — explicitly required by CAP-29's acceptance criteria
- Sidebar navigation stays fully enabled

---

## Components to build

Five shared pieces cover every state above:

| Component | Responsibility |
|---|---|
| `<Skeleton>` | A token-driven bar. Props for height, width, radius; owns the pulse and the reduced-motion fallback. |
| `<EmptyBlock>` | Icon + line + optional sub-line + optional action. Used by every steady-state-clear region. |
| `<ErrorBlock>` | Icon + line + retry + reference code. Used by every region-level failure. |
| `<FreshnessStamp>` | The stale tag and sub-line, with the 24h escalation threshold. |
| `<OnboardingChecklist>` | The day-0 replacement for the stat row and grid. |

Each region then needs only a small state discriminator, not a bespoke design.

---

## Open decisions

- **No semantic status colours exist.** Nocturne is a deliberate mono scheme; there is no red, amber or green. Every state above is therefore carried by icon, weight and copy alone. That works, and it is arguably a strength in a product whose warnings are informational rather than alarming — but three of the compliance warnings (contract expiry, missing YTD, geofence breach) have genuinely different urgencies that the design currently cannot distinguish. **Recommendation:** add one semantic ramp to `styles.css` rather than one-off colours in the app, and only if a real urgency distinction is needed. This is a design-system change, made once and in the system.
- **Stale threshold** proposed at 24 hours before escalating from stamp to error. Needs confirmation against the actual refresh schedule.
- **Clock-in window start** (07:00 in the copy above) is currently assumed. It should come from the tenant's shift templates, not a constant.
- **Offline behaviour.** `SPEC.md` assumes a PWA-first client, and CAP-11 makes attendance capture work offline. This dashboard is a read surface with no offline requirement — but a PWA can be opened offline, and it should say so rather than render a page of failed regions. Proposed: one page-level offline banner and suppressed per-region retries. Confirm whether cached last-known figures may be shown offline; under the governing principle they would need a freshness stamp.
- **Onboarding checklist persistence.** Does it disappear permanently once all steps complete, or remain reachable from Configuration? A client who imports employees in week one and configures payroll in week three needs to find it again.
