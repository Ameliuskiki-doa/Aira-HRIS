/**
 * The half of the isolation harness that guards its own execution.
 *
 * `tests/isolation/**` is the blocking gate on the rule the whole product
 * rests on, and it is the one suite `npm test` deliberately does not run. That
 * makes it uniquely easy to lose: unregister the `isolation` project, or drop
 * the step from CI, and the files simply stop being collected — no failure, no
 * missing suite, a green build and a tenant boundary nobody checks. Vitest 4
 * makes that worse, not better: an unmatched `--project` filter is a silent
 * no-op that exits zero with a green report, so the flag self-checks nothing.
 *
 * This suite is what makes that loud, and it lives in the `unit` project on
 * purpose so it fires on every `npm test` and every `npm run test:node`.
 *
 * Everything below reads structure — the parsed config, parsed JSON, parsed
 * YAML — and where it reads text it says so. A substring of a file is not a
 * fact about what that file does.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load as parseYaml } from "js-yaml";
import { describe, expect, it } from "vitest";

import vitestConfig, { REQUIRED_SUITES } from "../vitest.config.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

type ProjectShape = {
  test?: { name?: string; include?: string[]; exclude?: string[]; globalSetup?: string[] };
};

const projects = (vitestConfig.test?.projects ?? []) as ProjectShape[];
const isolation = projects.find((project) => project.test?.name === "isolation");

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  "continue-on-error"?: boolean | string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};
type Job = {
  steps?: Step[];
  services?: Record<string, { image?: string; ports?: string[]; options?: string }>;
  env?: Record<string, string>;
  if?: string;
  "continue-on-error"?: boolean | string;
};

const workflow = parseYaml(read(".github/workflows/ci.yml")) as { jobs: Record<string, Job> };
const jobs = Object.values(workflow.jobs);

/** `steps` is optional in the schema — a `uses:`-only job has none. */
const stepsOf = (job: Job | undefined) => job?.steps ?? [];
const runLinesOf = (job: Job | undefined) =>
  stepsOf(job)
    .flatMap((step) => (step.run ?? "").split("\n"))
    .map((line) => line.trim())
    .filter(Boolean);

/** The job that actually runs the isolation project, found by what it runs. */
const isolationJob = jobs.find((job) =>
  stepsOf(job).some((step) => /--project\s+isolation|npm run test:isolation/.test(step.run ?? "")),
);

/** Every string anywhere in the parsed workflow, keys included. */
function walkStrings(node: unknown, into: string[] = []): string[] {
  if (typeof node === "string") into.push(node);
  else if (Array.isArray(node)) for (const item of node) walkStrings(item, into);
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      into.push(key);
      walkStrings(value, into);
    }
  }
  return into;
}

describe("the isolation project is registered", () => {
  it("exists in vitest.config.mts", () => {
    expect(isolation, "no project named 'isolation' in vitest.config.mts").toBeDefined();
  });

  it("collects tests/isolation/**", () => {
    expect(isolation?.test?.include).toContain("tests/isolation/**/*.test.ts");
  });

  it("migrates and seeds the substrate through a global setup", () => {
    // Without it every suite runs against whatever the last run left behind,
    // and a migration whose effect depends on prior state is untested.
    expect(isolation?.test?.globalSetup).toContain("tests/isolation/globalSetup.ts");
  });
});

describe("the suites cannot vanish quietly", () => {
  // REQUIRED_SUITES throws at config load, so a deleted file fails every
  // Vitest invocation including `npm test`. What this suite adds is the guard
  // on the guard: removing an entry from the list is itself a failure.
  it.each([
    "tests/isolation/catalog-sweep.test.ts",
    "tests/isolation/tenant-purity.test.ts",
    "tests/isolation/signup-rpc.test.ts",
    "tests/isolation/write-surface.test.ts",
    "tests/isolation-registration.test.ts",
    "tests/isolation-guards.test.ts",
  ])("%s is in REQUIRED_SUITES", (suite) => {
    expect(REQUIRED_SUITES).toContain(suite);
  });

  it("keeps the database-free half in the unit project, where `npm test` runs it", () => {
    // Both of these need no container. Parked under `tests/isolation/` they
    // would be gated behind Docker for no reason and would never run in the
    // default gate.
    const unit = projects.find((project) => project.test?.name === "unit");
    expect(unit?.test?.exclude).toContain("tests/isolation/**");
    for (const suite of ["tests/isolation-guards.test.ts", "tests/isolation-registration.test.ts"]) {
      expect(suite.startsWith("tests/isolation/"), `${suite} is inside the isolation project`).toBe(false);
    }
  });
});

