import { NextResponse } from "next/server";
import type { ZodError, ZodType } from "zod";

/**
 * The shape every route handler's boundary has, written once.
 *
 * AD-15: mutations are route handlers, never Server Actions, and every one of
 * them validates with Zod before anything reaches the database. Stating that
 * as a shared function rather than as a convention is what keeps "the schema
 * ran" from being something a handler can forget: a handler either calls
 * `readJson` and gets parsed data, or it has no data at all.
 *
 * `readJson` also enforces same-origin intent, for the same reason and in the
 * same place. A CSRF check a handler has to remember is a CSRF check the
 * fourth handler will not have.
 */

/** A field-keyed message bag the form can render inline. */
export type FieldErrors = Record<string, string>;

export type BoundaryFailure = { readonly response: NextResponse };
export type BoundaryResult<T> =
  | { readonly ok: true; readonly data: T }
  | ({ readonly ok: false } & BoundaryFailure);

/**
 * First message per field, keyed by the field name.
 *
 * First, not all: the form shows one line under one input, and a list of
 * three ways the same value is wrong is not more useful than the first.
 * Issues with an empty path -- an unrecognised key, for one -- are collected
 * under `_form`, which the form renders above the fields.
 */
export function fieldErrorsOf(error: ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "_form";
    fields[key] ??= issue.message;
  }
  return fields;
}

export const badRequest = (message: string, fields: FieldErrors = {}) =>
  NextResponse.json({ error: message, fields }, { status: 400 });

export const unauthorized = (message: string) =>
  NextResponse.json({ error: message, fields: {} }, { status: 401 });

export const forbidden = (message: string) =>
  NextResponse.json({ error: message, fields: {} }, { status: 403 });

/**
 * A 500 that says nothing about how the server is built.
 *
 * It takes no message, and that is the API doing the remembering: the previous
 * version accepted one and every caller passed `cause.message`, which returned
 * Postgres and PostgREST text -- constraint names, column names, the shape of
 * the schema -- straight to an anonymous caller. Removing the parameter makes
 * the mistake unavailable rather than merely discouraged. The cause goes to
 * `logFailure`, where operators can read it and users cannot.
 */
export const serverError = () =>
  NextResponse.json(
    {
      error: "Something went wrong on our side. Try again in a moment.",
      fields: {},
    },
    { status: 500 },
  );

/**
 * One structured JSON line to stdout, which is the agreed logging shape.
 *
 * `scope` is the call site, not the message, so failures group by where they
 * happened rather than by whatever text Postgres chose that day. Nothing with
 * a user's data in it is passed here -- a cause is an exception, and the
 * inputs that produced it stay where they are.
 */
export function logFailure(scope: string, cause: unknown): void {
  const detail =
    cause instanceof Error
      ? { name: cause.name, message: cause.message }
      : { name: "unknown", message: String(cause) };
  console.error(
    JSON.stringify({ level: "error", scope, ...detail, at: new Date().toISOString() }),
  );
}

/* ── where the server thinks it is ─────────────────────────────────────────── */

/**
 * The canonical origin of this deployment, from configuration.
 *
 * Configuration and not a header, because a header is the caller's. Falls back
 * to Vercel's own deployment host, then to localhost outside production --
 * enough that a developer needs no `.env` entry and a preview deployment
 * works, while a production deployment that never set it fails loudly rather
 * than trusting whatever arrived.
 */
function canonicalOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return normaliseOrigin(configured) ?? fail(configured);

  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ?? process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;

  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";

  throw new Error(
    "NEXT_PUBLIC_SITE_URL is not set. It is the only thing that decides which host " +
      "a confirmation link points at, and a request header is not allowed to decide it.",
  );
}

const fail = (value: string): never => {
  throw new Error(`NEXT_PUBLIC_SITE_URL is not a valid http(s) origin: ${value}`);
};

/** `https://host:port`, or null for anything that is not an http(s) origin. */
function normaliseOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Hosts this deployment answers to. Anything else is somebody else's. */
function allowedHosts(): Set<string> {
  const hosts = new Set<string>();
  const canonical = normaliseOrigin(canonicalOrigin());
  if (canonical) hosts.add(new URL(canonical).host);
  for (const candidate of [
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
  ]) {
    const host = candidate?.trim();
    if (host) hosts.add(host);
  }
  if (process.env.NODE_ENV !== "production") {
    hosts.add("localhost:3000");
    hosts.add("127.0.0.1:3000");
  }
  return hosts;
}

/**
 * The origin to build absolute URLs against, and never the caller's word for it.
 *
 * `x-forwarded-host` was trusted unconditionally here, and it builds
 * `emailRedirectTo`. A request carrying `X-Forwarded-Host: evil.example` made
 * Supabase mail a confirmation link pointing at the attacker's host -- and
 * that link carries the PKCE code, so following it hands over the session.
 * Reproduced.
 *
 * A forwarded host is still honoured when it is one this deployment answers
 * to, because behind a real proxy the public host is the only one that
 * produces a working link. The header is a hint about which of *our* hosts was
 * used, not an instruction about where to point.
 *
 * The multi-proxy form (`a.example, b.example`) is handled rather than parsed
 * optimistically: it used to reach `new URL()` and throw, which was a 500
 * where a refusal belonged.
 */
