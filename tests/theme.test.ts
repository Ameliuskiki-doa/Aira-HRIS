/**
 * Proves the design-system foundation is wired the way AD-22 and AD-36 require.
 *
 * Three of these properties are invisible in a running page until months later,
 * and one of them fails *silently* — a literal inside `@theme inline` is
 * constant-folded into the utility, no variable survives to override it, and
 * the build still exits zero. So the suite works at two levels:
 *
 *   1. On the source of `app/globals.css`, because that is where the trap is:
 *      an `@theme inline` block whose values are not all `var()` references.
 *   2. On the *compiled* stylesheet, because the source only expresses intent.
 *      Utilities are checked for a `var()` reference, and the custom-property
 *      cascade is then resolved the way CSS resolves it — substituting in the
 *      scope that declares the property, which is precisely the rule that makes
 *      root-only theming pass and nested theming fail.
 *
 * Every discriminating assertion carries a negative control: the same check run
 * against a deliberately broken variant, asserted to fail. Without those, a
 * check that can no longer distinguish anything still reads green.
 */
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { renderToStaticMarkup } from "react-dom/server";
import { compile } from "tailwindcss";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `next/font/google` is a build-time transform, not a runtime module, so the
 * layout cannot be imported without standing in for it. Standing in for it is
 * also the point: the stub records the options the layout actually passes, so
 * the CSS can be checked against the variable name the layout really declares
 * rather than against a name repeated in the assertion.
 */
type FontOptions = { variable?: string; subsets?: string[] };
// `vi.mock` is hoisted above every `const` in the module, so the array it
// closes over has to be hoisted with it.
const { fontCalls } = vi.hoisted(() => ({ fontCalls: [] as FontOptions[] }));
vi.mock("next/font/google", () => ({
  Inter: (options: FontOptions) => {
    fontCalls.push(options);
    return { variable: "font-inter-stub", className: "font-inter-stub" };
  },
}));

import RootLayout from "../app/layout";
import {
  DARK_CLASS,
  DEFAULT_THEME,
  resolveTheme,
  THEME_SCRIPT,
  THEME_STORAGE_KEY,
} from "../app/theme-script";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const require_ = createRequire(resolve(ROOT, "package.json"));

const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

/**
 * File contents with comments removed, so the suite reads what ships rather
 * than what is explained. `app/globals.css` documents the very things these
 * assertions forbid — the Google Fonts import, the dead Geist reference, the
 * vendored file it must not link — and a prose mention of them is not a bug.
 */
const readCode = (rel: string) =>
  rel.endsWith(".css")
    ? stripComments(read(rel))
    : read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// --- the manifest ------------------------------------------------------------
// Written out here rather than derived from the stylesheet. This is the half
// that fails when a variable quietly disappears from one theme.

/** Recorded in the story. The vendored file is never edited. */
const NOCTURNE_SHA256 =
  "6fea354710ec4e3b2b979b723ed37d8e8959bb7d9137425d0d562b4ad8733cda";

/**
 * The app's semantic layer. Not part of Nocturne — these exist nowhere but in
 * application CSS, and every designed screen depends on all eleven.
 */
const UI_VARS = [
  "--ui-body",
  "--ui-muted",
  "--ui-faint",
  "--ui-nav",
  "--ui-hover",
  "--ui-track",
  "--ui-tint",
  "--ui-active-bg",
  "--ui-active-fg",
  "--ui-accent-text",
  "--ui-link-hover",
] as const;

/** shadcn's raw role layer. Every generated component names one of these. */
const SHADCN_ROLE_VARS = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--border",
  "--input",
  "--ring",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--sidebar",
  "--sidebar-foreground",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
  "--sidebar-accent",
  "--sidebar-accent-foreground",
  "--sidebar-border",
  "--sidebar-ring",
] as const;

/** The Nocturne primitives that differ between the two themes. */
const NOCTURNE_THEMED_VARS = [
  "--color-bg",
  "--color-surface",
  "--color-text",
  "--brand",
  "--color-divider",
  "--shadow-ambient",
  "--shadow-sm",
  "--shadow-md",
  "--shadow-lg",
] as const;

/**
 * Radius is the one Nocturne value that could not be carried over as-is:
 * shadcn derives its whole chain by `calc()` from a single `--radius`, and its
 * components dereference `var(--radius-md)` directly. `--radius` is therefore
 * tuned so the derived `md` step lands on Nocturne's 8px. Pinned as the
 * relationship rather than the number, so the intent is what fails.
 */
const RADIUS_CHAIN = {
  base: "--radius",
  derived: { "--radius-sm": 0.6, "--radius-md": 0.8, "--radius-lg": 1 },
  nocturneMediumPx: 8,
} as const;

/**
 * Where a written-out colour is legitimate, per scope. Everything else must
 * reference the ramp: a hand-copied hex is a second definition of a value that
 * already has one, free to drift from it silently.
 */
