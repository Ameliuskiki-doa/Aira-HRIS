import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { supabasePublishableKey, supabaseUrl } from "./keys";

/**
 * Refreshes the session and writes the new tokens onto the response.
 *
 * This exists because of a gap the other three clients structurally cannot
 * close. Next forbids writing a cookie once a Server Component render has
 * begun, so `lib/supabase/server.ts` has to swallow `setAll` -- which means a
 * token refreshed during a render is computed and then thrown away. Every
 * subsequent render refreshes again, and the browser keeps sending the same
 * expired token, until some route handler happens to run and persist one.
 *
 * The access token's TTL is **900 seconds** (AD-9). It was 3600 while this
 * story was being built and was lowered on the owner's instruction, so a
 * session now expires four times sooner than the code around it assumed: a
 * user filling in the company registration form crosses the boundary in
 * fifteen minutes of typing. Without this, they cross it and are thrown out.
 *
 * Named `proxy` rather than `middleware`: Next 16 deprecated the `middleware`
 * file convention and renamed it to `proxy`, with the behaviour unchanged.
 *
 * The shape below is the documented one and each line of it is load-bearing:
 *
 *   - the response is rebuilt inside `setAll`, from a request that has already
 *     had the new cookies written onto it, so the *downstream* handler in this
 *     same pass reads the refreshed token rather than the expired one;
 *   - the cookies are then also set on the outgoing response, which is what
 *     persists them to the browser;
 *   - `getUser()` is what actually triggers the refresh. It is not a check
 *     whose result is discarded -- it is the call that notices `expires_at` has
 *     passed, exchanges the refresh token, and fires `TOKEN_REFRESHED`, which
 *     is what invokes `setAll` at all.
 *
 * Nothing here decides authorization. The redirect for a missing session lives
 * in `app/(app)/layout.tsx`, where the route knows what it needs; a proxy pass
 * that also redirects would be a second copy of that rule in a file the route
 * cannot see.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const url = supabaseUrl();
  const key = supabasePublishableKey();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // `getUser()`, not `getSession()`, and the reason is *not* the refresh:
  // measured, `getSession()` refreshes an expired token too, so a comment
  // claiming otherwise would have been wrong. What `getUser()` adds is a
  // round trip to `/auth/v1/user` that revalidates the token against the auth
  // server, so a forged or revoked session is caught here rather than at the
  // first query. It is the documented middleware call for that reason.
  //
  // The cost is one extra request to Supabase per navigation, on top of the
  // one `currentUser()` makes during the render. Recorded in deferred-work
  // rather than optimised away, because the cheap version -- `getSession()`
  // here, revalidate only in the render -- relies on a refresh happening as a
  // side effect of a call whose contract does not promise one.
  await supabase.auth.getUser();

  return response;
}