export function trustedOrigin(request: Request): string {
  const canonical = canonicalOrigin();
  const hosts = allowedHosts();

  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  if (forwardedHost && hosts.has(forwardedHost)) {
    const proto = firstHeaderValue(request.headers.get("x-forwarded-proto"));
    const scheme = proto === "http" || proto === "https" ? proto : "https";
    const origin = normaliseOrigin(`${scheme}://${forwardedHost}`);
    if (origin) return origin;
  }

  try {
    const url = new URL(request.url);
    if (hosts.has(url.host)) return url.origin;
  } catch {
    // Falls through to the canonical origin, which is the safe answer.
  }

  return canonical;
}

/** `a, b` is the shape a second proxy produces; the first hop is ours. */
function firstHeaderValue(raw: string | null): string | null {
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim();
  return first ? first : null;
}

/* ── who asked ─────────────────────────────────────────────────────────────── */

/** Content types a state-changing request may carry. */
const JSON_MEDIA_TYPE = "application/json";

/**
 * Refuses a request that did not come from this application, or null.
 *
 * Two checks, and they cover different attackers.
 *
 * **The content type** closes the simple-request hole. A cross-site
 * `<form enctype="text/plain">` sends no preflight and does attach cookies,
 * and its body is close enough to JSON that `request.json()` parsed it --
 * which on `/api/auth/signin` logs a victim into the attacker's tenant, so
 * everything they type next is the attacker's data. A JSON content type
 * cannot be set from a form, so requiring it makes the browser preflight.
 *
 * **`Origin` / `Sec-Fetch-Site`** cover a caller that *can* set headers, where
 * a preflight the browser never sends is a protection that never runs.
 *
 * When neither header is present the request is allowed. That is not a gap: a
 * browser always sends `Origin` on a cross-origin POST and `Sec-Fetch-Site` on
 * every fetch, and a caller that sends neither is not a browser carrying
 * somebody else's cookies -- which is the only thing CSRF is.
 */
export function crossSiteRefusal(request: Request): NextResponse | null {
  const contentType = request.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== JSON_MEDIA_TYPE) {
    return forbidden(
      `This endpoint accepts ${JSON_MEDIA_TYPE} only. A form-encoded or plain-text ` +
        `post is how a cross-site request reaches an endpoint without a preflight.`,
    );
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none") {
    return forbidden("This request did not come from Aira.");
  }

  const origin = request.headers.get("origin");
  if (origin !== null && origin !== "null") {
    const normalised = normaliseOrigin(origin);
    if (normalised === null || !allowedHosts().has(new URL(normalised).host)) {
      return forbidden("This request did not come from Aira.");
    }
  }

  return null;
}

/**
 * Reads the request body and validates it, or produces the response to return.
 *
 * The cross-site check runs first, before the body is even read: a request
 * that should not have been made is refused rather than parsed.
 *
 * A malformed body and a body that fails the schema are the same outcome to a
 * caller, so they get the same status -- but the message differs, because
 * "that was not JSON" and "legal name is required" are different problems and
 * only one of them is the user's.
 */
export async function readJson<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<BoundaryResult<T>> {
  const refusal = crossSiteRefusal(request);
  if (refusal) return { ok: false, response: refusal };

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: badRequest("The request body was not valid JSON."),
    };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: badRequest(
        "Some of the details need fixing.",
        fieldErrorsOf(parsed.error),
      ),
    };
  }

  return { ok: true, data: parsed.data };
}

/* ── where a redirect may point ────────────────────────────────────────────── */

/**
 * Two placeholder origins, used to ask whether a value stays put.
 *
 * `.invalid` is reserved by RFC 2606 and resolves nowhere, so neither of these
 * can collide with a real deployment host.
 */
const PROBE_A = "https://probe-a.invalid";
const PROBE_B = "https://probe-b.invalid";

/**
 * A redirect target taken from a query string, made safe.
 *
 * **Stated positively, and the previous version is why.** It read
 * `value.startsWith("/") && !value.startsWith("//")`, which refuses exactly
 * one spelling of the attack and honours at least five others:
 * `/\evil.example`, `/\/evil.example`, `/\t/evil.example`, `/\n//evil.example`
 * and `/\r//evil.example` all resolve to `https://evil.example/` with the base
 * origin ignored entirely, because WHATWG URL treats `\` as `/` for special
 * schemes and strips tab, LF and CR *before* parsing. All five were measured.
 *
 * Adding `\` to the rejected set would be the `qual = 'true'` mistake from
 * Story 1.4 in a new costume: a denylist can only ever hold the spellings
 * somebody already thought of. So the question asked here is not "does it look
 * dangerous" but "does it stay inside" -- the value is resolved against two
 * *different* placeholder origins, and it is a path only if it lands inside
 * each of them. Anything that can escape resolves to the same absolute URL for
 * both, and fails.
 *
 * The round trip has to reproduce the input exactly as well. Without that, a
 * value the parser silently rewrites (`/a/../../b`, a leading space) would be
 * accepted as something other than what was written, and "accepted as
 * something else" is how the next hole gets found.
 *
 * This runs on the confirmation-link path, which is the most trusted click a
 * user will ever give this product.
 */
export function safeRedirectPath(value: string | null, fallback: string): string {
  if (!value) return fallback;

  let a: URL;
  let b: URL;
  try {
    a = new URL(value, PROBE_A);
    b = new URL(value, PROBE_B);
  } catch {
    return fallback;
  }

  if (a.origin !== PROBE_A || b.origin !== PROBE_B) return fallback;

  const resolved = `${a.pathname}${a.search}${a.hash}`;
  if (resolved !== value) return fallback;

  return resolved;
}
