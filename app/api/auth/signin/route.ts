import { NextResponse } from "next/server";

import { logFailure, readJson, serverError } from "@/lib/api/boundary";
import { getOwnedCompany } from "@/lib/db/companies";
import { createRouteSupabaseClient } from "@/lib/supabase/route";
import { signinSchema } from "@/lib/validation/auth";

/**
 * Sign in — the way back into an account that already exists.
 *
 * Without it the product is usable once per browser. Every screen behind the
 * shell sends a caller with no session to an auth screen, and signup is not one
 * a returning user can use: Supabase answers `signUp` for a known address with
 * a response deliberately indistinguishable from a new one and carrying **no
 * session**, so that the endpoint cannot be used to enumerate accounts.
 *
 * **No session check before the body, and that is deliberate.** Gating this on
 * "already signed in" would refuse the two callers who most need it: someone
 * switching accounts, and -- far more common -- someone holding auth cookies
 * whose refresh token has been revoked or has expired. That second caller has
 * cookies and no usable session, and refusing them is exactly the lockout this
 * route exists to end. The "you are already signed in" case is handled where it
 * belongs, on the page, which redirects rather than rendering a form.
 */

/** Where a signed-in user goes when their company exists, and when it does not. */
export const AFTER_SIGNIN_PATH = "/";
export const RESUME_REGISTRATION_PATH = "/company/new";

/**
 * One message for every failure, and never a more specific one.
 *
 * "No such account" and "wrong password" as separate messages is an
 * account-existence oracle that anyone can query at form speed. The
 * confirmation hint is folded into the same sentence so the message stays
 * useful without splitting into two.
 */
const REFUSED =
  "That email address and password do not match a confirmed account. " +
  "If you have just signed up, open the confirmation link in your inbox first.";

export async function POST(request: Request) {
  const parsed = await readJson(request, signinSchema);
  if (!parsed.ok) return parsed.response;

  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data?.session) {
    if (error?.status === 429) {
      return NextResponse.json(
        {
          error: "Too many sign-in attempts. Wait a few minutes and try again.",
          fields: {},
          rateLimited: true,
        },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: REFUSED, fields: {} }, { status: 401 });
  }

  // Where to land, decided here rather than by the browser. A half-registered
  // user -- signed up, company insert failed, browser closed -- must come back
  // to the registration form, not to a dashboard whose shell has no company.
  let next: string = AFTER_SIGNIN_PATH;
  try {
    if (!(await getOwnedCompany(supabase))) next = RESUME_REGISTRATION_PATH;
  } catch (cause) {
    logFailure("api/auth/signin:getOwnedCompany", cause);
    return serverError();
  }

  return NextResponse.json({ next }, { status: 200 });
}
