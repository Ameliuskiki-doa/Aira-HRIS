import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tailwindcss from "eslint-plugin-tailwindcss";

import {
  boundaryConfigs,
  CORE_DIR,
  FIXTURE_IGNORES,
  LINTING_FIXTURES,
} from "./eslint.boundary.mjs";

/**
 * Tailwind's built-in colour families. Every one of them is off-palette here:
 * the design system's colours are the Nocturne ramps and the shadcn roles
 * mapped onto them, and a `bg-red-500` follows neither theme.
 */
const TAILWIND_PALETTES =
  "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|stone";

/** Utility prefixes that take a colour. */
const COLOR_UTILITIES =
  "bg|text|border|ring|outline|fill|stroke|shadow|divide|placeholder|caret|accent|decoration|from|via|to";

/** e.g. `dark:hover:bg-red-500`, `border-t-slate-200/50`. */
const OFF_PALETTE_PATTERN = `/\\b(?:${COLOR_UTILITIES})-(?:[a-z]+-)?(?:${TAILWIND_PALETTES})-\\d{2,3}\\b/`;

/** CSS properties in a `style` prop whose value is a colour. */
const STYLE_COLOR_PROPERTIES =
  "/^(?:color|background|backgroundColor|borderColor|border(?:Top|Right|Bottom|Left)Color|outlineColor|fill|stroke|boxShadow|textShadow|caretColor|accentColor|textDecorationColor|columnRuleColor)$/";

/** A written-out colour in any notation. */
const COLOR_LITERAL_PATTERN =
  "/#[0-9a-fA-F]{3,8}\\b|\\b(?:rgba?|hsla?|oklch|oklab|lch|lab|color-mix)\\(/";

const MSG_OFF_PALETTE =
  "AD-36: Tailwind's default colour palette is off-palette. Use a shadcn role (bg-background, text-muted-foreground), the brand ramp (text-brand-300) or the --ui-* layer; those follow the theme, this does not.";
const MSG_STYLE_COLOR =
  "AD-36: a colour in a style prop is outside the token scale and follows no theme. Use a utility that resolves to a token.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Planning artifacts and tooling that carry no application source.
    "_bmad/**",
    "_bmad-output/**",
    // Boundary-test fixtures. They exist only while tests/boundary.test.ts is
    // running, and are deliberately full of violations — a run killed
    // mid-test must not be able to break the next lint.
    ...(LINTING_FIXTURES ? [] : FIXTURE_IGNORES),
  ]),
  // AD-2 — core purity. See eslint.boundary.mjs.
  ...boundaryConfigs,
  // AD-36 — one component vocabulary, no escape hatch.
  //
  // An arbitrary value (`p-[13px]`, `bg-[#9184d9]`) steps outside the token
  // scale, which is the one thing the design system cannot survive: a colour
  // written by hand does not follow the theme, and a spacing value written by
  // hand does not follow the density. The rule is syntactic, so it also catches
  // values inside `cn()`, `clsx()` and template literals. Arbitrary *variants*
  // (`data-[state=open]:`, `[&>svg]:size-4`) are not values and stay legal.
  //
  // Scoped to every source file rather than to `app/` and `components/`, so a
  // directory added later is covered without anyone remembering to widen it.
  {
    name: "aira/tailwind/no-arbitrary-value",
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    // `lib/domain` is excluded, and not as a courtesy. ESLint *replaces* rule
    // options between config blocks rather than merging them, so a second
    // `no-restricted-syntax` block matching the core would silently displace
    // every AD-2 denial in eslint.boundary.mjs — the whole purity boundary,
    // gone, with lint still exiting zero. The pure core holds no markup and no
    // class names, so it has nothing to lose here. tests/boundary.test.ts is
    // what caught this; do not widen the glob without re-reading it.
    ignores: [`${CORE_DIR}/**`],
    plugins: { tailwindcss },
    rules: {
      "tailwindcss/no-arbitrary-value": "error",
      // `no-arbitrary-value` closes the bracket syntax and nothing else. Two
      // other doors out of the token scale stay open, and both were reachable:
      // Tailwind's own default palette (`bg-red-500` is a real utility that
      // compiles, follows no theme, and lints clean) and an inline `style`
      // prop carrying a colour. Denied here as syntax, so they are caught in
      // `className`, in `cn()`, and inside template literals alike.
      "no-restricted-syntax": [
        "error",
        {
          selector: `Literal[value=${OFF_PALETTE_PATTERN}]`,
          message: MSG_OFF_PALETTE,
        },
        {
          selector: `TemplateElement[value.raw=${OFF_PALETTE_PATTERN}]`,
          message: MSG_OFF_PALETTE,
        },
        {
          selector: `JSXAttribute[name.name='style'] Property[key.name=${STYLE_COLOR_PROPERTIES}] > Literal[value=${COLOR_LITERAL_PATTERN}]`,
          message: MSG_STYLE_COLOR,
        },
        {
          selector: `JSXAttribute[name.name='style'] Property[key.name=${STYLE_COLOR_PROPERTIES}] TemplateElement[value.raw=${COLOR_LITERAL_PATTERN}]`,
          message: MSG_STYLE_COLOR,
        },
      ],
    },
  },
  {
    // The suites that prove these rules bite have to *contain* the violations
    // they probe — `bg-red-500`, `#fff`, `p-[13px]` — as ordinary string
    // literals, so the rules would report on the assertions themselves. Same
    // reasoning as the boundary fixtures in eslint.boundary.mjs. No test file
    // renders UI, so nothing here is a real escape hatch.
    name: "aira/tailwind/suite-probes",
    files: ["tests/**"],
    rules: {
      "tailwindcss/no-arbitrary-value": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    // shadcn's generated primitives ship genuine arbitrary values by design —
    // `rounded-[min(var(--radius-md),10px)]` and the `color-mix()` hovers reach
    // past the semantic role into the raw scale on purpose. They are vendored,
    // regenerated by `shadcn add`, and never hand-edited, so the exemption is by
    // path. It is the only exemption; nothing else may claim it.
    name: "aira/tailwind/vendored-primitives",
    files: ["components/ui/**"],
    rules: {
      "tailwindcss/no-arbitrary-value": "off",
      "no-restricted-syntax": "off",
    },
  },
]);

export default eslintConfig;
