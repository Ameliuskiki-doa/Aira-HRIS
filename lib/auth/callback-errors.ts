/**
 * What went wrong with a confirmation link, in words a person can act on.
 *
 * A confirmation link is single-use and time-limited, so "expired" and
 * "already used" are the two ordinary outcomes, not exotic ones — a user who
 * clicks the link twice, or opens the email the next morning, lands here. The
 * matrix is explicit that this must be a stated error rather than a blank
 * screen, which is what happens when a callback silently redirects on failure.
 *
 * Keyed by a short code so the callback can put one in a query string without
 * putting Supabase's raw message in the address bar.
 */
export const CALLBACK_ERRORS = {
  link_expired:
    "That confirmation link has expired or has already been used. Sign up again with the same email address to get a new one.",
  link_missing:
    "That link is missing its confirmation code, so there is nothing to confirm. Open the link straight from the email rather than retyping it.",
  link_rejected:
    "Aira could not confirm that link. It may have expired, been used already, or been opened in a different browser than the one you signed up in.",
} as const;

export type CallbackErrorCode = keyof typeof CALLBACK_ERRORS;

export const isCallbackErrorCode = (value: unknown): value is CallbackErrorCode =>
  typeof value === "string" && value in CALLBACK_ERRORS;

/** The message for a code, or null when the code is unrecognised. */
export const callbackErrorMessage = (value: unknown): string | null =>
  isCallbackErrorCode(value) ? CALLBACK_ERRORS[value] : null;