const LITERAL_COLOURS_ALLOWED: Record<string, RegExp[]> = {
  // The ramps themselves, the brand hex, and the one role Nocturne does not
  // define.
  ":root": [
    /^--color-(?:neutral|accent)-\d00$/,
    // The light side's fourth AA-passing text step, interpolated between
    // neutral-600 and neutral-700 because the ramp does not carry one. Allowed
    // by name so it cannot be confused with a hand-copied value, and its whole
    // reason for existing is asserted by the contrast suite below.
    /^--color-neutral-650$/,
    /^--brand-dark$/,
    /^--destructive$/,
  ],
  // The dark ground, surface and text are primitives rather than ramp steps,
  // and the ambient shadow is true black, which no ramp carries.
  ".dark": [
    /^--color-(?:bg|surface|text)$/,
    /^--shadow-ambient$/,
    /^--destructive$/,
  ],
};

/**
 * The four `--ui-*` roles that carry text, in the order their contrast must
 * descend. The other seven are surfaces and marks — a 6% hover wash is not
 * text and has nothing to pass.
 */
const TEXT_ROLES = ["--ui-nav", "--ui-body", "--ui-muted", "--ui-faint"] as const;

/** WCAG AA for body-size text. */
const AA_CONTRAST = 4.5;

/**
 * Both grounds a text role can land on. Checking only one hides the failure:
 * on dark the lighter `--color-surface` is the worse case (cards, sidebar,
 * table cells), on light it is the darker `--color-bg`.
 */
const GROUNDS = ["--color-bg", "--color-surface"] as const;

/** Colour in any notation. */
const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:oklch|oklab|rgba?|hsla?|lch|lab)\(/i;

/**
 * Raw values the two themes must actually resolve to, from the theming table in
 * `design-system.md`. Pinned so a mapping cannot drift while every structural
 * assertion still passes.
 */
const EXPECTED = {
  light: { "--color-bg": "#e4e7f5", "--color-text": "#292b31", "--brand": "#5d5294" },
  dark: { "--color-bg": "#161826", "--color-text": "#e9e9ed", "--brand": "#9184d9" },
} as const;

/**
 * Utility → the raw custom property it must resolve through. Naming the exact
 * variable, not merely "contains a var()", is what gives this teeth: a
 * `shadow-md` folded back to Tailwind's default still contains `var()` — three
 * of them, for the ring and inset composition — and would sail past a looser
 * check.
 */
const THEMED_UTILITIES: Record<string, string> = {
  "bg-background": "--background",
  "text-foreground": "--foreground",
  "bg-card": "--card",
  "bg-popover": "--popover",
  "bg-primary": "--primary",
  "text-primary-foreground": "--primary-foreground",
  "bg-secondary": "--secondary",
  "bg-muted": "--muted",
  "bg-accent": "--accent",
  "text-accent-foreground": "--accent-foreground",
  "border-border": "--border",
  "ring-ring": "--ring",
  "bg-sidebar": "--sidebar",
  "bg-brand": "--brand",
  "text-brand-300": "--color-accent-300",
  // Elevation follows the theme only because the raw `--shadow-*` outrank
  // Tailwind's folded defaults; if that stops holding, these fold back.
  "shadow-sm": "--shadow-sm",
  "shadow-md": "--shadow-md",
  "shadow-lg": "--shadow-lg",
  // Deleting a font key from `@theme inline` does not break the build and does
  // not fail a source-level check — the utility simply stops being generated
  // and every element it styled falls back to the inherited family. Asserting
  // on the compiled utility is what catches that.
  "font-sans": "--font-sans",
  "font-mono": "--font-mono",
  "font-heading": "--font-heading",
  "font-body": "--font-body",
  "rounded-md": "--radius",
  ...Object.fromEntries(
    UI_VARS.map((v) => [`text-ui${v.slice("--ui".length)}`, v]),
  ),
};

// --- a very small CSS reader -------------------------------------------------
// Enough to read top-level rules and their declarations. Not a general parser:
// it exists so the suite can reason about `:root`, `.dark` and `@theme inline`
// without taking on a dependency the product does not otherwise need.

type Rule = { prelude: string; decls: Map<string, string> };

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

function parseTopLevelRules(css: string): Rule[] {
  const src = stripComments(css);
  const rules: Rule[] = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf("{", i);
    if (open === -1) break;
    // Statement at-rules (`@import`, `@custom-variant`) end in a semicolon and
    // are not blocks; drop anything before the last one so the prelude is just
    // this rule's selector.
    const chunk = src.slice(i, open);
    const prelude = chunk.slice(chunk.lastIndexOf(";") + 1).trim();
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === "{") depth += 1;
      else if (src[j] === "}") depth -= 1;
      j += 1;
    }
    rules.push({ prelude, decls: parseDecls(src.slice(open + 1, j - 1)) });
    i = j;
  }
  return rules;
}

/** Declarations directly in a block. Nested blocks are skipped. */
function parseDecls(body: string): Map<string, string> {
  const decls = new Map<string, string>();
  let depth = 0;
  let buffer = "";
  for (const ch of body) {
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (ch === ";" && depth === 0) {
      addDecl(decls, buffer);
      buffer = "";
      continue;
    }
    buffer += ch;
  }
  addDecl(decls, buffer);
  return decls;
}

function addDecl(decls: Map<string, string>, raw: string) {
  const text = raw.trim();
  if (!text || text.includes("{")) return;
  const colon = text.indexOf(":");
  if (colon === -1) return;
  decls.set(text.slice(0, colon).trim(), text.slice(colon + 1).trim());
}

