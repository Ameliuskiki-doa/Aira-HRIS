# Screen — HR Dashboard, responsive and interaction

Companion to `SPEC.md`. Third and last of the dashboard set: `screen-dashboard.md` holds the loaded screen, `screen-dashboard-states.md` the empty, loading and error states, and this document covers responsive behaviour, the two affordances the artboard implies but does not draw, and accessibility.

**Status: documented, not implemented.** Tokens and classes from `design-system.md`.

> **Component layer superseded by AD-36.** Class references below (`.card`, `.btn-primary`, `.tag-accent`, `.table`, `.seg`) describe the intended component shape. Implementation uses shadcn components styled with Nocturne tokens — see the mapping table in `design-system.md`. Sizes, spacing, colours and behaviour in this document are unchanged and remain binding.

---

## Responsive

### What we are actually designing for

`SPEC.md` assumes a PWA-first client, but that assumption comes from **employee clock-in** (CAP-10, CAP-11) — a phone-first, camera-and-GPS interaction. This dashboard is the HR manager's desk surface: a payroll run with a six-row component breakdown and a six-outlet attendance table is not a phone task.

So the goal below 1024px is a **floor, not a redesign**: the screen stays readable and operable on a smaller window or a tablet, and degrades honestly on a phone. It is not re-conceived as a mobile experience. Whether it should be is an open question at the end.

### Breakpoints

| Range | Sidebar | Stat row | Main grid |
|---|---|---|---|
| **≥ 1440** | 236px, as drawn | 5 columns | `1.62fr / 1fr` |
| **1200–1439** | 236px | 5 columns | `1.45fr / 1fr`, content padding 24→20px |
| **1024–1199** | 64px icon rail | 3 columns, wrapping to 3+2 | single column |
| **768–1023** | 64px icon rail | 3 columns | single column |
| **< 768** | off-canvas drawer | 2 columns | single column |

Stat row uses `repeat(auto-fit, minmax(180px, 1fr))` rather than hard column counts, so the 3+2 wrap falls out of the grid instead of a media query.

### Single-column order

Below 1200px the two columns collapse. The order is **decision urgency**, not source order:

1. Payroll run card — the thing in flight
2. Needs action — decisions waiting on this person
3. Compliance warnings — risks that bite later
4. Attendance by outlet — situational
5. Audit trail — history

Reordering changes meaning, so this order is part of the spec, not a CSS convenience.

### Sidebar collapse — 64px icon rail

- Icons only, centred, at the same 15px. Group labels hidden.
- Item height rises to 44px to stay a comfortable target.
- The active item keeps `--ui-active-bg` and its inset accent ring; without the label the ring is the only cue, so it must not be dropped.
- The approval count badge becomes a **6px accent dot** at the icon's top-right. A two-digit count does not fit and a truncated count is a wrong number.
- Label appears on hover and on focus as a tooltip on `--color-surface` with `--shadow-md`, `--radius-md`, 12px text, offset 8px right.
- The brand mark stays; the wordmark and plan line are hidden.
- The retention footer card is hidden — it is a notice, not navigation.

### Off-canvas drawer — below 768px

- Header gains a `ph-list` icon button on the left, before the company switcher.
- Drawer is 236px, slides from the left over a `--color-neutral-900` at 50% backdrop (the `.dialog-backdrop` treatment), at `--shadow-lg`.
- Full sidebar content, labels and all, at 44px item height.
- Closes on backdrop click, on `Esc`, and on navigation. Focus is trapped while open and returns to the trigger on close.

### Header at narrow widths

- **< 1200px** — the date and timezone line is dropped first. It is context, not function, and the range control is what the user reaches for.
- **< 1024px** — the range segmented control moves down onto its own row beneath the header, full width, options flexing equally.
- **< 768px** — the user block collapses to the avatar alone; name and role move into the drawer. The company switcher truncates with `text-overflow: ellipsis` and keeps the branch count, which is what distinguishes two similarly-named PTs.

### Tables and overflow

The attendance table has six columns and does not compress usefully.

