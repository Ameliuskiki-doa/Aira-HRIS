# Design System — Nocturne

Companion to `SPEC.md`. The visual contract: what the design system provides, what the app must add on top of it, and how theming works.

**Source:** Claude Design project `dcaaa7ad-e795-4fad-8b3e-223f30a4ad1d` ("HRIS project UI mockup"), design system `_ds/nocturne-ee56407c-8063-417c-bf1f-fe655f93985a/`. `styles.css` is the only stylesheet and the source of truth for the look — plain CSS on plain HTML, no JavaScript and no build step. `support.js` and `_ds_bundle.js` are the canvas preview runtime (`x-dc`, `sc-for`, `sc-if`, `{{ }}`, `DCLogic`); they are **not** app code and must not be ported.

## Character

A quiet, compact dark interface: near-neutral blue-grey ground, Inter at medium weight, soft 8px radii, and an accent used as a **line and a glow rather than a flood**. Contrast comes from the tonal ramps, not from saturation.

## Two token layers

This is the single most important thing to get right at implementation time.

| Layer | Defined in | Contains |
|---|---|---|
| **Nocturne** | `styles.css` `:root` | `--color-*`, `--font-*`, `--space-*`, `--radius-*`, `--shadow-*` and the 100–900 ramps |
| **App semantic** | *nowhere yet* — currently only inside the artboard's `THEMES` object | `--ui-body`, `--ui-muted`, `--ui-faint`, `--ui-nav`, `--ui-hover`, `--ui-track`, `--ui-tint`, `--ui-active-bg`, `--ui-active-fg`, `--ui-accent-text`, `--ui-link-hover` |

**The `--ui-*` layer is not part of Nocturne.** The dashboard depends on all eleven of these variables. They must be declared in application CSS or the screen renders unstyled. Treat them as the app's semantic layer over the DS primitives.

## Nocturne tokens

**Core**

```
--color-bg        #161826    ground
--color-surface   #232532    cards, sidebar, table cells
--color-text      #e9e9ed
--color-accent    #9184d9    blurple, OKLCH hue 289.2 · L 0.660 · C 0.125
--color-divider   color-mix(in srgb, #e9e9ed 16%, transparent)
```

`--color-accent-2-*` is a machine-derived stand-in kept only so both sets resolve. **This is a mono scheme — treat accent-2 as the same role as accent.**

**Ramps** — generated in OKLCH on one shared lightness scale, so the same step of any role matches the others in visual value.

| Step | `--color-neutral-*` | `--color-accent-*` |
|---|---|---|
| 100 | `#f3f5fe` | `#f5f4ff` |
| 200 | `#e4e7f5` | `#e7e5fe` |
| 300 | `#cfd3e5` | `#d2cefd` |
| 400 | `#b2b6ca` | `#b5abfc` |
| 500 | `#9397ab` | `#968ae0` |
| 600 | `#75798c` | `#796cbf` |
| 700 | `#595d6c` | `#5d5294` |
| 800 | `#3f424d` | `#423a6a` |
| 900 | `#292b31` | `#2b2741` |

On the dark ground: **700–900** for tinted fills, hovers and subtle borders; **500** as the role's base; **100–300** for text on those tints and for pressed states. Prefer ramp steps over ad-hoc `color-mix()`.

`--color-section` / `-glow` / `-ghost` (deep indigo) are **deck-scale fills only** — not interface colors. The dashboard does not use them.

**Type** — Inter for both heading and body, heading weight 500.

| | Size |
|---|---|
| h1 | 42px |
| h2 | 32px |
| h3 | 25px |
| h4 | 20px |
| h5 | 16px |
| h6 | 13px, 0.08em, uppercase |
| body | 15px / 1.55 |

The dashboard overrides these downward throughout (see `screen-dashboard.md`) — it runs at a 13px base.

**Spacing** — density 0.70×, already baked in. Use the variables, not raw numbers.

```
--space-1 2.8px   --space-2 5.6px   --space-3 8.4px
--space-4 11.2px  --space-6 16.8px  --space-8 22.4px
```

**Radius** — `--radius-sm` 4px · `--radius-md` 8px · `--radius-lg` 14px