/**
 * Every source file this change owns, found on disk.
 *
 * `git ls-files` was the obvious way to enumerate these and the wrong one:
 * everything Story 1.2 adds is untracked until it is committed, so a sweep
 * built on it inspected none of the new code and still reported green. The
 * walk below sees the working tree, and `sourceFiles` is asserted non-empty and
 * asserted to contain known members, so a walk that silently finds nothing
 * cannot pass either.
 */
const WALK_ROOTS = ["app", "components", "lib", "styles", "public", "worker"];
const WALK_SKIP = new Set(["node_modules", ".next", ".git", "__boundary__"]);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (WALK_SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(relative(ROOT, full));
  }
  return out;
}

const sourceFiles = WALK_ROOTS.flatMap((dir) => walk(resolve(ROOT, dir)));

/** Text-bearing sources only; `.woff2` and `.ico` are not worth reading. */
const TEXT_FILE = /\.(?:tsx?|jsx?|mts|cts|mjs|cjs|css|svg|json|html)$/;
const textSourceFiles = sourceFiles.filter((f) => TEXT_FILE.test(f));

/** Only custom properties; `color-scheme` and friends are not tokens. */
const customProps = (decls: Map<string, string>) =>
  new Set([...decls.keys()].filter((k) => k.startsWith("--")));

// --- the CSS cascade, as CSS actually resolves it ----------------------------

const VAR_REF = /var\(\s*(--[\w-]+)\s*\)/g;

/**
 * Computed custom properties for one element.
 *
 * The rule that matters: a custom property is substituted at computed-value
 * time **in the scope that declares it**. A property declared only on `:root`
 * is therefore frozen there — a nested subtree redefining what it points at
 * cannot move it. That is the whole difference between a working `@theme
 * inline` and the three wirings that only look like they work.
 */
function computeScope(
  declared: Map<string, string>,
  inherited: Map<string, string>,
): Map<string, string> {
  const out = new Map(inherited);
  const resolving = new Set<string>();

  const valueOf = (name: string): string => {
    if (!declared.has(name)) return inherited.get(name) ?? "";
    if (resolving.has(name)) return ""; // cyclic: invalid at computed-value time
    resolving.add(name);
    const substituted = declared
      .get(name)!
      .replace(VAR_REF, (_, ref: string) => valueOf(ref));
    resolving.delete(name);
    return substituted;
  };

  for (const name of declared.keys()) out.set(name, valueOf(name));
  return out;
}

// --- contrast, computed rather than asserted ---------------------------------
// The ratios are derived from whatever the stylesheet actually resolves to, so
// a ramp retune that quietly drops a role below AA fails here. Pinning the hex
// strings instead would keep passing: the strings would still match.

type Rgb = [number, number, number];
type Colour = { rgb: Rgb; alpha: number };

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, or a `color-mix()` over transparent. */
function parseColour(value: string): Colour {
  const text = value.trim();

  const mix = /^color-mix\(\s*in\s+[\w-]+\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*transparent\s*\)$/.exec(
    text,
  );
  if (mix) {
    const base = parseColour(mix[1]);
    return { rgb: base.rgb, alpha: base.alpha * (Number(mix[2]) / 100) };
  }

  const hex = /^#([0-9a-f]{3,8})$/i.exec(text);
  if (!hex) throw new Error(`cannot read colour: ${value}`);
  const digits =
    hex[1].length <= 4
      ? [...hex[1]].map((d) => d + d).join("")
      : hex[1];
  const bytes = (digits.match(/../g) ?? []).map((b) => parseInt(b, 16));
  return {
    rgb: [bytes[0], bytes[1], bytes[2]],
    alpha: bytes.length === 4 ? bytes[3] / 255 : 1,
  };
}

/** Straight alpha compositing. A translucent role is only as legible as what
 *  is behind it, so the ratio has to be taken on the composited result. */
function over(foreground: Colour, background: Colour): Rgb {
  return foreground.rgb.map((channel, i) =>
    channel * foreground.alpha + background.rgb[i] * (1 - foreground.alpha),
  ) as Rgb;
}

/** WCAG 2.x relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/** The ratio of a role against one ground, composited if it is translucent. */
function roleContrast(roleValue: string, groundValue: string): number {
  const ground = parseColour(groundValue);
  return contrastRatio(over(parseColour(roleValue), ground), ground.rgb);
}

// --- compiling the real stylesheet -------------------------------------------

/**
 * Locate a package's manifest. `require.resolve` cannot be used for this —
 * `tw-animate-css` is one of the packages that does not expose
 * `./package.json` through `exports` — so walk the resolution paths instead.
 */
function packageJsonOf(pkgName: string): string {
  for (const dir of require_.resolve.paths(pkgName) ?? []) {
    const candidate = resolve(dir, pkgName, "package.json");
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`cannot locate ${pkgName}`);
}

/** Resolve a stylesheet specifier the way the PostCSS plugin would. */
function resolveStylesheet(id: string, base: string): string {
  if (id.startsWith(".") || id.startsWith("/")) return resolve(base, id);
  const slash = id.indexOf("/");
  const pkgName = slash === -1 ? id : id.slice(0, slash);
  const subpath = slash === -1 ? "" : id.slice(slash + 1);
  const pkgJsonPath = packageJsonOf(pkgName);
  const pkgDir = dirname(pkgJsonPath);
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  if (subpath) {
    const mapped = pkg.exports?.[`./${subpath}`];
    return resolve(pkgDir, typeof mapped === "string" ? mapped : subpath);
  }
  const entry = pkg.exports?.["."]?.style ?? pkg.style ?? pkg.main;
  return resolve(pkgDir, entry ?? "index.css");
}

