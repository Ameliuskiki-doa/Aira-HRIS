/**
 * The rule a third route will have to satisfy.
 *
 * **Any route handler that changes which tenant the caller belongs to must
 * reissue the token before returning.**
 *
 * The tenant a session acts in lives in the ACCESS TOKEN, not in the database.
 * `memberships` decides what the token WILL say the next time one is issued;
 * the token in the caller's cookie decides what every RLS policy sees right
 * now. So a mutation that changes membership and returns without reissuing
 * leaves the session in a state the database no longer agrees with, for as
 * long as the 15-minute TTL (AD-9) lasts, and every tenant-scoped query in
 * that window returns nothing.
 *
 * This is not hypothetical and it is not a list of two routes. It shipped:
 * `/api/companies` creates the caller's founding membership -- taking them
 * from no tenant to one, the largest change of this kind there is -- and did
 * not reissue, while `/api/memberships/switch`, which only moves
 * `last_active_at`, did. The defect survived an end-to-end signup against a
 * real project because three independently correct behaviours hid it: the
 * confirmation token is legitimately claimless (the membership does not exist
 * until `/company/new` runs), `UserBlock` omits a null role rather than
 * inventing one, and `currentActiveCompany()` falls back to organization
 * ownership so the company name renders anyway. The screen looked right while
 * the session did not know its own tenant.
 *
 * ── WHAT THIS TEST DOES NOT PROVE ──────────────────────────────────────────
 *
 * It is STRUCTURAL, not behavioural, and that is worth being blunt about
 * rather than letting a green tick imply more than it earns. It reads source
 * text: which route handlers can reach a membership write, whether those files
 * call `refreshSession`, and whether they bind and branch on its error. It
 * never observes a token being reissued.
 *
 * So a handler that calls `refreshSession` BEFORE the write instead of after
 * satisfies this file -- and that is not a hypothetical gap, it is the one
 * mistake that would produce the same empty claims as no reissue at all. The
 * ORDER is asserted behaviourally instead, against a mocked client, in
 * `tests/signup-boundary.test.ts` and `tests/switch-company-boundary.test.ts`;
 * both were run against a route with the call hoisted above the write and both
 * went red. What no layer here can prove is that GoTrue actually mints a token
 * carrying the new claim.
 *
 * That gap is not laziness, it is where the three existing layers stop:
 *
 *   - the isolation suite talks to Postgres directly and issues no tokens at
 *     all -- it calls the RPCs with a `set_config`'d claim, so there is
 *     nothing there that could notice a missing reissue;
 *   - the browser suite renders the shell from fixtures and never has a
 *     session;
 *   - the boundary suites mock the Supabase client, so `refreshSession` is
 *     whatever the mock says it is.
 *
 * Only a real GoTrue could close it. What the boundary suites CAN do is assert
 * ordering and failure handling against the mock, and they do:
 * `tests/signup-boundary.test.ts` and `tests/switch-company-boundary.test.ts`
 * each check that the write happens, then the reissue, then the response, and
 * that a failed reissue is reported as a failed mutation. This file is the
 * part neither of them can express: that a route added LATER is covered at
 * all.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (relative: string) => readFileSync(resolve(ROOT, relative), "utf8");

/* ── what counts as changing a membership ──────────────────────────────────── */

/**
 * The SQL surfaces that can change which tenant a caller belongs to.
 *
 * Named rather than inferred, because the thing being detected is a *write* to
 * one table and there are only ever a handful of ways to reach it. Each is
 * checked below against the migrations, so a rename that makes a marker stop
 * matching fails here instead of silently switching the rule off.
 *
 * `register_company` is on the list because it calls
 * `create_founding_membership` -- the RPC that changes a caller from belonging
 * to no tenant to belonging to one. That indirection is exactly what the rule
 * has to see through: the route imports `registerCompany`, which calls an RPC,
 * which calls another function, which writes the table.
 */
const MEMBERSHIP_WRITE_MARKERS = [
  "memberships",
  "register_company",
  "switch_company",
  "create_founding_membership",
] as const;

/** The call that reissues. Only a route handler is allowed to make it. */
const REISSUE_CALL = "refreshSession(";

/* ── the module graph ──────────────────────────────────────────────────────── */

const listFiles = (directory: string): string[] => {
  const entries = readdirSync(resolve(ROOT, directory), { withFileTypes: true });
  return entries.flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(`${directory}/${entry.name}`)
      : [`${directory}/${entry.name}`],
  );
};

/** Every mutation entry point in the application. */
const routeHandlers = listFiles("app/api").filter((file) => file.endsWith("/route.ts"));

/**
 * Imports, resolved through the `@/` alias the whole repo uses, per SYMBOL.
 *
 * Per symbol and not per module, and the first version of this file got that
 * wrong in a way worth keeping the scar for. Module granularity asked "does
 * anything this route can reach mention a membership surface", and
 * `/api/auth/signin` imports `getOwnedCompany` from `lib/db/companies` --
 * a module that also contains `registerCompany`. Sign-in was flagged as
 * changing membership, which would have forced a pointless reissue into an
 * auth route that already mints a fresh token by signing in.
 *
 * So the walk is over bindings: which exported function did the route actually
 * import, and can THAT function's body reach a membership write. Only
 * first-party modules are followed; a package import cannot reach our SQL.
 */
