import { createBrowserClient } from "@supabase/ssr";

import { supabasePublishableKey, supabaseUrl } from "./keys";

/**
 * The Supabase client for code running in the browser.
 *
 * Nullary on purpose. There is no parameter to hand it a credential through,
 * so the only key it can hold is the one `keys.ts` vetted — see the note
 * there on why the elevated-key prohibition is structural here rather than a
 * convention.
 *
 * `createBrowserClient` reads and writes the auth cookies the server clients
 * read, so a session established by the callback route is visible here without
 * a second round trip.
 */
export function createBrowserSupabaseClient() {
  return createBrowserClient(supabaseUrl(), supabasePublishableKey());
}
