import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { supabasePublishableKey, supabaseUrl } from "./keys";

/**
 * The Supabase client for route handlers.
 *
 * Same construction as the server client with one difference that matters:
 * `setAll` does **not** swallow. A route handler is allowed to write cookies,
 * so a failure here is a real failure — the signup route's PKCE verifier and
 * the callback route's session both arrive through this path, and losing
 * either silently would surface much later as "the confirmation link does
 * nothing".
 *
 * Nullary, like every factory in this directory. AD-15: mutations are route
 * handlers, never Server Actions, so this is the client every write in the
 * product is made through.
 */
export async function createRouteSupabaseClient() {
  // `cookies()` FIRST, and the order is load-bearing in a way that is easy to
  // get backwards -- it was, once, and `npm run build` caught it.
  //
  // Reading `process.env` first looks tidier and breaks the build. `cookies()`
  // is a request-time API: during a prerender it throws a signal Next catches
  // to mark the route dynamic. Reach for the environment before that signal is
  // raised and the prerender instead hits `NEXT_PUBLIC_SUPABASE_URL is not
  // set` -- a real error, from a worker, on a route that was never going to be
  // static. CI has no `.env.local`, so the whole build fails there and nowhere
  // else. `tests/supabase-clients.test.ts` pins this ordering.
  const cookieStore = await cookies();
  const url = supabaseUrl();
  const key = supabasePublishableKey();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });
}
