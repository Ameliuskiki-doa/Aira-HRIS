/**
 * AD-2 — core purity, enforced by lint.
 *
 * `lib/domain` is the functional core: pure and total. It performs no I/O, has
 * no clock and no randomness, and it never points out of itself into `app/`,
 * `lib/db/` or `worker/`.
 *
 * The rule is stated as a *denial by default*, not as a list of forbidden
 * packages. A package list only ever covers what someone already thought of.
 * Inside `lib/domain` the only permitted module specifier is a relative one
 * that still resolves inside `lib/domain`; everything else — bare specifier,
 * `@/` alias, relative escape in any spelling — is denied.
 *
 * `no-restricted-imports` cannot express that: its `patterns` match the
 * specifier string, and no negation form re-allows a legitimate sibling import
 * once non-relative specifiers are denied. Selector rules can, so the boundary
 * is built from `no-restricted-syntax` and `no-restricted-globals`, both core
 * ESLint rules — no new dependency.
 *
 * Whether a relative specifier escapes depends on how deep the importing file
 * sits, so the escape rule is generated per depth: a file `d` directories below
 * `lib/domain` escapes when the specifier climbs `d` levels or more.
 *
 * Everything exported here is consumed by `tests/boundary.test.ts`, which
 * derives live fixtures from these entries and lints them through the real
 * `lint` script. A denial added here without a case is impossible; a denial
 * removed from here fails the suite's manifest assertion.
 */

/** Directory holding the pure core. */
export const CORE_DIR = "lib/domain";

/**
 * Every extension ESLint may encounter for a source module. Dropping one is a
 * hole — a `.mjs` outside the glob lints completely clean — so the suite pins
 * this list and probes a fixture of every extension in it.
 */
export const SOURCE_EXTENSIONS = [
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "mts",
  "cts",
];

const EXT_GLOB = `{${SOURCE_EXTENSIONS.join(",")}}`;

/**
 * Deepest directory level under `lib/domain` that gets an exact escape rule.
 * Files below this are covered by a stricter catch-all, so lowering this value
 * can never open a hole — but it does change the denial set, which the test
 * manifest pins.
 */
export const MAX_CORE_DEPTH = 6;

/**
 * Depths at which a denial that applies to the whole core is probed. Depth 1
 * and 2 are where real domain modules live; one past the exact rules proves
 * the catch-all block carries the shared denials too. Probing only depth 1
 * would let the whole shared set be gated to `lib/domain/*` unnoticed.
 */
export const SHARED_DEPTHS = [1, 2, MAX_CORE_DEPTH + 1];

/** Fixture paths written by the boundary suite. Never tracked, never typechecked. */
export const FIXTURE_IGNORES = [
  "**/*.boundary-fixture.*",
  `${CORE_DIR}/__boundary__/**`,
];

/** True while the boundary suite is running; only then are fixtures linted. */
export const LINTING_FIXTURES = process.env.AIRA_BOUNDARY_FIXTURES === "1";

/** Declaration forms that carry a module specifier in `source`. */
const SPECIFIER_NODES = [
  { kind: "import", node: "ImportDeclaration" },
  { kind: "export-all", node: "ExportAllDeclaration" },
  { kind: "export-named", node: "ExportNamedDeclaration" },
];

const MSG_OUTSIDE =
  "AD-2: lib/domain is pure and may not import anything outside itself. No framework, no React, no database client, no Node built-in, no @/ alias.";
const MSG_ESCAPE =
  "AD-2: this relative specifier leaves lib/domain. The core never points out into app/, lib/db/ or worker/.";
const MSG_ODD_RELATIVE =
  "AD-2: a '..' segment in the middle of a specifier hides how far it climbs. Write the path plainly so the boundary can be read.";

/** `../` repeated, plus the non-canonical `./../` spelling of the same climb. */
const climb = (n) => "../".repeat(n);
const oddClimb = (n) => `./${"../".repeat(n)}`;

