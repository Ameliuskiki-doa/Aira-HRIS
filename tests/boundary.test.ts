/**
 * Proves the AD-2 core-purity boundary is actually enforced.
 *
 * The thing that can regress is not the config object — it is the `lint`
 * script's argument list and the completeness of the denial set. So this suite
 * writes real fixture files at the depths real domain code occupies, runs the
 * `lint` script CI invokes with no path arguments, and reads what came back.
 *
 * Three properties hold it together:
 *
 *   1. Cases are derived from the config's own denial entries, so a denial
 *      cannot be added without getting a case.
 *   2. The denial set, the probe depths and the extension list are pinned
 *      against a manifest written out independently below, so none of them can
 *      be narrowed without the suite failing.
 *   3. Controls at the same depths, in every declaration form, keep an
 *      over-strict rule from passing as a correct one.
 *
 * Together those mean: remove any single denial — one global, one selector,
 * one path form, one extension, one step of the depth generator — and this
 * suite goes red.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CORE_DIR,
  denials,
  fixtureDir,
  MAX_CORE_DEPTH,
  SHARED_DEPTHS,
  SOURCE_EXTENSIONS,
} from "../eslint.boundary.mjs";

/** Shape of one entry in the boundary config's denial list. */
type Denial = {
  id: string;
  rule: "no-restricted-syntax" | "no-restricted-globals";
  message: string;
  depths: number[];
  probes: string[];
};

/** The config is plain ESM so ESLint can load it; give it a type here. */
const boundaryDenials = denials as Denial[];
const sharedDepths = SHARED_DEPTHS as number[];
const sourceExtensions = SOURCE_EXTENSIONS as string[];

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE_SUFFIX = ".boundary-fixture";
const BOUNDARY_RULES = ["no-restricted-syntax", "no-restricted-globals"];

// --- the manifest ------------------------------------------------------------
// Written out here on purpose, not derived from the config. This is the half
// that fails when a denial, a depth or an extension disappears.

const EXPECTED_MAX_DEPTH = 6;
const EXPECTED_SHARED_DEPTHS = [1, 2, EXPECTED_MAX_DEPTH + 1];
const EXPECTED_EXTENSIONS = ["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"];
const EXPECTED_SPECIFIER_KINDS = ["import", "export-all", "export-named"];
const EXPECTED_SHARED_SYNTAX = [
  "dynamic-import",
  "require-call",
  "create-require",
  "type-import-expression",
  "import-meta",
  "date-now",
  "date-construct",
  "date-call",
  "math-random",
];
const EXPECTED_GLOBALS = [
  "console",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "navigator",
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "process",
  "require",
  "module",
  "exports",
  "__dirname",
  "__filename",
  "Buffer",
  "crypto",
  "performance",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "queueMicrotask",
  "globalThis",
  "self",
  "top",
  "parent",
  "frames",
  "eval",
  "Function",
];

function expectedDenialIds(): string[] {
  const ids: string[] = [];
  for (const kind of EXPECTED_SPECIFIER_KINDS) ids.push(`nonrelative-${kind}`);
  for (let depth = 1; depth <= EXPECTED_MAX_DEPTH; depth += 1) {
    for (const kind of EXPECTED_SPECIFIER_KINDS) {
      ids.push(`escape-depth-${depth}-${kind}`);
    }
  }
  for (const kind of EXPECTED_SPECIFIER_KINDS) ids.push(`odd-relative-${kind}`);
  for (const kind of EXPECTED_SPECIFIER_KINDS) ids.push(`deep-escape-${kind}`);
  ids.push(...EXPECTED_SHARED_SYNTAX);
  for (const name of EXPECTED_GLOBALS) ids.push(`global-${name}`);
  return ids;
}

// --- fixtures ----------------------------------------------------------------

type Fixture = { label: string; relPath: string; source: string };

const fixturePath = (depth: number, name: string, ext = "ts") =>
  `${fixtureDir(depth)}/${name}${FIXTURE_SUFFIX}.${ext}`;

/** One fixture per (denial, depth) pair the config declares. */
const denialFixtures = boundaryDenials.flatMap((denial) =>
  denial.depths.map((depth) => ({
    denial,
    depth,
    label: `${denial.id} @ depth ${depth}`,
    relPath: fixturePath(depth, `${denial.id}-d${depth}`),
    source: denial.probes.join("\n"),
  })),
);

/**
 * One fixture per source extension. A `.mjs` module dropped from the glob
 * lints entirely clean, and nothing else in the suite would notice.
 */
const extensionFixtures: Fixture[] = sourceExtensions.map((ext) => {
  const commonjs = ext === "cjs" || ext === "cts";
  return {
    label: `extension .${ext}`,
    relPath: fixturePath(1, `extension-${ext}`, ext),
    source: commonjs
      ? ['const probe = require("next/server");', "module.exports = probe;"].join("\n")
      : ['import * as outside from "next/server";', "export const probe = [outside, console];"].join("\n"),
  };
});