**Elevation** — on a dark ground, elevation is a hairline edge plus ambient darkness. Never stack heavy shadows.

```
--shadow-sm  0 0 0 1px #3f424d
--shadow-md  0 0 0 1px #595d6c, 0 6px 18px rgba(0,0,0,0.55)
--shadow-lg  0 0 0 1px #9397ab, 0 16px 40px rgba(0,0,0,0.65)
```

## Component classes — superseded

> **Superseded by AD-36.** Nocturne is vendored as the **token** source only. Components come from shadcn on Radix, copied into the repo and styled with Nocturne tokens through Tailwind v4's non-inline `@theme`. The nine classes below are documented because the screen specs were written against them and because they define the intended *shape* of each component — but application code does not use them.

**Class → component mapping**

| Nocturne class | Becomes |
|---|---|
| `.btn` + variants | `Button` with `variant` / `size` |
| `.tag` + variants | `Badge` |
| `.card` + `.elev-*` | `Card` |
| `.table` | `Table` |
| `.input`, `.field` | `Input`, `Label`, `Form` |
| `.radio`, `.seg` | `RadioGroup`, `ToggleGroup` |
| `.nav` | composed layout, not a shadcn primitive |
| `.dialog*` | `Dialog` |
| `.hr`, `.lighten` | plain CSS, kept as utilities |

The fading-rule signature, the outlined-not-filled primary, and the accent-as-line-not-flood rules all carry over and must survive the port.

The original class contract follows.

| Class | What it is |
|---|---|
| `.btn` + `.btn-primary` / `.btn-secondary` / `.btn-ghost` / `.btn-icon` / `.btn-block` | Actions. **The primary is an accent outline, never a fill.** |
| `.tag` + `.tag-accent` / `.tag-accent-2` / `.tag-neutral` / `.tag-outline` | Small labels tinted from the ramps |
| `.field` + `label`, `.input`, `.radio` + `.dot`, `.seg` + `.seg-opt` | Form fields and choices on native elements, no script |
| `.card` + `.card-kicker` / `.card-title` / `.card-body` / `.card-meta`; `.elev-sm` / `-md` / `-lg` | Surface-filled cards and elevation utilities |
| `.nav` + `.nav-brand` | Header bar |
| `.table` | Data table with themed header and row rules |
| `.dialog-backdrop` + `.dialog` (+ `-title` / `-body` / `-actions`) | Modal at top elevation |
| `.hr` | Horizontal rule — present, but the system prefers whitespace. Avoid. |
| `.lighten` | Image wrapper (`mix-blend-mode: lighten`). Not used by the dashboard. |

**The fading rule is a Nocturne signature.** Freestanding rules and table row rules fade to transparent over 48px at each end rather than stopping cleanly. Box outlines, in-control separators and short accent marks stay solid. `.table` implements this at row level so the fade spans the row, not each cell — do not reimplement row borders per cell.

## Interaction states

Built into the stylesheet. **Do not restyle per page.**

- Hover and pressed tints come from the accent ramp — one step past the base (`--color-accent-400` on this dark ground), or a `color-mix()` tint for outlined and ghost variants
- Keyboard focus is `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }` — never the default blue ring
- `::selection` is an accent tint
- Disabled drops to 45% opacity

## Icons