- Wrap it in an `overflow-x: auto` container. **The page body never scrolls horizontally** — the scroll belongs to the table.
- Below 1024px the outlet name column is `position: sticky; left: 0` on `--color-surface`, so a scrolled row stays identifiable.
- The `.table` row rules fade over 48px at each end (a Nocturne signature). Inside a horizontally scrolling container the fade must track the **table** width, not the viewport, or the rule appears to stop mid-row.
- Minimum table width 640px before scrolling engages.

### Payroll breakdown at narrow widths

The row grid is `18px minmax(0,1fr) auto 16px`. Below 768px:

- Drop the leading icon column, giving the label its width back
- Keep the amount right-aligned and tabular — column alignment across rows is what makes the figures scannable, and it is the last thing to give up
- The expanded detail panel's key/value pairs stack: key on its own line at `--ui-muted`, value beneath at full size, still tabular

### Touch targets

Nocturne is dense on purpose — nav items are `padding: 7px 8px`, roughly 29px tall. That is correct for a mouse and below the 44px minimum for touch.

At the 1024px breakpoint and below, raise nav items, breakdown rows, needs-action rows and segmented options to a **44px minimum height**. Do this by increasing the block padding, not by changing font sizes, so the type scale stays put.

---

## Company switcher

The artboard draws a `ph-caret-up-down` on the company pill and no menu. CAP-2 gives it real semantics.

**Trigger.** The existing pill. On hover, `--ui-hover`; on open, `--ui-active-bg` with the caret rotated.

**When the user belongs to one company only, there is no menu.** The pill renders as a plain label with no caret and no interaction. A dropdown containing one item is noise, and most tenants are single-PT.

**Panel.** Anchored below-left, `min(320px, calc(100vw - 32px))`, `.card` treatment at `--shadow-md`, `--radius-md`, `padding: 6px`, `max-height: 380px` with internal scroll.

- A `.input` search field appears only above **7 companies**
- One row per active membership: legal name at 13px, branch count and role at 11px `--ui-muted`, `padding: 9px 10px`, `--radius-sm`, hover `--ui-hover`
- The current company takes `--ui-active-bg` / `--ui-active-fg` and a trailing `ph-check` at 14px
- Footer, separated by a fading rule: a link to organization settings at 12px

**Switching is a session change, not a filter.** Per CAP-2 the JWT carries one active company and switching **reissues the token**. So:

- The panel closes immediately and the whole page enters the loading state from `screen-dashboard-states.md`
- Navigation returns to the **dashboard root**. A deep link belonging to the previous company must not survive the switch — the record it points at may not exist in the new tenant, and following it is precisely the shape of a cross-tenant mistake
- On failure, fail closed to the tenant-resolution error state. Never fall back to the previous company silently

**Keyboard.** `Enter` / `Space` / `↓` opens and focuses the first item; `↑` `↓` move; `Enter` selects; `Esc` closes and returns focus to the trigger; focus is trapped while open. `role="menu"` with `aria-expanded` on the trigger.

---

## Notifications

The bell has no drawn panel or badge behaviour. Two things decide its design.

**First, the sidebar already carries approvals.** The Approvals badge counts things needing a decision. The bell must not duplicate it, or two numbers disagree and both lose trust. The bell carries **events**: a run finished, a job failed, an import completed, a contract is expiring, a payment failed.

**Second, the bell is the free channel.** `commercial-model.md` warns that WhatsApp per-message cost can rival infrastructure cost and mandates batch-and-digest over per-event. The in-app bell costs nothing to deliver. So the design rule is: **the bell absorbs everything; WhatsApp carries only digests and true escalations.** Every notification type declares its channel.

| Event | In-app | WhatsApp | Capability |
|---|---|---|---|
| Payroll run finished, ready for review | ✓ | — | CAP-18 |
| Payroll job failed | ✓ | escalation | CAP-4 |
| Attendance locked for the period | ✓ | — | CAP-13 |
| Employee import finished | ✓ | — | CAP-7 |
| Approval pending past its timeout | ✓ | daily digest | CAP-27 |
| PKWT contracts expiring within 30 days | ✓ | weekly digest | CAP-6 |
| Missing YTD detected | ✓ | weekly digest | CAP-24 |
| Payment failed / dunning step | ✓ | ✓ | CAP-29 |