type Import = { readonly module: string; readonly symbols: string[] };

function importsOf(source: string): Import[] {
  const imports: Import[] = [];
  for (const match of source.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+"@\/([^"]+)"/g)) {
    const symbols = match[2]
      .split(",")
      .map((name) => name.replace(/^\s*type\s+/, "").split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    imports.push({ module: match[3], symbols });
  }
  return imports;
}

/** The extensions a first-party import can resolve to, in the order tried. */
const CANDIDATE_SUFFIXES = [".ts", ".tsx", "/index.ts", "/index.tsx"];

const moduleCache = new Map<string, string | null>();

function readModule(specifier: string): string | null {
  if (moduleCache.has(specifier)) return moduleCache.get(specifier)!;
  let source: string | null = null;
  for (const suffix of CANDIDATE_SUFFIXES) {
    try {
      source = read(`${specifier}${suffix}`);
      break;
    } catch {
      // Try the next shape.
    }
  }
  moduleCache.set(specifier, source);
  return source;
}

/**
 * Comments stripped, because a marker in prose is not a call.
 *
 * Every file in this repository carries long explanatory comments, and several
 * discuss `memberships` at length without touching it -- this one included.
 * Matching raw text would flag every route that mentions a tenant, and a rule
 * that flags everything discriminates nothing.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * A module cut into top-level declarations, keyed by the name each declares.
 *
 * Crude on purpose: a line starting at column zero with `function`, `const`,
 * `class` or `type` (optionally exported) opens a block, and the block runs
 * until the next one. That is enough to attribute `client.rpc("register_company")`
 * to `registerCompany` and not to `getOwnedCompany`, which is the whole job.
 * Non-exported declarations are sliced too -- `callSwitchCompany` in
 * `lib/db/memberships.ts` is where the RPC name actually appears, and the two
 * exported wrappers only reach it by calling it.
 */
function declarationsOf(source: string): Map<string, string> {
  const code = stripComments(source);
  const opener = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|class|type)\s+([A-Za-z0-9_$]+)/gm;
  const starts: Array<{ name: string; index: number }> = [];
  for (const match of code.matchAll(opener)) {
    starts.push({ name: match[1], index: match.index ?? 0 });
  }
  const blocks = new Map<string, string>();
  starts.forEach((start, position) => {
    const end = position + 1 < starts.length ? starts[position + 1].index : code.length;
    // A name can legitimately appear twice (an overload, a type beside a
    // const). Concatenate rather than overwrite, so nothing is lost.
    blocks.set(start.name, (blocks.get(start.name) ?? "") + code.slice(start.index, end));
  });
  return blocks;
}

/** Every identifier a block mentions. Over-approximates, which is the safe way. */
const identifiersIn = (block: string) => new Set(block.match(/[A-Za-z0-9_$]+/g) ?? []);

/**
 * Can this binding reach a membership write?
 *
 * A symbol-level graph walk: the declaration's own text, then every identifier
 * it names -- resolved first against its own module's declarations, then
 * against whatever that module imports from `@/`. The `seen` set makes a cycle
 * terminate rather than recurse forever.
 */
function reachesMembershipWrite(
  module: string,
  symbol: string,
  seen = new Set<string>(),
): boolean {
  const key = `${module}#${symbol}`;
  if (seen.has(key)) return false;
  seen.add(key);

  const source = readModule(module);
  if (source === null) return false;

  const blocks = declarationsOf(source);
  const block = blocks.get(symbol);
  if (block === undefined) return false;

  if (MEMBERSHIP_WRITE_MARKERS.some((marker) => block.includes(marker))) return true;

  const names = identifiersIn(block);
  for (const name of names) {
    if (name !== symbol && blocks.has(name) && reachesMembershipWrite(module, name, seen)) {
      return true;
    }
  }
  for (const imported of importsOf(stripComments(source))) {
    for (const name of imported.symbols) {
      if (names.has(name) && reachesMembershipWrite(imported.module, name, seen)) return true;
    }
  }
  return false;
}

/**
 * Whether a route handler can change which tenant the caller belongs to.
 *
 * The route's own body first -- a handler that writes the table inline needs
 * no import to be caught -- and then each binding it imported, walked.
 */
function changesMembership(route: string): boolean {
  const source = read(route);
  const code = stripComments(source);
  if (MEMBERSHIP_WRITE_MARKERS.some((marker) => code.includes(marker))) return true;
  return importsOf(code).some((imported) =>
    imported.symbols.some((symbol) => reachesMembershipWrite(imported.module, symbol)),
  );
}

const membershipRoutes = routeHandlers.filter(changesMembership);
const otherRoutes = routeHandlers.filter((route) => !changesMembership(route));

/* ── the rule ──────────────────────────────────────────────────────────────── */