async function buildCss(source: string, candidates: string[]): Promise<string> {
  const compiler = await compile(source, {
    base: resolve(ROOT, "app"),
    async loadStylesheet(id, base) {
      const path = resolveStylesheet(id, base);
      return { path, base: dirname(path), content: readFileSync(path, "utf8") };
    },
  });
  return compiler.build(candidates);
}

/** The one declaration a utility produces, e.g. `background-color: var(--x)`. */
function utilityDeclaration(css: string, utility: string): string {
  const escaped = utility.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const match = new RegExp(`\\.${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`utility .${utility} was not generated`);
  return match[1].trim();
}

// --- shared fixtures ---------------------------------------------------------

const globalsSource = read("app/globals.css");
const rules = parseTopLevelRules(globalsSource);

const themeInlineBlocks = rules.filter((r) => /^@theme\s+inline$/.test(r.prelude));
const rootRules = rules.filter((r) => r.prelude === ":root");
const darkRule = rules.find((r) => r.prelude === `.${DARK_CLASS}`);

/** Every `:root` declaration, in source order — the light-theme scope. */
const lightDecls = new Map<string, string>();
for (const rule of rootRules) {
  for (const [k, v] of rule.decls) lightDecls.set(k, v);
}

let compiled = "";
beforeAll(async () => {
  compiled = await buildCss(globalsSource, Object.keys(THEMED_UTILITIES));
}, 120_000);

// --- the vendored stylesheet -------------------------------------------------

describe("vendored Nocturne stylesheet", () => {
  it("is byte-identical to the recorded source", () => {
    const bytes = readFileSync(resolve(ROOT, "styles/nocturne.css"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(NOCTURNE_SHA256);
  });

  it("still carries the remote font import that is the reason not to link it", () => {
    // If this ever stops being true the file may safely be linked, and the
    // reasoning in `app/globals.css` needs revisiting rather than trusting.
    expect(read("styles/nocturne.css")).toContain("fonts.googleapis.com");
  });

  it("is never pulled into the document", () => {
    // Everything but the vendored file itself: a `<link>`, a CSS `@import`, or
    // a bundler-visible `import "…/nocturne.css"` would each fire the remote
    // font request the vendoring exists to avoid.
    for (const file of textSourceFiles) {
      if (file === join("styles", "nocturne.css")) continue;
      expect(
        readCode(file),
        `${file} references the vendored stylesheet`,
      ).not.toMatch(/nocturne\.css/);
    }
  });

  it("keeps every Google Fonts request out of the shipped CSS", () => {
    expect(readCode("app/globals.css")).not.toContain("fonts.googleapis.com");
    expect(compiled).not.toContain("fonts.googleapis.com");
  });
});

// --- the trap ----------------------------------------------------------------

describe("@theme inline", () => {
  it("is the only form of @theme in the stylesheet", () => {
    // A non-inline `@theme` resolves the indirection once at `:root`. It works
    // on `<html>` and silently fails in a nested subtree, which is the failure
    // mode hardest to notice and cheapest to prevent here.
    const themeBlocks = rules.filter((r) => r.prelude.startsWith("@theme"));
    expect(themeBlocks.length).toBeGreaterThan(0);
    expect(themeBlocks).toEqual(themeInlineBlocks);
  });

  it("contains no literal values", () => {
    const literal = /#[0-9a-f]{3,8}\b|\b(?:oklch|oklab|rgba?|hsla?|lch|lab)\(/i;
    for (const block of themeInlineBlocks) {
      for (const [name, value] of block.decls) {
        expect(value, `${name} is a literal inside @theme inline`).not.toMatch(literal);
        expect(value, `${name} does not reference a variable`).toContain("var(--");
      }
    }
  });

  it("maps every shadcn role and every --ui-* variable", () => {
    const mapped = new Set(themeInlineBlocks.flatMap((b) => [...b.decls.keys()]));
    for (const ui of UI_VARS) {
      expect(mapped, `${ui} has no Tailwind theme key`).toContain(
        `--color-ui${ui.slice("--ui".length)}`,
      );
    }
    expect(mapped).toContain("--color-background");
    expect(mapped).toContain("--color-brand");
  });
});

// --- theming -----------------------------------------------------------------

describe("theming", () => {
  it("declares both themes as raw values on :root and .dark", () => {
    expect(darkRule, "no .dark rule").toBeDefined();
    const required = [...SHADCN_ROLE_VARS, ...UI_VARS, ...NOCTURNE_THEMED_VARS];
    for (const name of required) {
      expect(customProps(lightDecls), `${name} missing from :root`).toContain(name);
      expect(customProps(darkRule!.decls), `${name} missing from .dark`).toContain(name);
    }
  });

  it("re-declares in .dark everything the light theme block declares", () => {
    // Not a style preference. A property declared only on `:root` computes
    // there and stays there, so omitting one from `.dark` leaves that single
    // value stuck on the light theme inside a dark subtree.
    const lightBlock = rootRules.find((r) => r.decls.has("color-scheme"));
    expect(lightBlock, "no :root block carries color-scheme").toBeDefined();
    expect(darkRule!.decls.get("color-scheme")).toBe("dark");
    expect([...customProps(darkRule!.decls)].sort()).toEqual(
      [...customProps(lightBlock!.decls)].sort(),
    );
  });

  it("compiles every themed utility through its raw variable", () => {
    for (const [utility, variable] of Object.entries(THEMED_UTILITIES)) {
      const declaration = utilityDeclaration(compiled, utility);
      expect(
        declaration,
        `${utility} does not resolve through ${variable}`,
      ).toContain(`var(${variable})`);
    }
  });

  it("themes a nested subtree independently of the document root", () => {
    // The load-bearing case. Root-only theming passes under three of the four
    // possible wirings, two of which are wrong; only a nested subtree separates
    // them. The document root here is *light* and a descendant carries `.dark`.
    const root = computeScope(lightDecls, new Map());
    const nested = computeScope(darkRule!.decls, root);

    for (const [name, value] of Object.entries(EXPECTED.light)) {
      expect(root.get(name), `${name} at the root`).toBe(value);
    }
    for (const [name, value] of Object.entries(EXPECTED.dark)) {
      expect(nested.get(name), `${name} in the nested subtree`).toBe(value);
    }

    // Everything the two themes are supposed to distinguish, distinguished.
    for (const name of [...SHADCN_ROLE_VARS, ...UI_VARS, ...NOCTURNE_THEMED_VARS]) {
      expect(root.get(name), `${name} is empty at the root`).toBeTruthy();
      expect(nested.get(name), `${name} is empty when nested`).toBeTruthy();
    }
    expect(nested.get("--background")).not.toBe(root.get("--background"));
    expect(nested.get("--ui-nav")).not.toBe(root.get("--ui-nav"));

    // `--ui-tint` is the documented exception: a wash, not a text colour, so it
    // keeps the dark accent hex in both themes and only its alpha moves.
    expect(root.get("--ui-tint")).toContain("#9184d9");
    expect(nested.get("--ui-tint")).toContain("#9184d9");
  });

  it("declares every raw variable the vendored primitives dereference", () => {
    // shadcn's components reach past the semantic role into the raw scale —
    // `var(--radius-md)`, `var(--secondary)`, `var(--foreground)`. Those names
    // are not emitted by `@theme inline`, so if the stylesheet stops declaring
    // one, the declaration using it becomes invalid at computed-value time and
    // the component loses that property with nothing reported anywhere.
    const declared = new Set([
      ...customProps(lightDecls),
      ...customProps(darkRule!.decls),
    ]);
    const primitives = sourceFiles.filter((f) =>
      f.startsWith(join("components", "ui") + "/"),
    );
    expect(primitives.length).toBeGreaterThan(0);
    const referenced = new Set<string>();
    for (const file of primitives) {
      for (const [, name] of read(file).matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
        if (!name.startsWith("--tw-")) referenced.add(name);
      }
    }
    expect(referenced.size).toBeGreaterThan(0);
    for (const name of referenced) {
      expect(declared, `components/ui dereferences undeclared ${name}`).toContain(
        name,
      );
    }
  });

  it("keeps the radius chain tuned to Nocturne's medium step", () => {
    const base = lightDecls.get(RADIUS_CHAIN.base);
    expect(base, "--radius is not declared").toMatch(/^[\d.]+px$/);
    for (const [name, factor] of Object.entries(RADIUS_CHAIN.derived)) {
      expect(lightDecls.get(name), `${name} is not declared`).toBe(
        factor === 1
          ? `var(${RADIUS_CHAIN.base})`
          : `calc(var(${RADIUS_CHAIN.base}) * ${factor})`,
      );
    }
    // The relationship, not the number: whatever `--radius` becomes, the step
    // shadcn's components dereference has to land on Nocturne's 8px.
    expect(parseFloat(base!) * RADIUS_CHAIN.derived["--radius-md"]).toBeCloseTo(
      RADIUS_CHAIN.nocturneMediumPx,
      6,
    );
    expect(utilityDeclaration(compiled, "rounded-md")).toContain(
      `var(${RADIUS_CHAIN.base})`,
    );
  });

  it("has no stylesheet the literal check does not cover", () => {
    // The check below reads `app/globals.css`. ESLint does not lint CSS, so a
    // second stylesheet appearing in the tree would carry hand-written colours
    // past every rule in this repo. Pinned rather than guessed: adding one is
    // fine, but it has to come with a decision about how it is guarded.
    const stylesheets = textSourceFiles.filter((f) => f.endsWith(".css"));
    expect(stylesheets.sort()).toEqual(
      [join("app", "globals.css"), join("styles", "nocturne.css")].sort(),
    );
  });

  it("writes a colour literal only where the scale itself is defined", () => {
    // The file's thesis is that a value written twice drifts. The `@theme
    // inline` check above guards one block; this guards the raw layer, where a
    // hand-copied `#cfd3e5` beside a `--color-neutral-300` that already holds
    // it is exactly the same failure one tier down.
    for (const [scope, allowed] of Object.entries(LITERAL_COLOURS_ALLOWED)) {
      const scoped = rules.filter((r) => r.prelude === scope);
      expect(scoped.length, `no ${scope} rule`).toBeGreaterThan(0);
      for (const rule of scoped) {
        for (const [name, value] of rule.decls) {
          if (!COLOUR_LITERAL.test(value)) continue;
          expect(
            allowed.some((pattern) => pattern.test(name)),
            `${scope} { ${name}: ${value} } — reference the ramp instead`,
          ).toBe(true);
        }
      }
    }
  });

  it("detects a role that is declared only on :root", () => {
    // Negative control for the case above. Drop `--background` from `.dark` and
    // the nested subtree must be caught keeping the light value.
    const crippled = new Map(darkRule!.decls);
    crippled.delete("--background");
    const root = computeScope(lightDecls, new Map());
    const nested = computeScope(crippled, root);
    expect(nested.get("--background")).toBe(root.get("--background"));
  });

  it("detects a literal that reached @theme inline", async () => {
    // Negative control for the utility check. Poison one mapping the way a
    // hurried edit would, and the utility must stop being a var() reference —
    // while the compile still succeeds, which is what makes it dangerous.
    const poisoned = globalsSource.replace(
      "--color-background: var(--background);",
      "--color-background: oklch(1 0 0);",
    );
    expect(poisoned).not.toBe(globalsSource);
    const built = await buildCss(poisoned, ["bg-background"]);
    const declaration = utilityDeclaration(built, "bg-background");
    expect(declaration).not.toContain("var(--background)");
  }, 120_000);
});