/**
 * Matches a specifier whose leading run of `./` and `../` segments climbs at
 * least `depth` levels — the point at which it leaves `lib/domain`.
 *
 * Three spellings have to land in the same net:
 *   `../../x`   canonical
 *   `./../../x` non-canonical; anchoring on `^(?:\.\./)` alone would miss it
 *   `../..`     terminal; the climb ends the specifier, so there is no
 *               trailing slash to match on
 *
 * Terminal climbs that stay inside the core (`..` from one level down resolves
 * to `lib/domain` itself) must remain legal, which is why the count still has
 * to be exact rather than "contains a `..`".
 */
const escapePattern = (depth) =>
  `^(?:(?:\\.\\/)*\\.\\.\\/){${depth - 1}}(?:\\.\\/)*\\.\\.(?:\\/|$)`;

/** A `..` segment preceded by an ordinary segment, e.g. `./sub/../../db`. */
const ODD_RELATIVE_PATTERN = "[^.\\/]\\/\\.\\.(?:\\/|$)";

/** Any `..` segment at all. Used below `MAX_CORE_DEPTH`, where exactness stops. */
const ANY_CLIMB_PATTERN = "(?:^|\\/)\\.\\.(?:\\/|$)";

/** Glob for files exactly `depth` directories below the core. */
export const depthGlob = (depth) =>
  `${CORE_DIR}/${"*/".repeat(depth - 1)}*.${EXT_GLOB}`;

/** Glob for files deeper than `MAX_CORE_DEPTH`. */
export const deepGlob = () =>
  `${CORE_DIR}/${"*/".repeat(MAX_CORE_DEPTH)}**/*.${EXT_GLOB}`;

/** Directory of a fixture at `depth`, relative to the repository root. */
export const fixtureDir = (depth) =>
  depth === 1
    ? CORE_DIR
    : `${CORE_DIR}/__boundary__${"/n".repeat(depth - 2)}`;

/**
 * Every denial the boundary makes, one entry per selector or global.
 *
 * `probes` are the source lines that must be rejected; each must produce
 * exactly one report of `rule`, so the suite can assert on count as well as
 * identity. `depths` are the depths at which the suite plants those probes.
 */
export const denials = [];

// --- imports that leave the core by not being relative at all ----------------
for (const { kind, node } of SPECIFIER_NODES) {
  denials.push({
    id: `nonrelative-${kind}`,
    scope: "shared",
    rule: "no-restricted-syntax",
    selector: `${node}[source.value]:not([source.value=/^\\./])`,
    message: MSG_OUTSIDE,
    depths: SHARED_DEPTHS,
    probes: probesFor(kind, [
      "next/server",
      "react",
      "@supabase/supabase-js",
      "pg",
      "node:fs",
      "node:https",
      "@/lib/db/client",
    ]),
  });
}

// --- imports that leave the core by climbing out of it ------------------------
for (let depth = 1; depth <= MAX_CORE_DEPTH; depth += 1) {
  for (const { kind, node } of SPECIFIER_NODES) {
    denials.push({
      id: `escape-depth-${depth}-${kind}`,
      scope: `depth-${depth}`,
      rule: "no-restricted-syntax",
      selector: `${node}[source.value=/${escapePattern(depth)}/]`,
      message: MSG_ESCAPE,
      depths: [depth],
      probes: probesFor(kind, [
        `${climb(depth)}db/client`,
        `${oddClimb(depth)}db/client`,
        `${climb(depth + 1)}worker/jobs/payroll`,
        // Terminal climb: no trailing slash to anchor on.
        climb(depth).slice(0, -1),
      ]),
    });
  }
}

// --- specifiers that hide their climb ----------------------------------------
for (const { kind, node } of SPECIFIER_NODES) {
  denials.push({
    id: `odd-relative-${kind}`,
    scope: "shared",
    rule: "no-restricted-syntax",
    selector: `${node}[source.value=/${ODD_RELATIVE_PATTERN}/]`,
    message: MSG_ODD_RELATIVE,
    depths: SHARED_DEPTHS,
    probes: probesFor(kind, ["./sub/../../db/client"]),
  });
}