describe("a route that changes the caller's tenant reissues the token", () => {
  it.each(membershipRoutes)("%s calls refreshSession before returning", (route) => {
    // The reissue has to happen in the ROUTE HANDLER and nowhere else: Next
    // forbids writing a cookie once a Server Component render has begun, so a
    // refresh triggered from a render is computed and thrown away
    // (`lib/supabase/server.ts` swallows `setAll` for exactly that reason).
    // A route handler is the only place that can both mutate and persist.
    expect(
      stripComments(read(route)).includes(REISSUE_CALL),
      `${route} can change which tenant the caller belongs to and never calls ` +
        `refreshSession(). The membership will be right in the database and absent from the ` +
        `token, so every tenant-scoped query returns nothing until the 15-minute TTL expires. ` +
        `Reissue after the write, and treat a failed reissue as a failed mutation -- see ` +
        `app/api/memberships/switch/route.ts.`,
    ).toBe(true);
  });

  it.each(membershipRoutes)("%s treats a failed reissue as a failed mutation", (route) => {
    // A reissue whose error is ignored is worse than none: the handler answers
    // success for a session that cannot see what it just created.
    //
    // The first version of this assertion did not catch that. It looked for
    // `refreshError` OR a `serverError()` within 200 characters of the call --
    // and every one of these handlers already ends its `catch` block in
    // `serverError()`, so replacing the whole checked reissue with a bare
    // `await supabase.auth.refreshSession()` left it green. Found by running
    // that exact mutation rather than by reading it. The rule now requires the
    // error to be BOUND and then TESTED, which is a shape a bare call cannot
    // have.
    const code = stripComments(read(route));
    const bound =
      /const\s*\{\s*error(?:\s*:\s*([A-Za-z0-9_$]+))?\s*\}\s*=\s*await\s+[A-Za-z0-9_$.]+\.refreshSession\(\s*\)/.exec(
        code,
      );
    expect(
      bound,
      `${route} calls refreshSession() without binding its error, so a session that could not ` +
        `pick up its new tenant is reported as a success. Destructure the error and return ` +
        `serverError() on it -- see app/api/memberships/switch/route.ts.`,
    ).not.toBeNull();

    const alias = bound?.[1] ?? "error";
    expect(
      new RegExp(`if\\s*\\(\\s*${alias}\\s*\\)`).test(code),
      `${route} binds the reissue error as "${alias}" and never branches on it.`,
    ).toBe(true);
  });
});

/* ── the rule is not vacuous ───────────────────────────────────────────────── */

describe("the rule has something to apply to, and discriminates", () => {
  it("found the route handlers at all", () => {
    // A broken directory walk returns nothing and every assertion above passes
    // by iterating over an empty list.
    expect(routeHandlers.length, "no route handlers were discovered under app/api").toBeGreaterThan(
      0,
    );
    expect(routeHandlers).toContain("app/api/companies/route.ts");
    expect(routeHandlers).toContain("app/api/memberships/switch/route.ts");
  });

  it("classifies at least one route each way", () => {
    // A detector that flags everything, or nothing, would satisfy the rule
    // above while meaning nothing. Both sides have to be non-empty.
    expect(membershipRoutes.length, "no route was detected as changing membership").toBeGreaterThan(
      0,
    );
    expect(
      otherRoutes.length,
      "every route was detected as changing membership, so the detector is matching prose or " +
        "following imports it should not",
    ).toBeGreaterThan(0);
  });

  it("sees through an import chain rather than only the route's own text", () => {
    // `/api/companies` names no membership surface in its own source. It
    // imports `registerCompany`, which calls the `register_company` RPC, which
    // calls `create_founding_membership`, which writes the table. A rule that
    // read one file would have called this route membership-free -- which is
    // precisely the mistake that shipped.
    const ownText = stripComments(read("app/api/companies/route.ts"));
    expect(
      MEMBERSHIP_WRITE_MARKERS.some((marker) => ownText.includes(marker)),
      "app/api/companies/route.ts now names a membership surface directly, so this case no " +
        "longer proves the transitive walk works; point it at another route that does not",
    ).toBe(false);
    expect(membershipRoutes).toContain("app/api/companies/route.ts");
  });

  it("does not flag a route that cannot reach a membership write", () => {
    // The negative control, named rather than counted: sign-in authenticates
    // and changes no membership, so it must not be required to reissue.
    expect(otherRoutes).toContain("app/api/auth/signin/route.ts");
  });

  it("watches markers that still exist in the schema", () => {
    // Marker rot is how this rule dies quietly: rename `switch_company` and
    // the detector stops matching, every route classifies as membership-free,
    // and the suite goes green while enforcing nothing. The migrations are the
    // source of truth for the names.
    const migrations = listFiles("supabase/migrations")
      .filter((file) => file.endsWith(".sql"))
      .map(read)
      .join("\n");
    for (const marker of MEMBERSHIP_WRITE_MARKERS) {
      expect(
        migrations.includes(marker),
        `MEMBERSHIP_WRITE_MARKERS watches "${marker}", which appears in no migration. If it was ` +
          `renamed, this rule has been matching nothing since.`,
      ).toBe(true);
    }
  });
});