// --- legibility --------------------------------------------------------------

describe("text-role contrast", () => {
  /** The two theme scopes, resolved the way an element sees them. */
  const scopes = () => {
    const light = computeScope(lightDecls, new Map());
    return { light, dark: computeScope(darkRule!.decls, light) };
  };

  it("computes ratios correctly before trusting them", () => {
    // A luminance formula with a typo passes every threshold below it. These
    // are the fixed points that catch that: black on white is exactly 21:1,
    // any colour on itself is 1:1, and a half-transparent white over black
    // composites to the same grey a solid one would.
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 6);
    expect(contrastRatio([18, 24, 38], [18, 24, 38])).toBeCloseTo(1, 6);
    expect(over({ rgb: [255, 255, 255], alpha: 0.5 }, { rgb: [0, 0, 0], alpha: 1 }))
      .toEqual([127.5, 127.5, 127.5]);
    expect(parseColour("color-mix(in srgb, #ffffff 40%, transparent)")).toEqual({
      rgb: [255, 255, 255],
      alpha: 0.4,
    });
    expect(parseColour("#000")).toEqual({ rgb: [0, 0, 0], alpha: 1 });
    // A translucent role must read worse than the solid one it is mixed from.
    expect(roleContrast("color-mix(in srgb, #ffffff 40%, transparent)", "#161826"))
      .toBeLessThan(roleContrast("#ffffff", "#161826"));
  });

  it("clears WCAG AA on the worse of the two grounds in each theme", () => {
    for (const [theme, scope] of Object.entries(scopes())) {
      const grounds = GROUNDS.map((name) => {
        const value = scope.get(name);
        expect(value, `${theme} has no ${name}`).toBeTruthy();
        return { name, value: value! };
      });
      for (const role of TEXT_ROLES) {
        const value = scope.get(role);
        expect(value, `${theme} has no ${role}`).toBeTruthy();
        for (const ground of grounds) {
          expect(
            roleContrast(value!, ground.value),
            `${theme} ${role} (${value}) on ${ground.name} (${ground.value})`,
          ).toBeGreaterThanOrEqual(AA_CONTRAST);
        }
      }
    }
  });

  it("keeps the four roles separated in contrast, not merely distinct", () => {
    // The reason the roles are ramp steps rather than tuned alphas: pushing
    // alphas up to reach AA collapses `muted` and `faint` onto one value. Four
    // roles that all pass but read identically are not a hierarchy.
    for (const [theme, scope] of Object.entries(scopes())) {
      const worst = TEXT_ROLES.map((role) =>
        Math.min(
          ...GROUNDS.map((ground) =>
            roleContrast(scope.get(role)!, scope.get(ground)!),
          ),
        ),
      );
      for (let i = 1; i < worst.length; i += 1) {
        expect(
          worst[i - 1],
          `${theme}: ${TEXT_ROLES[i - 1]} must read stronger than ${TEXT_ROLES[i]}`,
        ).toBeGreaterThan(worst[i]);
      }
    }
  });

  it("resolves the text roles to solid colours, not alphas", () => {
    // Not a style rule. A `color-mix()` over transparent is only as legible as
    // whatever sits behind it, and these roles land on two different grounds.
    for (const [theme, scope] of Object.entries(scopes())) {
      for (const role of TEXT_ROLES) {
        expect(
          parseColour(scope.get(role)!).alpha,
          `${theme} ${role} is translucent`,
        ).toBe(1);
      }
    }
  });
});

