/**
 * The refresh, observed.
 *
 * The property is not "a proxy file exists". It is: **a request arriving with an
 * expired access token leaves with a fresh one written to the browser.**
 *
 * That distinction is the whole point of this file. `lib/supabase/server.ts`
 * swallows `setAll`, because Next forbids writing a cookie during a Server
 * Component render — so a refresh computed there is computed and discarded.
 * A proxy pass that ran and refreshed nothing would look identical from the
 * outside, and would leave a user filling in the registration form signed out
 * fifteen minutes in (AD-9 lowered the access token TTL from 3600s to 900s
 * while this story was being built).
 *
 * So nothing here is mocked except the network. The real `@supabase/ssr`
 * builds the real `@supabase/auth-js` client, which reads the real cookie
 * format, notices `expires_at` has passed, and calls the token endpoint. Only
 * `fetch` is a stub, and what it records is itself an assertion: if the
 * refresh did not happen, the token endpoint was never called.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const URL_VAR = "NEXT_PUBLIC_SUPABASE_URL";
const KEY_VAR = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";
const PROJECT_URL = "https://project.supabase.co";
const PUBLISHABLE = "sb_publishable_AbCdEf0123456789";

/**
 * `sb-<first label of the project hostname>-auth-token`, holding
 * `base64-` + base64url(JSON of the session).
 *
 * Read out of `@supabase/supabase-js` and `@supabase/ssr` rather than
 * remembered: the storage key is built as
 * `sb-${new URL(url).hostname.split(".")[0]}-auth-token`, and the cookie value
 * is prefixed `base64-` when `cookieEncoding` is `base64url`, which is the
 * default. If either changes, the seeded cookie stops being read at all and
 * the "no refresh without middleware" control below turns red — which is the
 * behaviour wanted from a test that hard-codes a third party's format.
 */
const AUTH_COOKIE = "sb-project-auth-token";

const base64url = (value: string) => Buffer.from(value, "utf8").toString("base64url");
const jwt = (payload: Record<string, unknown>) =>
  `${base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64url(
    JSON.stringify(payload),
  )}.signature-not-verified-locally`;

const USER = {
  id: "00000000-0000-4000-8000-0000000000ff",
  aud: "authenticated",
  role: "authenticated",
  email: "hr@nusantara.co.id",
};

type Session = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  expires_at: number;
  user: typeof USER;
};

const sessionCookie = (session: Session) =>
  `base64-${base64url(JSON.stringify(session))}`;

const decodeCookie = (value: string): Session =>
  JSON.parse(
    Buffer.from(
      decodeURIComponent(value).slice("base64-".length),
      "base64url",
    ).toString("utf8"),
  ) as Session;

let now = 0;
let expiredSession: Session;
let freshAccessToken: string;
/** Every request the auth library made. The refresh is visible here or not. */
let networkCalls: string[] = [];

