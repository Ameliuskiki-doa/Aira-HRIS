/**
 * CLAUDE.md rule 5, made into something that can fail.
 *
 * The rule is: **no client in this repository may be constructed from an
 * elevated Supabase key.** Until this suite existed nothing enforced it —
 * recorded in deferred-work as the invariant that got no machinery while core
 * purity got sixty denials, and it is the one whose violation is a
 * cross-tenant leak rather than a style problem.
 *
 * The property is asserted three ways, because any one of them alone is
 * escapable:
 *
 *   1. **Behaviourally.** Put an elevated key in the environment and every
 *      client factory throws. Not "the code does not do it" — it cannot.
 *   2. **Structurally.** No factory declares a parameter, so there is no way
 *      to hand one a credential the vetted reader did not produce.
 *   3. **By reach.** Nothing outside `lib/supabase/` imports the Supabase
 *      packages for their values, so there is no second place a client could
 *      be built at all.
 *
 * The key check is an allowlist: a key must prove it is publishable. A
 * denylist would have to name every elevated format Supabase might mint next,
 * and would be wrong the day one is added.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * `cookies()` outside a request throws, and the server and route factories
 * both call it. Stubbed so the *credential* is what decides the outcome.
 */
const requestApi = vi.hoisted(() => ({ cookiesCalled: 0 }));

vi.mock("next/headers", () => ({
  cookies: async () => {
    requestApi.cookiesCalled += 1;
    return { getAll: () => [], set: () => {} };
  },
}));

const base64url = (value: string) =>
  Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** A legacy Supabase key: an unsigned JWT whose payload names a role. */
const legacyKey = (role: string) =>
  `${base64url('{"alg":"HS256","typ":"JWT"}')}.${base64url(
    JSON.stringify({ iss: "supabase", role, iat: 1, exp: 2 }),
  )}.signature-not-checked-here`;

const PUBLISHABLE_SHAPES: ReadonlyArray<readonly [string, string]> = [
  ["a current publishable key", "sb_publishable_AbCdEf0123456789"],
  ["a legacy anon JWT", legacyKey("anon")],
];

/**
 * Every shape that must be refused. The second entry is the one this whole
 * file exists for; the others are here because a rule that only recognises the
 * key it was written against is a rule that expires.
 */
const REFUSED_SHAPES: ReadonlyArray<readonly [string, string]> = [
  ["a current secret key", "sb_secret_AbCdEf0123456789"],
  ["a legacy elevated JWT", legacyKey(["service", "role"].join("_"))],
  ["a legacy JWT with some other role", legacyKey("authenticated")],
  ["an opaque string that proves nothing", "not-a-key-at-all"],
  ["a JWT whose payload is not JSON", "aGVhZGVy.bm90LWpzb24.sig"],
  ["a JWT carrying no role at all", `${base64url("{}")}.${base64url('{"iss":"x"}')}.sig`],
];

const URL_VAR = "NEXT_PUBLIC_SUPABASE_URL";
const KEY_VAR = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";
const PROJECT_URL = "https://project.supabase.co";

/**
 * Loads the client modules against a given environment.
 *
 * `resetModules` first: the key is read into a module-scope map so that Next
 * can inline the `NEXT_PUBLIC_` reads at build time, which means a stubbed
 * value only takes effect on a fresh import.
 */
async function loadWith(key: string, url: string = PROJECT_URL) {
  vi.resetModules();
  vi.stubEnv(URL_VAR, url);
  vi.stubEnv(KEY_VAR, key);
  const [browser, server, route, proxy, keys] = await Promise.all([
    import("@/lib/supabase/client"),
    import("@/lib/supabase/server"),
    import("@/lib/supabase/route"),
    import("@/lib/supabase/proxy"),
    import("@/lib/supabase/keys"),
  ]);
  return {
    keys,
    factories: [
      ["browser", browser.createBrowserSupabaseClient],
      ["server", server.createServerSupabaseClient],
      ["route handler", route.createRouteSupabaseClient],
      // Takes a NextRequest, which is why the arity table below has an entry
      // for it. It still builds a client, so it is held to the same refusal.
      ["proxy", () => proxy.updateSession(new NextRequest("http://localhost:3000/"))],
    ] as ReadonlyArray<readonly [string, () => unknown]>,
  };
}

