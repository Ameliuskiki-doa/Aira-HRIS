/**
 * The half of the DOM harness that runs in Node.
 *
 * `tests/browser/harness.test.tsx` proves the browser can do the three things
 * a simulated DOM cannot — but only while something still runs it. Delete the
 * `chromium` project from the config, or drop it from the `test` script, and
 * that file simply stops being collected: no failure, no missing suite, a green
 * build and a harness that verifies nothing. This suite is what makes that
 * loud, and it deliberately lives in the `unit` project so it fires even under
 * `npm run test:node`.
 *
 * It also pins the other direction: the Node projects must stay pure Node. A
 * `browser` block accidentally added to `unit` would slow every run and hide
 * the very distinction this harness exists to draw.
 *
 * Everything here reads *structure* — parsed config, parsed JSON, parsed YAML.
 * An earlier version of the CI checks used `toContain` against the raw
 * workflow text and was false-green: deleting the entire cache step left the
 * suite passing, because the string it searched for still appeared in a
 * comment three lines further down. A substring of a file is not a fact about
 * what that file does.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load as parseYaml } from "js-yaml";
import { describe, expect, it } from "vitest";

// `.mjs`, not `.mts`: TypeScript resolves the ESM output extension back to
// its `.mts` source, and Vite applies the same mapping. Importing the config
// rather than reading it as text is the point — a project that no longer
// exists is a missing key here, not a regex that stopped matching.
//
// The tradeoff, accepted deliberately: evaluating the config runs `playwright()`
// in this Node process, so `npm run test:node` — the "pure Node, no browser"
// escape hatch — now needs @vitest/browser-playwright on disk. It never
// *launches* a browser (asserted below by the absence of a DOM), but it is no
// longer installable-independent of the browser tooling. Reading the config as
// text would avoid that and cost exactly the false-green this file exists to
// prevent.
import vitestConfig from "../vitest.config.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

/** The shape this suite asserts on. The real type is a deep union of unions. */
type ProjectShape = {
  test?: {
    name?: string;
    include?: string[];
    exclude?: string[];
    testTimeout?: number;
    hookTimeout?: number;
    browser?: {
      enabled?: boolean;
      headless?: boolean;
      provider?: { name?: string; providerFactory?: unknown };
      screenshotFailures?: boolean;
      instances?: Array<{ browser?: string }>;
    };
  };
};

const projects = (vitestConfig.test?.projects ?? []) as ProjectShape[];
const byName = (name: string) => projects.find((p) => p.test?.name === name);

// --- the CI workflow, as steps rather than as text ---------------------------

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
};

const workflow = parseYaml(read(".github/workflows/ci.yml")) as {
  jobs: Record<string, { steps: Step[] }>;
};
const steps: Step[] = Object.values(workflow.jobs).flatMap((job) => job.steps);

/** Every shell line the workflow actually executes, `run: |` blocks included. */
const runLines = steps
  .flatMap((step) => (step.run ?? "").split("\n"))
  .map((line) => line.trim())
  .filter(Boolean);

describe("the Node project it runs in", () => {
  it("has no DOM at all", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
  });

  it("leaves the existing Node projects free of a browser block", () => {
    for (const name of ["unit", "isolation"]) {
      const project = byName(name);
      expect(project, `project ${name} is missing`).toBeDefined();
      expect(project?.test?.browser).toBeUndefined();
    }
  });
});

