import { redirect } from "next/navigation";
import { cache } from "react";

import { getOwnedCompany, type OwnedCompany } from "@/lib/db/companies";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Who is asking, and what they own — resolved once per request.
 *
 * `cache()` is React's per-request memo, not a cross-request cache. The layout
 * and the page inside it both need the company, and without this they would
 * ask Supabase twice for the same row on every render. Nothing here is shared
 * between requests, which is what makes memoising a *tenant's* row safe.
 */

/** Where a caller with no session is sent. */
export const SIGN_IN_PATH = "/signin";

/**
 * Auth-server answers that mean "this caller is not signed in".
 *
 * Everything else means the question could not be answered, which is a
 * different fact and must not be rendered as a sign-out.
 */
const NOT_SIGNED_IN_STATUSES = new Set([400, 401, 403]);

const meansSignedOut = (error: { status?: number; name?: string; code?: string }): boolean => {
  if (error.name === "AuthSessionMissingError") return true;
  if (error.code === "session_not_found" || error.code === "refresh_token_not_found") return true;
  return typeof error.status === "number" && NOT_SIGNED_IN_STATUSES.has(error.status);
};

/**
 * The authenticated user, or null.
 *
 * `getUser()` rather than `getSession()`: the session comes from a cookie the
 * browser controls, and only `getUser()` asks the auth server whether the
 * token is genuine. Reading identity from an unverified cookie is how an
 * authorisation decision ends up trusting its own input.
 *
 * **A transient failure is not a sign-out**, and the two used to be the same
 * line of code. `if (error) return null` turns "Supabase did not answer" into
 * "you are not logged in" on the hottest path in the product: a five-second
 * blip would bounce every signed-in user to the sign-in screen, where their
 * still-valid cookies would then redirect them back, and the only visible
 * symptom is a loop. So an answer that means *not signed in* returns null, and
 * anything else is rethrown — a 500 and an error boundary say "we are broken",
 * which is true, instead of "you are signed out", which is not.
 */
export const currentUser = cache(async () => {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    if (meansSignedOut(error as { status?: number; name?: string; code?: string })) {
      return null;
    }
    throw error;
  }

  return data.user ?? null;
});

/**
 * The user, or a redirect to sign-in. Every screen behind the shell needs one.
 *
 * `/signin`, not `/signup`. Sending a returning user to signup is the exact
 * lockout the sign-in route was added to end: they would land on "check your
 * email" waiting for a mail that will never come, because signup for an
 * address that already exists deliberately sends nothing. Someone with no
 * account at all reaches signup from the link on that screen.
 */
export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect(SIGN_IN_PATH);
  return user;
}

/**
 * The company this user owns, or null before registration.
 *
 * Null is a state the product genuinely has — between clicking the
 * confirmation link and submitting the registration form — not an error.
 */
export const currentCompany = cache(async (): Promise<OwnedCompany | null> => {
  const user = await currentUser();
  if (!user) return null;
  const supabase = await createServerSupabaseClient();
  return getOwnedCompany(supabase);
});