/**
 * Every exported function in `lib/supabase/` whose name says it builds or uses
 * a client, discovered from disk.
 *
 * Discovery rather than a list, for the same reason the isolation sweep reads
 * the catalog: the failure being defended against is a fourth factory added
 * later and simply not tested, which a hand-maintained list cannot notice.
 */
const CLIENT_MODULE_DIR = join("lib", "supabase");
const EXPECTED_FACTORIES = [
  "createBrowserSupabaseClient",
  "createServerSupabaseClient",
  "createRouteSupabaseClient",
  "updateSession",
] as const;

/**
 * Arity, with a reason for every non-zero entry.
 *
 * The property is "no factory takes a *credential*", and zero parameters is the
 * strongest way to say it. `updateSession` cannot be nullary — middleware is
 * handed the request — so it is listed with what its parameter is, and the
 * refusal test above covers it behaviourally instead.
 */
const FACTORY_ARITY: Record<string, { arity: number; because?: string }> = {
  browser: { arity: 0 },
  server: { arity: 0 },
  "route handler": { arity: 0 },
  proxy: {
    arity: 1,
    because:
      "the one parameter is the NextRequest whose cookies carry the session; " +
      "there is no credential parameter, and the elevated-key refusal above " +
      "covers this factory behaviourally like the other three",
  },
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a key has to prove it is publishable", () => {
  it.each(PUBLISHABLE_SHAPES)("accepts %s", async (_label, key) => {
    const { keys } = await loadWith(key);
    expect(keys.isPublishableKey(key)).toBe(true);
    expect(keys.supabasePublishableKey()).toBe(key);
  });

  it.each(REFUSED_SHAPES)("refuses %s", async (_label, key) => {
    const { keys } = await loadWith(key);
    expect(keys.isPublishableKey(key)).toBe(false);
    expect(() => keys.supabasePublishableKey()).toThrow(/publishable/i);
  });

  it("reaches for the request before it reads the environment", async () => {
    // Ordering, pinned as behaviour, because getting it backwards breaks the
    // build in CI and nowhere else.
    //
    // `cookies()` is a request-time API: during a prerender it throws a signal
    // Next catches to mark the route dynamic. Read `process.env` first and the
    // prerender hits "NEXT_PUBLIC_SUPABASE_URL is not set" instead — a real
    // error, on a route that was never going to be static. This happened: the
    // reads were hoisted above `cookies()` to make the key guard easier to
    // test, and `npm run build` without a `.env.local` failed on the first
    // `(app)` page. Asserted by observing that the request was consulted even
    // though the environment was missing.
    const { factories } = await loadWith("", "");
    for (const [name, factory] of factories) {
      if (name === "browser" || name === "proxy") continue; // no cookies() to call
      const before = requestApi.cookiesCalled;
      await expect((async () => factory())()).rejects.toThrow();
      expect(
        requestApi.cookiesCalled,
        `the ${name} client read the environment before touching the request`,
      ).toBeGreaterThan(before);
    }
  });

  it("says which variable is wrong when it is simply missing", async () => {
    const { keys } = await loadWith("");
    expect(() => keys.supabasePublishableKey()).toThrow(new RegExp(KEY_VAR));
    expect(() => keys.supabaseUrl()).not.toThrow();
  });
});