// --- first paint -------------------------------------------------------------

describe("theme script", () => {
  it("resolves only an explicit light preference to light", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
    expect(resolveTheme(null)).toBe("dark");
    expect(resolveTheme(undefined)).toBe("dark");
    expect(resolveTheme("")).toBe("dark");
    expect(resolveTheme("system")).toBe("dark");
  });

  it("applies a stored light preference before first paint", () => {
    const el = runThemeScript({ [THEME_STORAGE_KEY]: "light" });
    expect(el.classes.has(DARK_CLASS)).toBe(false);
    expect(el.style.colorScheme).toBe("light");
  });

  it("keeps dark when nothing is stored", () => {
    const el = runThemeScript({});
    expect(el.classes.has(DARK_CLASS)).toBe(true);
    expect(el.style.colorScheme).toBe("dark");
  });

  it("keeps the server-rendered theme when storage throws", () => {
    // Safari in private mode. A throw here would run before anything else on
    // the page and take the document with it.
    const el = runThemeScript(null);
    expect(el.classes.has(DARK_CLASS)).toBe(true);
  });

  it("is inlined into <head>, blocking, ahead of the body", () => {
    expect(DEFAULT_THEME).toBe("dark");

    // Rendered, not read. The previous version of this searched THEME_SCRIPT —
    // the script *body* — for `async|defer`, a string that cannot contain a tag
    // attribute, so adding `defer` to the tag passed green while the theme
    // resolved after first paint and every visit flashed.
    const html = renderToStaticMarkup(RootLayout({ children: null, params: Promise.resolve({}) }));

    const tag = /<script\b([^>]*)>/.exec(html);
    expect(tag, "no <script> was rendered").not.toBeNull();
    const attributes = tag![1];
    for (const disqualifier of ["async", "defer", "src=", "type=", "nomodule"]) {
      expect(attributes, `the theme script is ${disqualifier}`).not.toContain(
        disqualifier,
      );
    }
    expect(html).toContain(THEME_SCRIPT);

    // In <head>, ahead of anything the body can paint.
    const script = html.indexOf("<script");
    const head = html.indexOf("<head>");
    const body = html.indexOf("<body");
    expect(head).toBeGreaterThan(-1);
    expect(script).toBeGreaterThan(head);
    expect(script).toBeLessThan(body);

    // Server-rendered with the class already on, so a visitor with JavaScript
    // disabled gets the default theme rather than an unthemed page.
    const htmlClass = /<html[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(htmlClass.split(/\s+/)).toContain(DARK_CLASS);
    expect(htmlClass).toContain("font-inter-stub");
  });
});

