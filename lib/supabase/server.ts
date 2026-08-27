import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { supabasePublishableKey, supabaseUrl } from "./keys";

/**
 * The Supabase client for Server Components and layouts.
 *
 * Nullary, like every factory in this directory: no parameter exists to pass
 * a credential through, and `keys.ts` refuses a secret-shaped one anyway.
 *
 * **`setAll` is wrapped in try/catch, and that is not defensive noise.** The
 * Supabase documentation omits it; without it this client throws the moment
 * the auth library decides to refresh a token during a Server Component
 * render, because Next forbids writing a cookie once rendering has begun
 * (`cookies()` is read-only outside a Route Handler or Server Function).
 * Swallowing it is correct: a refresh that cannot be persisted from a render
 * is retried by the next route handler, which *can* write.
 *
 * The cost of that trade is real and worth stating: a session refreshed here
 * is not written back, so a page rendered with an access token past its
 * 15-minute TTL (AD-9) re-refreshes on every render until a route handler
 * persists the new one.
 */
export async function createServerSupabaseClient() {
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
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render. See the note above.
        }
      },
    },
  });
}