beforeEach(() => {
  now = Math.floor(Date.now() / 1000);
  networkCalls = [];

  const expiredAt = now - 60;
  expiredSession = {
    // Expired sixty seconds ago: a tab that has been open through one 900s TTL.
    access_token: jwt({ sub: USER.id, role: "authenticated", exp: expiredAt, iat: expiredAt - 900 }),
    refresh_token: "the-refresh-token",
    token_type: "bearer",
    expires_in: 0,
    expires_at: expiredAt,
    user: USER,
  };
  freshAccessToken = jwt({ sub: USER.id, role: "authenticated", exp: now + 900, iat: now });

  vi.stubEnv(URL_VAR, PROJECT_URL);
  vi.stubEnv(KEY_VAR, PUBLISHABLE);

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    networkCalls.push(`${init?.method ?? "GET"} ${url.replace(PROJECT_URL, "")}`);

    if (url.includes("/auth/v1/token") && url.includes("grant_type=refresh_token")) {
      return new Response(
        JSON.stringify({
          access_token: freshAccessToken,
          token_type: "bearer",
          expires_in: 900,
          expires_at: now + 900,
          refresh_token: "the-next-refresh-token",
          user: USER,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/auth/v1/user")) {
      return new Response(JSON.stringify(USER), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const requestCarrying = (session: Session) =>
  new NextRequest("http://localhost:3000/company/new", {
    headers: {
      cookie: `${AUTH_COOKIE}=${encodeURIComponent(sessionCookie(session))}`,
    },
  });

const refreshed = () =>
  networkCalls.some((call) => call.includes("grant_type=refresh_token"));

describe("an expired access token is refreshed and persisted", () => {
  it("calls the token endpoint and writes the new session to the browser", async () => {
    const { updateSession } = await import("@/lib/supabase/proxy");
    const request = requestCarrying(expiredSession);

    const response = await updateSession(request);

    // 1. The refresh actually happened. Nothing else in this repo can make
    //    this call, so its presence is the refresh.
    expect(refreshed(), `no token exchange happened; calls were ${networkCalls.join(", ")}`).toBe(true);

    // 2. It reached the browser. This is the half `lib/supabase/server.ts`
    //    structurally cannot do, and the reason this file exists.
    const written = response.cookies.get(AUTH_COOKIE);
    expect(written, "the refreshed session was not written to the response").toBeDefined();

    const session = decodeCookie(written!.value);
    expect(session.access_token, "the response carries the same expired token").toBe(
      freshAccessToken,
    );
    expect(session.access_token).not.toBe(expiredSession.access_token);
    expect(session.refresh_token).toBe("the-next-refresh-token");
    expect(session.expires_at).toBeGreaterThan(now);
  });

  it("hands the refreshed token to the render in the same pass", async () => {
    // Not only to the browser. The response is rebuilt from a request that has
    // already had the new cookie written onto it, so the page rendering behind
    // this middleware reads the fresh token rather than the expired one it
    // arrived with. Without that line the user is refreshed and *still* sees
    // one signed-out render.
    const { updateSession } = await import("@/lib/supabase/proxy");
    const request = requestCarrying(expiredSession);

    await updateSession(request);

    const forwarded = request.cookies.get(AUTH_COOKIE);
    expect(forwarded, "the request was not updated for the downstream render").toBeDefined();
    expect(decodeCookie(forwarded!.value).access_token).toBe(freshAccessToken);
  });

  it("revalidates the token against the auth server, not just the cookie", async () => {
    // The property `getSession()` would not have. Both calls refresh an expired
    // token -- measured -- so the refresh assertions above cannot tell them
    // apart. What separates them is this round trip: a cookie is something the
    // browser controls, and only asking the auth server turns it into an
    // identity. Without this assertion, swapping the call is a silent change.
    const { updateSession } = await import("@/lib/supabase/proxy");
    await updateSession(requestCarrying(expiredSession));

    expect(
      networkCalls.some((call) => call.includes("/auth/v1/user")),
      `the session was never revalidated; calls were ${networkCalls.join(", ")}`,
    ).toBe(true);
  });

  it("leaves a session that has not expired alone", async () => {
    // The control. A proxy pass that refreshed on every request would spend a
    // network round trip per navigation and rotate the refresh token needlessly.
    const valid: Session = {
      ...expiredSession,
      access_token: jwt({ sub: USER.id, role: "authenticated", exp: now + 600, iat: now }),
      expires_in: 600,
      expires_at: now + 600,
    };
    const { updateSession } = await import("@/lib/supabase/proxy");

    await updateSession(requestCarrying(valid));

    expect(refreshed(), "a live session was refreshed anyway").toBe(false);
  });

  it("does nothing, and throws nothing, for a request with no session", async () => {
    // The proxy runs on every route including `/signup`, so the no-cookie path
    // is the common one and must be silent.
    const { updateSession } = await import("@/lib/supabase/proxy");
    const response = await updateSession(
      new NextRequest("http://localhost:3000/signup"),
    );
    expect(refreshed()).toBe(false);
    expect(response.cookies.get(AUTH_COOKIE)).toBeUndefined();
  });
});

describe("the gap this closes", () => {
  it("is real: a Server Component client cannot persist the same refresh", async () => {
    // The negative control, and the justification for the whole file. Given the
    // identical expired session, the render-time client performs the same token
    // exchange and then has nowhere to put the result — `setAll` throws inside
    // a render and is swallowed by design. Simulated here by a cookie store
    // that refuses writes, which is exactly what `cookies()` does outside a
    // route handler.
    const rejected: string[] = [];
    vi.doMock("next/headers", () => ({
      cookies: async () => ({
        getAll: () => [
          { name: AUTH_COOKIE, value: sessionCookie(expiredSession) },
        ],
        set: (name: string) => {
          rejected.push(name);
          throw new Error("Cookies can only be modified in a Server Action or Route Handler");
        },
      }),
    }));
    vi.resetModules();

    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();
    const { data } = await supabase.auth.getUser();

    expect(data.user?.id, "the render-time client could not read the session at all").toBe(USER.id);
    expect(refreshed(), "the render-time client did not refresh").toBe(true);
    expect(
      rejected.length,
      "the render-time client was never even asked to write a cookie",
    ).toBeGreaterThan(0);
    // And the throw was swallowed rather than taking the render down with it.
    vi.doUnmock("next/headers");
  });
});