describe("no client can be built from an elevated key", () => {
  // The property, stated over every factory rather than over the one that
  // happened to be written first. A fourth factory added later without going
  // through `keys.ts` fails the reach test below instead.
  for (const [label, key] of REFUSED_SHAPES) {
    it(`refuses to build any client from ${label}`, async () => {
      const { factories } = await loadWith(key);
      expect(factories).toHaveLength(EXPECTED_FACTORIES.length);
      for (const [name, factory] of factories) {
        await expect(
          (async () => factory())(),
          `the ${name} client was built from ${label}`,
        ).rejects.toThrow(/publishable/i);
      }
    });
  }

  it("builds every one of them from a publishable key", async () => {
    // The positive control. A guard that refuses everything is not a stricter
    // guard, it is a broken application.
    //
    // `fetch` is stubbed so a passing test cannot depend on reaching the
    // network: `updateSession` calls `getUser()`, which for a request carrying
    // no session short-circuits before any request -- but "should not" and
    // "cannot" are different, and a suite that quietly talks to the internet
    // is a suite that fails on a train.
    vi.stubGlobal("fetch", async () => {
      throw new Error("the client suite must not reach the network");
    });
    try {
      const { factories } = await loadWith(PUBLISHABLE_SHAPES[0][1]);
      for (const [name, factory] of factories) {
        const produced = (await factory()) as { auth?: unknown };
        expect(produced, `the ${name} factory produced nothing`).toBeTruthy();
        // The three that hand back a client hand back an auth surface. The
        // proxy hands back a response, which is asserted in
        // tests/session-refresh.test.ts against a real expired session.
        if (name !== "proxy") {
          expect(produced.auth, `the ${name} client carries no auth surface`).toBeTruthy();
        }
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("gives no factory a parameter to smuggle a credential through", async () => {
    // Structural half. Even with the guard removed there would be nothing to
    // pass: a caller cannot supply a key these functions do not ask for.
    vi.resetModules();
    vi.stubEnv(URL_VAR, PROJECT_URL);
    vi.stubEnv(KEY_VAR, PUBLISHABLE_SHAPES[0][1]);
    const modules = {
      browser: (await import("@/lib/supabase/client")).createBrowserSupabaseClient,
      server: (await import("@/lib/supabase/server")).createServerSupabaseClient,
      "route handler": (await import("@/lib/supabase/route")).createRouteSupabaseClient,
      proxy: (await import("@/lib/supabase/proxy")).updateSession,
    };

    for (const [name, factory] of Object.entries(modules)) {
      const expected = FACTORY_ARITY[name];
      expect(expected, `${name} has no declared arity`).toBeDefined();
      expect(
        factory.length,
        `the ${name} factory accepts ${factory.length} argument(s), not ${expected.arity}`,
      ).toBe(expected.arity);
    }
  });

  it.each(
    Object.entries(FACTORY_ARITY).filter(([, entry]) => entry.arity > 0),
  )("%s says why it is not nullary", (_name, entry) => {
    // A factory that takes an argument without saying what it is is how the
    // "no parameter to smuggle a credential through" rule quietly stops
    // meaning anything. The length floor is crude on purpose.
    expect(entry.because?.trim().length ?? 0).toBeGreaterThan(80);
  });

  it("knows about every factory in the directory", () => {
    // The hole the arity table alone would leave: a fifth factory added to
    // lib/supabase/ and never handed to `loadWith` would be untested, and
    // nothing above would notice. Discovered from disk instead.
    const exported = readdirSync(resolve(ROOT, CLIENT_MODULE_DIR))
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts"))
      .flatMap((file) =>
        Array.from(
          read(join(CLIENT_MODULE_DIR, file)).matchAll(
            /export (?:async )?function (\w+)/g,
          ),
          (match) => match[1],
        ),
      )
      // `keys.ts` exports readers and predicates, not clients. They are
      // asserted directly in the first describe block.
      .filter((name) => /^(create\w*SupabaseClient|updateSession)$/.test(name));

    expect(exported.sort()).toEqual([...EXPECTED_FACTORIES].sort());
  });
});

/* ── reach ─────────────────────────────────────────────────────────────────── */

const WALK_ROOTS = ["app", "lib", "components", "worker"];
const WALK_SKIP = new Set(["node_modules", ".next", ".git", "__boundary__"]);
const SOURCE_FILE = /\.(?:tsx?|jsx?|mts|cts|mjs|cjs)$/;

/**
 * The boundary suite's fixtures, which exist only while it is running.
 *
 * Not hypothetical: `tests/boundary.test.ts` writes `lib/domain/*.boundary-
 * fixture.ts` files whose probe lines include `import * as p0 from
 * "@supabase/supabase-js"`, deliberately, to prove the purity rule rejects
 * them. Vitest runs files in parallel, so this sweep saw them and reported
 * `lib/domain` as importing Supabase outside `lib/supabase/` -- a failure that
 * appeared in a full run and vanished when this file was run alone. The same
 * paths are ignored by `eslint.config.mjs` for the same reason.
 */
const TRANSIENT_FIXTURE = /\.boundary-fixture\./;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (WALK_SKIP.has(entry.name)) continue;
    if (TRANSIENT_FIXTURE.test(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_FILE.test(entry.name)) out.push(relative(ROOT, full));
  }
  return out;
}

/**
 * Root-level source files, which the directory walk cannot see.
 *
 * `proxy.ts` -- Next 16's replacement for the deprecated `middleware.ts` --
 * has to live at the repository root, and it runs on every request. A sweep
 * that only walks directories would leave the one file on the hottest path
 * unswept.
 */
const ROOT_FILES = ["proxy.ts", "next.config.ts", "instrumentation.ts"].filter(
  (file) => existsSync(resolve(ROOT, file)),
);

const sourceFiles = [
  ...WALK_ROOTS.flatMap((dir) => walk(resolve(ROOT, dir))),
  ...ROOT_FILES,
];
const read = (file: string) => readFileSync(resolve(ROOT, file), "utf8");

describe("the elevated key is unreachable from the source tree", () => {
  it("walked a tree with something in it", () => {
    // A sweep over an empty list passes every assertion inside it.
    expect(sourceFiles.length).toBeGreaterThan(20);
    expect(sourceFiles).toContain(join("lib", "supabase", "keys.ts"));
    expect(sourceFiles).toContain(join("app", "api", "companies", "route.ts"));
    // The request path that runs before every render, and the one file the
    // directory walk structurally cannot reach.
    expect(sourceFiles, "proxy.ts is not swept").toContain("proxy.ts");
  });

  it("never names it, under any spelling", () => {
    // The acceptance criterion, as a test rather than as a command someone
    // remembers to run. Matched loosely (`service-role`, `SERVICE_ROLE`) so an
    // alternative spelling is not a way through.
    const offenders = sourceFiles.filter((file) => /service.?role/i.test(read(file)));
    expect(offenders, "the source tree names the elevated role").toEqual([]);
  });

  it("keeps the prohibition itself somewhere a developer will read it", () => {
    // The rule has to be stated *somewhere*, or the test above is satisfied by
    // a repository that simply forgot the rule existed.
    expect(read(".env.example")).toMatch(/service_role/);
  });

  it("imports the Supabase packages for their values in one directory only", () => {
    // The reach half. A client built anywhere else would not go through
    // `keys.ts`, so the guard would be true and irrelevant. Type-only imports
    // are excluded: `import type { SupabaseClient }` constructs nothing.
    const valueImport = /^\s*import\s+(?!type\s)[^;]*?from\s+["']@supabase\/[^"']+["']/m;
    const importers = sourceFiles.filter((file) => valueImport.test(read(file)));
    expect(importers.length, "nothing imports @supabase/* at all").toBeGreaterThan(0);
    for (const file of importers) {
      expect(
        file.startsWith(join("lib", "supabase") + "/"),
        `${file} builds against @supabase/* outside lib/supabase/, bypassing the key guard`,
      ).toBe(true);
    }
  });
});