/**
 * Run the inline script against the smallest document that can observe it.
 * `storage` of `null` makes `localStorage` throw, as a privacy mode does.
 */
function runThemeScript(storage: Record<string, string> | null) {
  const element = {
    classes: new Set<string>([DARK_CLASS]),
    style: { colorScheme: "" },
  };
  const documentStub = {
    documentElement: {
      classList: {
        toggle(name: string, on: boolean) {
          if (on) element.classes.add(name);
          else element.classes.delete(name);
        },
      },
      style: element.style,
    },
  };
  const localStorageStub = {
    getItem(key: string) {
      if (storage === null) throw new Error("access denied");
      return storage[key] ?? null;
    },
  };
  new Function("document", "localStorage", THEME_SCRIPT)(
    documentStub,
    localStorageStub,
  );
  return element;
}

// --- the escape hatch --------------------------------------------------------

describe("arbitrary values", () => {
  const eslint = new ESLint({ cwd: ROOT });

  const lint = async (code: string, rel: string) => {
    const [result] = await eslint.lintText(code, {
      filePath: resolve(ROOT, rel),
      warnIgnored: false,
    });
    return result.messages.filter(
      (m) => m.ruleId === "tailwindcss/no-arbitrary-value",
    );
  };

  /** Every message, for the denials that are not the plugin's. */
  const lintAll = async (code: string, rel: string) => {
    const [result] = await eslint.lintText(code, {
      filePath: resolve(ROOT, rel),
      warnIgnored: false,
    });
    return result.messages;
  };

  const component = (className: string) =>
    `export default function Probe() {\n  return <div className="${className}" />;\n}\n`;

  it("rejects an arbitrary value in app code", async () => {
    const messages = await lint(component("p-[13px]"), "app/probe.tsx");
    expect(messages).toHaveLength(1);
    // Severity 2 is what makes the CLI exit non-zero.
    expect(messages[0].severity).toBe(2);
    expect(messages[0].message).toContain("p-[13px]");
  });

  it("rejects an arbitrary colour, wherever it is written", async () => {
    for (const [code, path] of [
      [component("bg-[#9184d9]"), "app/probe.tsx"],
      [
        `import { cn } from "@/lib/utils";\nexport const c = cn("bg-[#9184d9]");\n`,
        "lib/probe.ts",
      ],
      [
        'export default function Probe() {\n  const pad = true;\n  return <div className={`text-sm ${pad ? "p-[13px]" : ""}`} />;\n}\n',
        "app/probe.tsx",
      ],
    ] as const) {
      const messages = await lint(code, path);
      expect(messages.length, `not caught in ${path}: ${code}`).toBeGreaterThan(0);
    }
  });

  it("leaves arbitrary variants alone — a variant is not a value", async () => {
    for (const className of [
      "data-[state=open]:opacity-100",
      "[&>svg]:size-4",
      "supports-[backdrop-filter]:bg-transparent",
    ]) {
      expect(await lint(component(className), "app/probe.tsx")).toEqual([]);
    }
  });

  it("exempts the vendored primitives by path", async () => {
    const messages = await lint(
      component("rounded-[min(var(--radius-md),10px)] p-[13px]"),
      "components/ui/probe.tsx",
    );
    expect(messages).toEqual([]);
  });

  it("rejects Tailwind's default colour palette", async () => {
    // `no-arbitrary-value` closes the bracket syntax and nothing else.
    // `bg-red-500` is a real utility: it compiles, it lints clean under that
    // rule, and it follows neither theme.
    for (const className of [
      "bg-red-500",
      "text-zinc-400",
      "dark:hover:bg-slate-200",
      "border-t-gray-300/50",
      "from-indigo-600",
    ]) {
      const messages = await lintAll(component(className), "app/probe.tsx");
      expect(messages.map((m) => m.ruleId), className).toContain(
        "no-restricted-syntax",
      );
    }
  });

  it("rejects a colour written into a style prop", async () => {
    for (const style of [
      'style={{ color: "#fff" }}',
      'style={{ backgroundColor: "rgb(0 0 0)" }}',
      "style={{ boxShadow: `0 0 0 1px oklch(0.5 0 0)` }}",
    ]) {
      const code = `export default function Probe() {\n  return <div ${style} />;\n}\n`;
      const messages = await lintAll(code, "app/probe.tsx");
      expect(messages.map((m) => m.ruleId), style).toContain(
        "no-restricted-syntax",
      );
    }
  });

  it("leaves the token scale and non-colour styles alone", async () => {
    const clean = [
      [component("bg-background text-muted-foreground border-border"), "app/p.tsx"],
      [component("bg-brand text-brand-300 bg-ui-active-bg"), "app/p.tsx"],
      [component("text-balance grid-cols-3 duration-200"), "app/p.tsx"],
      [
        "export default function Probe() {\n  return <div style={{ width: 4 }} />;\n}\n",
        "app/p.tsx",
      ],
    ] as const;
    for (const [code, path] of clean) {
      expect(await lintAll(code, path), code).toEqual([]);
    }
  });

  it("does not disturb the AD-2 purity denials in the pure core", async () => {
    // ESLint replaces rule options between blocks rather than merging them, so
    // a second `no-restricted-syntax` block matching `lib/domain` would delete
    // the entire purity boundary while lint still exited zero. Cheap to assert
    // here; tests/boundary.test.ts is the thorough version.
    const messages = await lintAll(
      'import * as fs from "node:fs";\nexport const p = fs;\n',
      "lib/domain/probe.ts",
    );
    expect(messages.map((m) => m.ruleId)).toContain("no-restricted-syntax");
    expect(messages[0].message).toContain("AD-2");
  });

  it("keeps the exemption to that one path", async () => {
    // Negative control: the same code one directory up must still be rejected.
    const messages = await lint(component("p-[13px]"), "components/probe.tsx");
    expect(messages.length).toBeGreaterThan(0);
  });
});