/**
 * Intra-core code that must keep linting clean. Without these an over-strict
 * rule — one denying every `..` regardless of depth, or every export form —
 * would look correct. `..` and `./..` from one level down resolve to
 * `lib/domain` itself and are legitimate.
 */
const controls: Fixture[] = [
  {
    label: "control: depth 1, every declaration form",
    relPath: fixturePath(1, "control-depth-1"),
    source: [
      'import * as sibling from "./sibling";',
      'export * from "./sibling";',
      'export { x } from "./sibling";',
      'export * as ns from "./sibling";',
      "export const rounded = Math.round(1.5);",
      'export const parsed = new Date("2026-01-01");',
      "export const used = [sibling, rounded, parsed];",
    ].join("\n"),
  },
  {
    label: "control: depth 2, climbs that stay inside the core",
    relPath: fixturePath(2, "control-depth-2"),
    source: [
      'import * as up from "../sibling";',
      'import * as down from "./child";',
      'import * as core from "..";',
      'import * as coreOdd from "./..";',
      'export * from "../sibling";',
      'export { x } from "../sibling";',
      "export const used = [up, down, core, coreOdd];",
    ].join("\n"),
  },
  {
    label: "control: depth 3",
    relPath: fixturePath(3, "control-depth-3"),
    source: [
      'import * as up from "../../sibling";',
      'import * as peer from "../peer";',
      'import * as core from "../..";',
      'export * from "../../sibling";',
      "export const used = [up, peer, core];",
    ].join("\n"),
  },
  {
    label: `control: depth ${MAX_CORE_DEPTH}`,
    relPath: fixturePath(MAX_CORE_DEPTH, "control-depth-max"),
    source: [
      'import * as up from "../peer";',
      'export { x } from "../peer";',
      "export const used = [up];",
    ].join("\n"),
  },
  {
    label: "control: below the exact rules",
    relPath: fixturePath(MAX_CORE_DEPTH + 1, "control-depth-deep"),
    source: [
      'import * as down from "./child";',
      'export * from "./child";',
      "export const used = [down];",
    ].join("\n"),
  },
];

const allFixtures: Fixture[] = [...denialFixtures, ...extensionFixtures, ...controls];

function writeFixtures() {
  for (const fixture of allFixtures) {
    const absolute = join(ROOT, fixture.relPath);
    if (existsSync(absolute)) {
      throw new Error(
        `Refusing to overwrite an existing file with a fixture: ${fixture.relPath}`,
      );
    }
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, `${fixture.source}\n`, "utf8");
  }
}

function removeFixtures() {
  rmSync(join(ROOT, CORE_DIR, "__boundary__"), { recursive: true, force: true });
  for (const fixture of allFixtures) {
    rmSync(join(ROOT, fixture.relPath), { force: true });
  }
}

// --- the lint run ------------------------------------------------------------

type LintMessage = {
  ruleId: string | null;
  message: string;
  line: number;
  severity: number;
  fatal?: boolean;
};
type LintResult = { filePath: string; messages: LintMessage[]; errorCount: number };

let results = new Map<string, LintResult>();
let resultsWithoutFlag = new Map<string, LintResult>();

/**
 * Runs the `lint` script exactly as CI does — no path arguments, so narrowing
 * its argument list shows up here as fixtures that were never linted.
 */
function runLintEntryPoint(lintFixtures: boolean): LintResult[] {
  const outFile = join(
    tmpdir(),
    `aira-boundary-${process.pid}-${Date.now()}-${lintFixtures ? "on" : "off"}.json`,
  );
  const env = { ...process.env };
  if (lintFixtures) env.AIRA_BOUNDARY_FIXTURES = "1";
  else delete env.AIRA_BOUNDARY_FIXTURES;

  const run = spawnSync(
    "npm",
    ["run", "--silent", "lint", "--", "--format", "json", "--output-file", outFile],
    {
      cwd: ROOT,
      encoding: "utf8",
      env,
      // npm is a shell script on Windows; spawn cannot exec it directly.
      shell: process.platform === "win32",
    },
  );
  if (run.error) {
    throw new Error(`Could not run the lint script: ${run.error.message}`);
  }
  if (run.signal) {
    throw new Error(`The lint script was killed by signal ${run.signal}.`);
  }
  if (!existsSync(outFile)) {
    throw new Error(
      `The lint script produced no report.\nstatus=${run.status}\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
    );
  }
  const parsed = JSON.parse(readFileSync(outFile, "utf8")) as LintResult[];
  rmSync(outFile, { force: true });
  return parsed;
}

function messagesFor(relPath: string): LintMessage[] {
  const result = results.get(resolve(ROOT, relPath));
  if (!result) {
    throw new Error(
      `The lint script did not lint ${relPath}. The boundary is only enforced ` +
        `over files the entry point actually reaches — check the "lint" script's ` +
        `arguments and the extension glob.`,
    );
  }
  return result.messages;
}