describe("the browser project is registered", () => {
  const chromium = byName("chromium");

  it("exists in vitest.config.mts", () => {
    expect(chromium, "no project named 'chromium' in vitest.config.mts").toBeDefined();
  });

  it("runs a real headless browser through the playwright provider", () => {
    const browser = chromium?.test?.browser;
    expect(browser?.enabled).toBe(true);
    expect(browser?.headless).toBe(true);
    expect(browser?.screenshotFailures).toBe(false);
    // Vitest 4 rejects `provider: "playwright"` as a string; it must be the
    // object `playwright()` returns. `typeof === "object"` would accept `{}`,
    // so pin the two properties that only the real factory produces.
    expect(browser?.provider?.name).toBe("playwright");
    expect(typeof browser?.provider?.providerFactory).toBe("function");
    expect(browser?.instances?.map((i) => i.browser)).toContain("chromium");
  });

  it("does not inherit the Node projects' five-minute timeouts", () => {
    // A browser that fails to launch must say so in seconds, not minutes.
    expect(chromium?.test?.testTimeout).toBeLessThanOrEqual(60_000);
    expect(chromium?.test?.hookTimeout).toBeLessThanOrEqual(120_000);
  });

  it("collects the smoke suite, and the Node projects cannot", () => {
    expect(chromium?.test?.include).toContain("tests/browser/**/*.test.tsx");
    // Two independent guards, because the extension one is an accident of
    // naming: `unit` matches only `.test.ts`, *and* excludes the directory by
    // path, so a `tests/browser/x.test.ts` added later cannot be run without
    // a DOM.
    expect(byName("unit")?.test?.include).toContain("tests/**/*.test.ts");
    expect(byName("unit")?.test?.include?.some((g) => g.endsWith(".tsx"))).toBe(false);
    expect(byName("unit")?.test?.exclude).toContain("tests/browser/**");
  });
});

describe("the browser project is actually executed", () => {
  const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;

  it("is part of the default `npm test`", () => {
    expect(scripts.test).toContain("--project chromium");
    expect(scripts.test).toContain("--project unit");
  });

  it("still leaves a way to run the Node projects alone", () => {
    expect(scripts["test:node"]).toBe("vitest run --project unit");
    expect(scripts["test:node"]).not.toContain("chromium");
    expect(scripts["test:isolation"]).toContain("--project isolation");
  });

  it("keeps a way to run the browser project alone", () => {
    expect(scripts["test:browser"]).toBe("vitest run --project chromium");
  });
});

describe("CI installs and runs the browser", () => {
  it("runs the full test command, not just the Node projects", () => {
    expect(runLines).toContain("npm test");
  });

  it("caches the Playwright browser directory in a real cache step", () => {
    const cacheSteps = steps.filter((s) => (s.uses ?? "").startsWith("actions/cache"));
    expect(cacheSteps.length, "no actions/cache step in the workflow").toBe(1);
    // The path, from the step's `with:` — not from anywhere in the file that
    // happens to spell the directory.
    expect(String(cacheSteps[0]?.with?.path)).toContain("ms-playwright");
    expect(String(cacheSteps[0]?.with?.key)).toContain("package-lock.json");
  });

  it("installs the headless shell and its system dependencies", () => {
    const installs = runLines.filter((l) => /\bplaywright\s+install\b/.test(l));
    const deps = runLines.filter((l) => /\bplaywright\s+install-deps\b/.test(l));
    expect(installs.length, "nothing downloads a browser").toBeGreaterThanOrEqual(1);
    // System libraries live outside the cached path, so a cache hit still
    // needs them.
    expect(deps.length, "no install-deps step").toBeGreaterThanOrEqual(1);
  });

  it("never downloads a browser other than the headless shell", () => {
    // Stated positively on purpose. A blacklist of one bad spelling missed
    // both `npx playwright install` (which pulls chromium *and* firefox *and*
    // webkit) and `npx playwright install --with-deps`; every download step
    // naming `chromium-headless-shell` admits neither.
    const downloads = runLines.filter(
      (l) => /\bplaywright\s+install\b/.test(l) && !/\bplaywright\s+install-deps\b/.test(l),
    );
    expect(downloads.length).toBeGreaterThanOrEqual(1);
    for (const line of downloads) {
      expect(line, `downloads more than the headless shell: ${line}`).toContain(
        "chromium-headless-shell",
      );
    }
  });

  it("does not pay for the browser before lint and typecheck have passed", () => {
    const indexOf = (pred: (l: string) => boolean) =>
      runLines.findIndex(pred);
    const lint = indexOf((l) => l.includes("npm run lint"));
    const typecheck = indexOf((l) => l.includes("npm run typecheck"));
    const install = indexOf((l) => /\bplaywright\s+install\b/.test(l));
    expect(lint).toBeGreaterThanOrEqual(0);
    expect(typecheck).toBeGreaterThanOrEqual(0);
    expect(install).toBeGreaterThan(lint);
    expect(install).toBeGreaterThan(typecheck);
  });
});