describe("the substrate is reachable the same way locally and in CI", () => {
  const packageJson = JSON.parse(read("package.json")) as {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  it("has one command that brings the database up", () => {
    expect(packageJson.scripts["db:isolation:up"]).toContain("scripts/isolation-db.mjs");
    expect(packageJson.scripts["db:isolation:down"]).toContain("scripts/isolation-db.mjs");
  });

  it("runs the isolation project from npm", () => {
    expect(packageJson.scripts["test:isolation"]).toContain("--project isolation");
    expect(packageJson.scripts["test:isolation"]).toContain("db:isolation:up");
  });

  it("pins the Supabase CLI exactly, so local and CI cannot apply migrations differently", () => {
    const pinned = packageJson.devDependencies.supabase;
    expect(pinned, "supabase is not a devDependency").toBeDefined();
    expect(pinned, `supabase is ranged ("${pinned}"), so CI can apply migrations with a different CLI`).toMatch(
      /^\d+\.\d+\.\d+$/,
    );
  });

  it("runs the pinned binary rather than resolving it through npx", () => {
    // `npx supabase` defeats the pin: on a cold node_modules it fetches
    // whatever the registry offers and runs that instead of failing.
    const setup = read("tests/isolation/globalSetup.ts");
    // Source text, deliberately — the claim is about how the process is
    // spawned, and there is no parsed form of that.
    expect(setup).toContain("node_modules/.bin/supabase");
    expect(
      /spawnSync\(\s*(?:process\.platform[^)]*)?["']npx/.test(setup),
      "globalSetup still spawns the CLI through npx",
    ).toBe(false);
  });
});

describe("CI runs the isolation gate", () => {
  it("has a job that runs the isolation project", () => {
    expect(isolationJob, "no CI job runs `vitest --project isolation`").toBeDefined();
  });

  it("gives that job a Postgres 17 service container", () => {
    // Not `supabase start`: twelve containers and ~8.5 GB for facts a bare
    // Postgres proves in 2.22s.
    const services = Object.values(isolationJob?.services ?? {});
    expect(services.length, "the isolation job has no service container").toBeGreaterThan(0);
    expect(services.some((service) => (service.image ?? "").startsWith("postgres:17"))).toBe(true);
  });

  it("points the job at that container with sslmode disabled", () => {
    // Supabase CLI 2.116 negotiates TLS by default and fails against a stock
    // Postgres container before it applies anything, so this is load-bearing.
    const url =
      isolationJob?.env?.ISOLATION_DATABASE_URL ??
      stepsOf(isolationJob).find((step) => step.env?.ISOLATION_DATABASE_URL)?.env
        ?.ISOLATION_DATABASE_URL;
    expect(url, "ISOLATION_DATABASE_URL is not set for the isolation job").toBeDefined();
    expect(url).toContain("sslmode=disable");
  });

  it("brings the database up through the same script a developer uses", () => {
    // Scoped to the isolation job's own steps. Flattened across every job this
    // passes when some *other* job happens to run the command.
    expect(runLinesOf(isolationJob)).toContain("npm run db:isolation:up");
  });

  it("is a gate, not decoration", () => {
    // `continue-on-error: true` leaves every assertion in this file green while
    // the build passes over a failing isolation suite. So does an `if:` that
    // narrows the job to a branch nobody merges from.
    expect(isolationJob?.["continue-on-error"] ?? false, "the isolation job is continue-on-error").toBe(false);
    expect(isolationJob?.if, "the isolation job is conditional").toBeUndefined();
    for (const step of stepsOf(isolationJob)) {
      expect(
        step["continue-on-error"] ?? false,
        `step "${step.name ?? step.run ?? step.uses}" is continue-on-error`,
      ).toBe(false);
      expect(step.if, `step "${step.name ?? step.run ?? step.uses}" is conditional`).toBeUndefined();
    }
  });

  it("runs on both push and pull_request", () => {
    const triggers = (parseYaml(read(".github/workflows/ci.yml")) as { on?: unknown; true?: unknown });
    // YAML 1.1 parses a bare `on:` key as the boolean true. Accept either.
    const on = (triggers.on ?? triggers.true) as Record<string, unknown> | undefined;
    expect(on, "the workflow declares no triggers").toBeDefined();
    expect(Object.keys(on ?? {})).toEqual(expect.arrayContaining(["push", "pull_request"]));
  });

  it("never reaches for service_role, under any spelling", () => {
    // CLAUDE.md rule 5. Walked over every parsed string rather than
    // `not.toContain` on the raw text: the text form passes on
    // `SERVICE_ROLE_KEY`, on `${{ secrets.SERVICE_ROLE }}`, and on any
    // indirection, which is the exact false-green this file's preamble warns
    // about.
    const offenders = walkStrings(workflow).filter((value) => /service.?role/i.test(value));
    expect(offenders, "the CI workflow names service_role").toEqual([]);
  });
});

describe("there are migrations for the runner to apply", () => {
  const migrations = readdirSync(resolve(ROOT, "supabase/migrations")).filter((name) =>
    name.endsWith(".sql"),
  );

  it("holds at least one migration", () => {
    // `supabase migration up` against an empty directory exits zero. The
    // sweep would then run against a schema with no tables and pass by
    // finding nothing — the vacuous case this gate exists to reject.
    expect(migrations.length, "supabase/migrations/ holds no .sql file").toBeGreaterThan(0);
  });

  it.each(migrations)("%s is named the way the CLI requires", (name) => {
    // <14-digit timestamp>_<name>.sql. A file the CLI does not recognise is
    // silently not applied, and the sweep then passes against a schema that
    // is missing whatever that file created.
    expect(name).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
  });

  it.each(migrations)("%s names no service_role", (name) => {
    expect(read(`supabase/migrations/${name}`)).not.toMatch(/service.?role/i);
  });
});
