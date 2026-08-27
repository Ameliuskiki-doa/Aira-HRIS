/**
 * The only place a Supabase credential is read, and the only shape it is
 * allowed to have.
 *
 * CLAUDE.md rule 5 and AD-16: there is no code path in this repository that
 * may use an elevated Supabase key. "Absent" is not the same as "impossible":
 * a key is a string, and a string can be pasted into the wrong variable at
 * three in the morning. So the prohibition is structural in two ways:
 *
 *   1. **No client factory takes a key.** `createBrowserSupabaseClient()`,
 *      `createServerSupabaseClient()` and `createRouteSupabaseClient()` are
 *      nullary. There is no parameter to pass a secret through, so the only
 *      credential any of them can reach is the one this module returns.
 *   2. **This module refuses any key that is not publishable**, whatever
 *      variable it arrived in. Supabase issues two kinds of key: a
 *      publishable one, which is `sb_publishable_…` or a legacy JWT whose
 *      payload carries the role `anon`, and an elevated secret one, which is
 *      neither. Only the first shape is accepted.
 *
 *      An allowlist, not a denylist, and deliberately so. A denylist has to
 *      name every elevated key format Supabase might mint next and is wrong
 *      the day one is added; requiring a key to *prove* it is publishable
 *      admits none of them, including formats that do not exist yet. It is
 *      also why the forbidden spelling appears nowhere in this file — the
 *      rule does not need to name what it excludes.
 *
 * Everything is read lazily, inside the function. A module-scope read would
 * make `next build` fail in CI, where no `.env.local` exists and no dynamic
 * route ever executes.
 */

/** Env var holding the project URL. Public: it appears in every request. */
export const SUPABASE_URL_VAR = "NEXT_PUBLIC_SUPABASE_URL";

/**
 * Env var holding the publishable key.
 *
 * `…_PUBLISHABLE_KEY`, not `…_ANON_KEY`. Publishable is the name Supabase
 * issues under now, and `.env.local` already used it while `.env.example`
 * still declared the old one — reconciled here so there is one spelling.
 */
export const SUPABASE_PUBLISHABLE_KEY_VAR = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";

/**
 * Both variables are `NEXT_PUBLIC_`, so Next inlines them at build time only
 * when they are read as literal `process.env.X` member expressions. A dynamic
 * `process.env[name]` lookup is not inlined and reads as `undefined` in the
 * browser — which is why this map exists instead of an index expression.
 */
const RAW: Record<string, string | undefined> = {
  [SUPABASE_URL_VAR]: process.env.NEXT_PUBLIC_SUPABASE_URL,
  [SUPABASE_PUBLISHABLE_KEY_VAR]: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
};

const required = (name: string): string => {
  const value = RAW[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
};

/** Decodes a JWT payload without verifying it. Shape inspection only. */
function jwtRole(key: string): string | null {
  const segments = key.split(".");
  if (segments.length !== 3) return null;
  try {
    // `atob`, not `Buffer`: this module is imported by the browser client
    // too, and `Buffer` is a Node global that a bundler is under no obligation
    // to polyfill. `atob` exists in both runtimes.
    const payload: unknown = JSON.parse(
      atob(segments[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    if (typeof payload !== "object" || payload === null) return null;
    const role = (payload as { role?: unknown }).role;
    return typeof role === "string" ? role : null;
  } catch {
    return null;
  }
}

/**
 * True only for a key that identifies itself as publishable.
 *
 * Exported so the suite can state the property — "a secret-shaped key is
 * refused" — over a table of real key shapes rather than over one example.
 */
export function isPublishableKey(key: string): boolean {
  const trimmed = key.trim();
  if (trimmed.startsWith("sb_publishable_")) return true;
  return jwtRole(trimmed) === "anon";
}

export const supabaseUrl = (): string => required(SUPABASE_URL_VAR);

/**
 * The publishable key, or a thrown error naming what went wrong.
 *
 * Throwing is the right failure: a request that proceeds with a secret in
 * hand is a cross-tenant leak, and there is no degraded mode worth having.
 */
export function supabasePublishableKey(): string {
  const key = required(SUPABASE_PUBLISHABLE_KEY_VAR);
  if (!isPublishableKey(key)) {
    const role = jwtRole(key);
    throw new Error(
      `${SUPABASE_PUBLISHABLE_KEY_VAR} does not hold a publishable Supabase key` +
        (role ? ` — it carries the role "${role}"` : "") +
        `. Only a publishable key (sb_publishable_…, or a legacy JWT with role "anon") ` +
        `may reach a Supabase client in this repository: every request path carries the ` +
        `user's own JWT and the worker sets tenant context per transaction ` +
        `(CLAUDE.md rule 5, AD-16).`,
    );
  }
  return key;
}