Phosphor (https://phosphoricons.com), regular weight. The artboard loads them from a CDN stylesheet; for the app, take the dependency locally rather than at runtime.

Icons used by the dashboard: `pulse`, `squares-four`, `chart-line`, `users-three`, `fingerprint`, `airplane-takeoff`, `calendar-dots`, `receipt`, `check-square-offset`, `sliders-horizontal`, `credit-card`, `buildings`, `caret-up-down`, `caret-right`, `caret-up`, `caret-down`, `arrow-right`, `bell`, `sun`, `moon`, `download-simple`, `play`, `lock-simple`, `lock-key`, `lock-key-open`, `camera`, `check-circle`, `eye`, `wallet`, `calendar-check`, `clock-clockwise`, `shield-check`, `percent`, `minus-circle`, `pencil-simple`, `file-text`, `database`, `map-pin-simple-area`.

## Theming

Two themes. **Dark is the default and is identical to the Nocturne `:root` defaults.** Light is derived from the ramps — it is not a separate palette.

| Variable | Dark | Light | Light's ramp origin |
|---|---|---|---|
| `--color-bg` | `#161826` | `#e4e7f5` | `--color-neutral-200` |
| `--color-surface` | `#232532` | `#f3f5fe` | `--color-neutral-100` |
| `--color-text` | `#e9e9ed` | `#292b31` | `--color-neutral-900` |
| `--color-accent` | `#9184d9` | `#5d5294` | `--color-accent-700` |
| `--color-divider` | `#e9e9ed` @ 16% | `#292b31` @ 15% | — |
| `--shadow-sm` | `0 0 0 1px #3f424d` | `0 0 0 1px #cfd3e5` | neutral-800 → neutral-300 |
| `--shadow-md` | `…#595d6c, 0 6px 18px rgba(0,0,0,.55)` | `…#cfd3e5, 0 6px 18px rgba(41,43,49,.10)` | — |
| `--shadow-lg` | `…#9397ab, 0 16px 40px rgba(0,0,0,.65)` | `…#b2b6ca, 0 16px 40px rgba(41,43,49,.16)` | — |

The app semantic layer, per theme:

| Variable | Dark | Light |
|---|---|---|
| `--ui-body` | text @ 58% | text @ 62% |
| `--ui-muted` | text @ 46% | text @ 52% |
| `--ui-faint` | text @ 38% | text @ 42% |
| `--ui-nav` | text @ 72% | text @ 74% |
| `--ui-hover` | text @ 6% | accent @ 8% |
| `--ui-track` | text @ 12% | text @ 12% |
| `--ui-tint` | `#9184d9` @ 9% | `#9184d9` @ 14% |
| `--ui-active-bg` | `#2b2741` (accent-900) | `#e7e5fe` (accent-200) |
| `--ui-active-fg` | `#e7e5fe` (accent-200) | `#5d5294` (accent-700) |
| `--ui-accent-text` | `#9184d9` | `#5d5294` |
| `--ui-link-hover` | `#d2cefd` (accent-300) | `#423a6a` (accent-800) |

Note `--ui-tint` keeps the **dark** accent hex in both themes — it is a wash, not a text color.

### Implementation guidance

The artboard applies the theme by writing every variable onto `document.documentElement.style` from JavaScript on mount, and persists the choice to `localStorage` under the key `aira-theme`. That is a canvas-runtime pattern and should **not** be carried into the app: it produces a flash of unstyled content on every load, because the first paint happens before the script runs.

In the app, declare raw values on `:root` (dark) and on `.dark`'s counterpart for light, then map them through **`@theme inline` with `var()` indirection** — that is what lets a utility resolve at the element and makes scoped theming work. **Never put literal values inside `@theme inline`**: Tailwind constant-folds them into the utility, no variable survives to override, and the build still succeeds. A non-inline `@theme` is strictly worse — it resolves the indirection once at `:root`, so a nested themed subtree never changes. Dark mode is the **`.dark` class**, matching shadcn's `@custom-variant dark (&:is(.dark *))`; because the class need only sit on an ancestor, scoped theming still works. Resolve the stored preference in a blocking inline script before first paint, keeping the `aira-theme` key.

## Compliance notes

Two things to settle before build:

- **Small accent text.** The Nocturne readme tunes the accent-to-ground pair to at least 3:1 — "enough for icons, large text and interface chrome, not for body copy" — and directs paragraph-size accent text to `--color-accent-300` on this ground. The dashboard uses `--ui-accent-text` (the raw accent) on 10–11px labels: the sidebar retention card kicker, the payroll-run kicker, the "Net pay" total label, and the compliance-warning icons. Those sit below the threshold the readme reserves. Recommend `--color-accent-300` on the dark ground for that class of label.
- **Do not flood.** The accent carries its chroma in lines and marks. The dashboard respects this — the primary button is an outline, the net-pay cell is marked with a 3px inset bar rather than a fill, and the only accent fills are the `.tag-accent` chips and the 4px progress bars. Keep it that way.