// --- below the exact rules, any climb at all is denied ------------------------
for (const { kind, node } of SPECIFIER_NODES) {
  denials.push({
    id: `deep-escape-${kind}`,
    scope: "deep",
    rule: "no-restricted-syntax",
    selector: `${node}[source.value=/${ANY_CLIMB_PATTERN}/]`,
    message: MSG_ESCAPE,
    depths: [MAX_CORE_DEPTH + 1],
    probes: probesFor(kind, ["../sibling"]),
  });
}

// --- module loading, clock and randomness that imports cannot express ---------
const SYNTAX_DENIALS = [
  {
    id: "dynamic-import",
    selector: "ImportExpression",
    message:
      "AD-2: dynamic import() is a module boundary the static rules cannot see. lib/domain resolves every dependency statically.",
    probes: ['export const probe = import("./thing");'],
  },
  {
    id: "require-call",
    selector: "CallExpression[callee.name='require']",
    message:
      "AD-2: require() is a module boundary the static rules cannot see. lib/domain resolves every dependency statically.",
    probes: ['export const probe = require("node:fs");'],
  },
  {
    id: "create-require",
    selector: "Identifier[name='createRequire']",
    message:
      "AD-2: createRequire re-opens CommonJS loading inside the pure core.",
    probes: ["export const probe = createRequire;"],
  },
  {
    id: "type-import-expression",
    selector: "TSImportType",
    message:
      "AD-2: an import() type still names a module outside lib/domain. The core declares its own types.",
    probes: ['export type Probe = import("next/server").NextRequest;'],
  },
  {
    id: "import-meta",
    selector: "MetaProperty[meta.name='import']",
    message:
      "AD-2: import.meta exposes the module's location and the build environment. lib/domain knows neither.",
    probes: ["export const probe = import.meta.url;"],
  },
  {
    id: "date-now",
    selector: "MemberExpression[object.name='Date'][property.name='now']",
    message:
      "AD-2: lib/domain has no clock. Take the instant as a parameter — the payroll snapshot carries it.",
    probes: ["export const probe = Date.now();"],
  },
  {
    id: "date-construct",
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message:
      "AD-2: lib/domain has no clock. `new Date()` reads the wall clock; take the instant as a parameter.",
    probes: ["export const probe = new Date();"],
  },
  {
    id: "date-call",
    selector: "CallExpression[callee.name='Date']",
    message:
      "AD-2: lib/domain has no clock. `Date()` reads the wall clock however it is spelled.",
    probes: ["export const probe = Date();"],
  },
  {
    id: "math-random",
    selector: "MemberExpression[object.name='Math'][property.name='random']",
    message:
      "AD-2: lib/domain has no randomness. A payroll run must be reproducible from its snapshot.",
    probes: ["export const probe = Math.random();"],
  },
];

for (const entry of SYNTAX_DENIALS) {
  denials.push({
    ...entry,
    scope: "shared",
    rule: "no-restricted-syntax",
    depths: SHARED_DEPTHS,
  });
}