// --- typography --------------------------------------------------------------

describe("typography", () => {
  it("enumerates the source tree it sweeps", () => {
    // A sweep over an empty list passes every assertion inside it. These two
    // are what stop that from reading as success.
    expect(textSourceFiles.length).toBeGreaterThan(5);
    for (const known of [
      join("app", "layout.tsx"),
      join("app", "globals.css"),
      join("components", "ui", "dialog.tsx"),
      join("styles", "nocturne.css"),
    ]) {
      expect(textSourceFiles, `${known} was not walked`).toContain(known);
    }
  });

  it("serves Inter through next/font and drops Geist", () => {
    expect(fontCalls).toHaveLength(1);
    expect(fontCalls[0].subsets).toContain("latin");
    for (const file of textSourceFiles) {
      expect(readCode(file), `${file} still references Geist`).not.toMatch(/Geist/i);
    }
  });

  it("points every font token at the identifier the layout actually declares", () => {
    // Not `"--font-inter"` written out here. The layout is free to rename it,
    // and renaming it while the CSS still dereferences the old name drops the
    // whole application to the system font — silently, with Inter still
    // downloaded and preloaded. So the name comes from the layout.
    const declared = fontCalls[0].variable;
    expect(declared, "next/font was given no CSS variable").toMatch(/^--[\w-]+$/);
    for (const token of ["--font-sans", "--font-heading", "--font-body"]) {
      expect(lightDecls.get(token), `${token} is not mapped`).toContain(
        `var(${declared})`,
      );
    }
    // Left over from the starter and dead once Geist is gone.
    expect(readCode("app/globals.css")).not.toContain("--font-geist");
  });

  it("gives the heading family and weight a reader", () => {
    // A declared token nothing consumes is a lie. `--font-heading-weight` has
    // no Tailwind namespace it can occupy — `--font-weight-heading` would
    // generate the same `font-heading` class the family already owns — so its
    // reader is a base rule on the heading elements, as in Nocturne itself.
    const blocks = [
      ...compiled.matchAll(/h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\s*\{([^}]*)\}/g),
    ].map((m) => m[1]);
    // Preflight emits one of these too, so pick the rule that wires the token.
    const wired = blocks.find((b) => b.includes("--font-heading"));
    expect(wired, "no base rule wires --font-heading onto the headings").toBeDefined();
    expect(wired).toContain("font-family: var(--font-heading)");
    expect(wired).toContain("font-weight: var(--font-heading-weight)");
    expect(lightDecls.get("--font-heading-weight")).toBe("500");

    // `--font-body` likewise: a `font-body` utility nobody applies is not a
    // reader, so the base `body` rule has to be the one that resolves it.
    const body = /\n\s*body\s*\{([^}]*)\}/.exec(compiled)?.[1] ?? "";
    expect(body).toContain("font-family: var(--font-body)");
  });
});