beforeAll(() => {
  removeFixtures();
  writeFixtures();
  try {
    results = new Map(runLintEntryPoint(true).map((r) => [r.filePath, r]));
    resultsWithoutFlag = new Map(runLintEntryPoint(false).map((r) => [r.filePath, r]));
  } finally {
    removeFixtures();
  }
}, 600_000);

afterAll(() => {
  removeFixtures();
});

// --- assertions --------------------------------------------------------------

describe("AD-2 boundary — the denial set", () => {
  it("matches the manifest exactly, so no denial can be dropped silently", () => {
    expect([...boundaryDenials.map((d: Denial) => d.id)].sort()).toEqual(
      expectedDenialIds().sort(),
    );
  });

  it("generates an exact escape rule for every depth up to the pinned maximum", () => {
    expect(MAX_CORE_DEPTH).toBe(EXPECTED_MAX_DEPTH);
  });

  it("probes whole-core denials at every pinned depth, not only the top level", () => {
    expect(sharedDepths).toEqual(EXPECTED_SHARED_DEPTHS);
  });

  it("covers every JavaScript and TypeScript extension", () => {
    expect(sourceExtensions).toEqual(EXPECTED_EXTENSIONS);
  });

  it("gives every denial at least one probe", () => {
    for (const denial of boundaryDenials) {
      expect(denial.probes.length, `denial ${denial.id} has no probe`).toBeGreaterThan(0);
      expect(denial.depths.length, `denial ${denial.id} has no depth`).toBeGreaterThan(0);
    }
  });
});

describe("AD-2 boundary — the lint entry point", () => {
  it("reaches every fixture under lib/domain", () => {
    for (const fixture of allFixtures) {
      expect(() => messagesFor(fixture.relPath), fixture.relPath).not.toThrow();
    }
  });

  it("reports errors on the fixtures, not merely somewhere in the tree", () => {
    const scopedErrors = denialFixtures.reduce((total, fixture) => {
      const result = results.get(resolve(ROOT, fixture.relPath));
      return total + (result?.errorCount ?? 0);
    }, 0);
    const expectedReports = denialFixtures.reduce(
      (total, fixture) => total + fixture.denial.probes.length,
      0,
    );
    expect(scopedErrors).toBeGreaterThanOrEqual(expectedReports);
  });

  it("ignores the fixtures when the suite is not running, so a killed run cannot break lint", () => {
    const leaked = allFixtures
      .map((f) => f.relPath)
      .filter((relPath) => resultsWithoutFlag.has(resolve(ROOT, relPath)));
    expect(
      leaked,
      "fixture paths must be ignored unless AIRA_BOUNDARY_FIXTURES is set",
    ).toEqual([]);
  });
});

describe.each(denialFixtures.map((f) => [f.label, f] as const))(
  "AD-2 boundary — %s",
  (_label, fixture) => {
    it("rejects every probe, on the rule and with the message it declares", () => {
      const { denial } = fixture;
      const messages = messagesFor(fixture.relPath);
      const matched = messages.filter(
        (m) => m.ruleId === denial.rule && m.message.includes(denial.message),
      );
      const reportedLines = [...new Set(matched.map((m) => m.line))].sort((a, b) => a - b);
      const probeLines = denial.probes.map((_probe, index) => index + 1);
      expect(
        reportedLines,
        `probes not rejected:\n${denial.probes
          .map((p, i) => `  line ${i + 1}: ${p}`)
          .join("\n")}\nreported:\n${messages
          .map((m) => `  line ${m.line}: ${m.ruleId} ${m.message}`)
          .join("\n")}`,
      ).toEqual(probeLines);
    });
  },
);

describe.each(extensionFixtures.map((f) => [f.label, f] as const))(
  "AD-2 boundary — %s",
  (_label, fixture) => {
    it("is linted and rejected like any other core module", () => {
      const messages = messagesFor(fixture.relPath);
      expect(
        messages.filter((m) => m.fatal),
        `the fixture did not parse:\n${fixture.source}`,
      ).toEqual([]);
      const offending = messages.filter(
        (m) => m.ruleId !== null && BOUNDARY_RULES.includes(m.ruleId),
      );
      expect(
        offending.length,
        `no boundary rule fired on this extension:\n${fixture.source}\nreported:\n${messages
          .map((m) => `  line ${m.line}: ${m.ruleId} ${m.message}`)
          .join("\n")}`,
      ).toBeGreaterThan(0);
    });
  },
);

describe.each(controls.map((c) => [c.label, c] as const))(
  "AD-2 boundary — %s",
  (_label, control) => {
    it("stays clean, so the rule is not over-strict", () => {
      const offending = messagesFor(control.relPath).filter(
        (m) => m.ruleId !== null && BOUNDARY_RULES.includes(m.ruleId),
      );
      expect(
        offending.map((m) => `line ${m.line}: ${m.ruleId} ${m.message}`),
        `legitimate intra-core code was rejected:\n${control.source}`,
      ).toEqual([]);
    });
  },
);