// --- globals that perform I/O, read the clock, or produce randomness ----------
const GLOBAL_DENIALS = [
  ["console", "AD-2: lib/domain does not write output. Return a value; the shell logs it."],
  ["fetch", "AD-2: lib/domain performs no network I/O."],
  ["XMLHttpRequest", "AD-2: lib/domain performs no network I/O."],
  ["WebSocket", "AD-2: lib/domain performs no network I/O."],
  ["EventSource", "AD-2: lib/domain performs no network I/O."],
  ["navigator", "AD-2: lib/domain has no browser environment."],
  ["window", "AD-2: lib/domain has no browser environment."],
  ["document", "AD-2: lib/domain has no browser environment."],
  ["localStorage", "AD-2: lib/domain reads no storage."],
  ["sessionStorage", "AD-2: lib/domain reads no storage."],
  ["indexedDB", "AD-2: lib/domain reads no storage."],
  ["process", "AD-2: lib/domain reads no environment and no process state."],
  ["require", "AD-2: lib/domain resolves every dependency statically."],
  ["module", "AD-2: lib/domain is ESM only; CommonJS globals are an escape hatch."],
  ["exports", "AD-2: lib/domain is ESM only; CommonJS globals are an escape hatch."],
  ["__dirname", "AD-2: lib/domain touches no filesystem."],
  ["__filename", "AD-2: lib/domain touches no filesystem."],
  ["Buffer", "AD-2: lib/domain touches no filesystem and no byte streams."],
  ["crypto", "AD-2: lib/domain has no randomness."],
  ["performance", "AD-2: lib/domain has no clock."],
  ["setTimeout", "AD-2: lib/domain schedules nothing; it is total and synchronous."],
  ["setInterval", "AD-2: lib/domain schedules nothing; it is total and synchronous."],
  ["setImmediate", "AD-2: lib/domain schedules nothing; it is total and synchronous."],
  ["queueMicrotask", "AD-2: lib/domain schedules nothing; it is total and synchronous."],
  // The global object under each of its names. Any one of them reaches every
  // denied global at once, so denying only `globalThis` denies nothing.
  ["globalThis", "AD-2: the global object reaches every denied global at once."],
  ["self", "AD-2: the global object reaches every denied global at once."],
  ["top", "AD-2: the global object reaches every denied global at once."],
  ["parent", "AD-2: the global object reaches every denied global at once."],
  ["frames", "AD-2: the global object reaches every denied global at once."],
  // Runtime code construction defeats every static denial above it.
  ["eval", "AD-2: eval hides every boundary this config enforces."],
  ["Function", "AD-2: the Function constructor builds code the boundary cannot read."],
];

for (const [name, message] of GLOBAL_DENIALS) {
  denials.push({
    id: `global-${name}`,
    scope: "shared",
    rule: "no-restricted-globals",
    name,
    message,
    depths: SHARED_DEPTHS,
    probes: [`export const probe_${name.replace(/\W/g, "_")} = ${name};`],
  });
}

/** Build a probe line of the right declaration form for each specifier. */
function probesFor(kind, specifiers) {
  return specifiers.map((specifier, index) => {
    if (kind === "import") return `import * as p${index} from "${specifier}";`;
    if (kind === "export-all") return `export * as p${index} from "${specifier}";`;
    return `export { a as p${index} } from "${specifier}";`;
  });
}

const shared = denials.filter(
  (d) => d.scope === "shared" && d.rule === "no-restricted-syntax",
);
const globals = denials.filter((d) => d.rule === "no-restricted-globals");

const toSyntaxOption = (d) => ({ selector: d.selector, message: d.message });
const toGlobalOption = (d) => ({ name: d.name, message: d.message });

/**
 * ESLint config blocks implementing the boundary.
 *
 * `no-restricted-globals` sits in its own block over the whole core, so the
 * per-depth blocks — which set only `no-restricted-syntax` — cannot displace
 * it. Each per-depth block repeats the shared selectors, because ESLint
 * replaces rule options rather than merging them.
 */
export const boundaryConfigs = [
  {
    name: "aira/core-purity/globals",
    files: [`${CORE_DIR}/**/*.${EXT_GLOB}`],
    rules: {
      "no-restricted-globals": ["error", ...globals.map(toGlobalOption)],
    },
  },
  ...Array.from({ length: MAX_CORE_DEPTH }, (_, i) => i + 1).map((depth) => ({
    name: `aira/core-purity/depth-${depth}`,
    files: [depthGlob(depth)],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...shared.map(toSyntaxOption),
        ...denials
          .filter((d) => d.scope === `depth-${depth}`)
          .map(toSyntaxOption),
      ],
    },
  })),
  {
    name: "aira/core-purity/deep",
    files: [deepGlob()],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...shared.map(toSyntaxOption),
        ...denials.filter((d) => d.scope === "deep").map(toSyntaxOption),
      ],
    },
  },
];
