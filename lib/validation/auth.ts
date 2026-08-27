import { z } from "zod";

/**
 * The signup boundary.
 *
 * Two fields, both required, and `.strict()` so nothing else rides along —
 * a client that posts `{ email, password, role: "admin" }` is refused rather
 * than quietly having the extra key ignored.
 *
 * The password floor is 8. Supabase's own default is 6; raising it here is
 * cheap and the boundary is the only place it can be stated once for every
 * caller.
 */
export const signupSchema = z
  .object({
    /**
     * Trimmed *before* the format check, not after: a pasted address with a
     * leading space is a typing accident, not an invalid address, and
     * `.email().trim()` would reject it because the format check runs first.
     */
    email: z
      .string("Enter a valid email address.")
      .trim()
      .max(254, "That email address is too long.")
      .pipe(z.email("Enter a valid email address.")),
    password: z
      .string("A password is required.")
      .min(8, "Use at least 8 characters.")
      .max(72, "Passwords are limited to 72 characters."),
  })
  .strict();

export type SignupInput = z.infer<typeof signupSchema>;

/**
 * The sign-in boundary.
 *
 * Deliberately **not** `signupSchema`. The 8-character floor belongs at
 * account creation, where it changes what exists; applied here it would lock
 * out anyone whose password predates the rule — a rule tightened later would
 * silently turn working accounts into unusable ones, and the user would be
 * told their password was wrong. All this needs to know is that a password was
 * supplied at all; whether it is correct is Supabase's answer, not ours.
 */
export const signinSchema = z
  .object({
    email: z
      .string("Enter a valid email address.")
      .trim()
      .max(254, "That email address is too long.")
      .pipe(z.email("Enter a valid email address.")),
    password: z.string("A password is required.").min(1, "A password is required."),
  })
  .strict();

export type SigninInput = z.infer<typeof signinSchema>;
