import { NextResponse } from "next/server";

import { safeRedirectPath, trustedOrigin } from "@/lib/api/boundary";
import type { CallbackErrorCode } from "@/lib/auth/callback-errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route";

/**
 * Where the confirmation link lands.
 *
 * Email confirmation is **on**, so signup produces a user row and no session.
 * This is the only place a session comes into existence: the code in the link
 * is exchanged for one, the cookies are written on this response, and only
 * then can the company be created — until this runs, RLS has no `sub` to key
 * the insert on.
 *
 * A route handler rather than a page, because a page cannot write cookies
 * during render and the session *is* cookies.
 *
 * Every failure path ends at `/signup` carrying a code, never at a blank
 * screen. An expired or reused link is the ordinary case, not an exotic one.
 */

const SIGNUP_PATH = "/signup";
const DEFAULT_NEXT = "/company/new";

const failed = (origin: string, code: CallbackErrorCode) =>
  NextResponse.redirect(new URL(`${SIGNUP_PATH}?error=${code}`, origin));

export async function GET(request: Request) {
  const origin = trustedOrigin(request);
  const params = new URL(request.url).searchParams;

  // Supabase reports a dead link by redirecting here with an error, not by
  // withholding the code, so this branch comes first.
  const upstreamError = params.get("error") ?? params.get("error_code");
  if (upstreamError) {
    return failed(
      origin,
      /expired|used/i.test(params.get("error_description") ?? upstreamError)
        ? "link_expired"
        : "link_rejected",
    );
  }

  const code = params.get("code");
  if (!code) return failed(origin, "link_missing");

  const supabase = await createRouteSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return failed(origin, /expired|used|invalid/i.test(error.message) ? "link_expired" : "link_rejected");
  }

  // `safeRedirectPath` and not the raw parameter: `next` arrives in a URL the
  // user was mailed, so an absolute or protocol-relative value would turn the
  // confirmation link into an open redirect off a domain the user trusts.
  return NextResponse.redirect(
    new URL(safeRedirectPath(params.get("next"), DEFAULT_NEXT), origin),
  );
}