Only two rows send per-event to WhatsApp, and both are things that cost the client money if missed.

**Badge.** A 6px accent dot when anything is unread — **not a count**. The count belongs to Approvals; the bell answers "is there something new", which is a yes/no.

**Panel.** Anchored below-right, `min(360px, calc(100vw - 32px))`, `.card` at `--shadow-md`, `max-height: 440px` with internal scroll. Head: "Notifikasi" at 13px/500 with "Tandai sudah dibaca" as a `.btn-ghost` at 11px. Rows are grouped under `Hari ini` and `Sebelumnya`, each 11px uppercase `0.1em` `--ui-faint`.

Row: `padding: 10px 11px`, `--radius-sm`, hover `--ui-hover`; icon 15px; title 12px `line-height: 1.45`; relative time 10px `--ui-faint`. Unread rows take a 2px accent bar inset on the left and their title at `--color-text`; read rows drop to `--ui-body` and lose the bar.

Empty state reuses `<EmptyBlock>` from `screen-dashboard-states.md`: `ph-bell-simple`, *"Tidak ada notifikasi baru"*.

Same keyboard contract as the switcher.

---

## Accessibility

The artboard is a visual composition and carries four defects that must not reach the build.

**1 — Breakdown rows are not keyboard operable.** They are `<div onClick>`. They must be `<button type="button" aria-expanded aria-controls>` wrapping the row content, with the detail panel carrying the matching `id`. This is the screen's primary interaction — CAP-18's "every figure traces to its inputs" is unreachable by keyboard as drawn.

**2 — The range control loses its semantics.** The artboard uses bare `<span class="seg-opt">`. Nocturne's `.seg-opt` is built on a native radio input (`.seg-opt:has(input:checked)`), which is what gives it keyboard operation, checked state and focus. Use the DS pattern; do not restyle spans to look selected.

**3 — Icon-only buttons have no accessible name.** The bell and the theme toggle render an icon and nothing else. Both need an `aria-label`, and the theme toggle's must reflect the action, not the state.

**4 — The active nav item is visual only.** It needs `aria-current="page"` alongside the `--ui-active-bg` treatment.

Beyond those:

- **Progress bars** — the attendance meter and the calculating bar need `role="progressbar"` with `aria-valuenow` / `min` / `max`, or must be marked `aria-hidden` with the adjacent percentage text carrying the value. Do not leave a bar with no accessible value.
- **The attendance table** needs a `<caption>` or `aria-label`; column headers are already `<th>`, which is correct.
- **Focus** — `:focus-visible` is supplied by the design system as a 2px accent ring at 2px offset. Do not override it, and do not remove it from rows that gain hover styling.
- **Live regions** — when a region finishes loading, or the calculating count advances, announce it via `aria-live="polite"`. Loading regions carry `aria-busy="true"` per `screen-dashboard-states.md`.
- **Reduced motion** — the skeleton pulse, the calculating spinner and the drawer slide all respect `prefers-reduced-motion: reduce`.
- **Contrast** — the small-accent-text issue is tracked in `design-system.md`. `--ui-faint` (text at 38% on the dark ground) is used for 10–11px timestamps and hints and should be checked against 4.5:1 at those sizes; it is likely to fail and may need to move to `--ui-muted`.

---

## Open decisions

- **Does HR admin need a true mobile experience?** The floor above keeps the screen usable on a phone, but the payroll breakdown and the attendance table are desk work. If HR managers really approve leave and review runs from a phone, that is a separate mobile design, not a reflow of this one — and worth confirming before build rather than discovering after.
- **`--ui-faint` at small sizes** likely fails 4.5:1. Confirm and, if so, decide whether small metadata moves to `--ui-muted` or the token is retuned in the design system.
- **Notification retention and read state** — how long does the bell keep an event, and is read state per-user or per-membership? A person in three companies should not mark a payroll notification read in one and see it disappear in the others.
- **Digest scheduling** — the daily and weekly WhatsApp digests above need a send time and a per-tenant opt-out, and their cost should be modelled before enabling, per the notification warning in `commercial-model.md`.
