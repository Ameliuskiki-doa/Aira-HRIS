import { NextResponse } from "next/server";

import { logFailure, readJson, serverError, trustedOrigin } from "@/lib/api/boundary";
import { createRouteSupabaseClient } from "@/lib/supabase/route";
import { signupSchema } from "@/lib/validation/auth";

/**
 * Sign up by email.
 *
 * A route handler, not a Server Action (AD-15). Zod runs before anything
 * reaches Supabase, so an unparseable body never becomes an account.
 *
 * Confirmation is on, so this creates an `auth.users` row and **no session**.
 * The response says so plainly rather than pretending the user is signed in;
 * the company cannot be created until the link in the email is clicked,
 * because until then there is no `sub` for RLS to key on.
 */

/** Where the confirmation link lands. Relative; the origin is added below. */
export const SIGNUP_CALLBACK_PATH = "/auth/callback";

/** Where the callback sends a confirmed user. */
export const POST_CONFIRMATION_PATH = "/company/new";

/**
 * Supabase's own words for "you have asked for too many emails".
 *
 * Matched on the stable code first and the HTTP status second. The project
 * budget is **two confirmation emails per hour, across the whole project** --
 * not per user -- so this is reachable in ordinary testing and in a demo, and
 * the user is told what happened instead of being told signup failed.
 */
const RATE_LIMITED_CODES = new Set([
  "over_email_send_rate_limit",
  "over_request_rate_limit",
]);

export async function POST(request: Request) {
  const parsed = await readJson(request, signupSchema);
  if (!parsed.ok) return parsed.response;

  const supabase = await createRouteSupabaseClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${trustedOrigin(request)}${SIGNUP_CALLBACK_PATH}?next=${encodeURIComponent(POST_CONFIRMATION_PATH)}`,
    },
  });

  if (error) {
    if (RATE_LIMITED_CODES.has(error.code ?? "") || error.status === 429) {
      return NextResponse.json(
        {
          error:
            "Aira can only send two confirmation emails an hour in total right now, " +
            "and that budget is used up. Your account was not created — try again in an hour.",
          fields: {},
          rateLimited: true,
        },
        { status: 429 },
      );
    }
    logFailure("api/auth/signup", error);
    return serverError();
  }

  // Deliberately no session, and deliberately no claim about one.
  //
  // Nor a claim that mail was sent. Supabase returns this same shape whether
  // the address is new or already registered and confirmed -- and in the
  // second case it deliberately sends **nothing**. That indistinguishability
  // is the anti-enumeration design and is worth keeping; asserting
  // `emailSent: true` on top of it was simply a fact the server does not have.
  // `checkInbox` says what the *user* should do, which is true either way.
  return NextResponse.json(
    { checkInbox: true, email: parsed.data.email },
    { status: 202 },
  );
}
