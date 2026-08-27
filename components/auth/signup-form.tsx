"use client";

import Link from "next/link";
import { useState } from "react";

import { controlClassName, FormField } from "@/components/app/form-field";
import { Button } from "@/components/ui/button";

/**
 * Sign up by email, and the screen that follows it.
 *
 * Two states in one component, because they are one screen to the user: the
 * form, and the "check your email" state it becomes. Splitting them across two
 * routes would lose the address the user just typed, which is the one piece of
 * information the second state exists to repeat back.
 *
 * The second state does **not** claim the user is signed in. Confirmation is
 * on, so signup produces a user row and no session; the company cannot be
 * created until the link is clicked. Saying otherwise would be a lie the very
 * next click exposes.
 */

export type SignupFormProps = {
  /** A message from a failed confirmation link, if the user arrived from one. */
  readonly linkError?: string | null;
};

type ApiError = {
  error?: string;
  fields?: Record<string, string>;
};

export function SignupForm({ linkError = null }: SignupFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setFields({});

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiError;
        setFields(body.fields ?? {});
        setFormError(body.error ?? "Something went wrong. Try again.");
        return;
      }

      setSentTo(email);
    } catch {
      setFormError("Aira could not be reached. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (sentTo !== null) {
    return (
      <div data-slot="check-your-email" className="flex flex-col gap-3">
        <h1 className="text-lg font-medium tracking-tight">Check your email</h1>
        {/*
          "If that address is not already registered" is not hedging — it is
          the only honest sentence available. Supabase answers identically for
          a new address and for one that is already registered and confirmed,
          and in the second case it deliberately sends nothing at all. That
          indistinguishability is what stops this screen being a way to test
          whether somebody has an Aira account, and it is worth keeping; what
          is not worth keeping is a screen that asserts a fact the server does
          not have.
        */}
        <p className="text-ui-body text-xs">
          If <strong>{sentTo}</strong> is not already registered, a confirmation
          link is on its way. Open it and you will land straight on the company
          registration form.
        </p>
        <p className="text-ui-body text-xs">
          Already have an account with that address?{" "}
          <Link href="/signin" className="hover:text-ui-link-hover underline underline-offset-2">
            Sign in instead
          </Link>{" "}
          — no new mail is sent for an address that is already confirmed.
        </p>
        {/*
          Stated, not hidden. Aira can send two confirmation emails an hour
          across the whole product right now — not per person — so a second
          attempt may genuinely not arrive. A user who is told this waits; a
          user who is not told it retries four times and concludes signup is
          broken.
        */}
        <p
          data-slot="email-budget-note"
          className="text-ui-muted border-border border-t pt-3 text-2xs"
        >
          One caveat worth knowing: Aira can currently send only two
          confirmation emails an hour in total, shared across everyone signing
          up. If nothing arrives within a few minutes, wait rather than
          retrying — a retry uses the same budget.
        </p>
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => setSentTo(null)}
        >
          Use a different email address
        </Button>
      </div>
    );
  }

  return (
    <form data-slot="signup-form" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-lg font-medium tracking-tight">Create your account</h1>
        <p className="text-ui-body text-xs">
          Sign up with your work email. You will register your company on the
          next screen.
        </p>
      </div>

      {linkError && (
        <p
          data-slot="link-error"
          role="alert"
          className="border-border text-destructive rounded-lg border p-2.5 text-xs"
        >
          {linkError}
        </p>
      )}

      {formError && (
        <p
          data-slot="form-error"
          role="alert"
          className="border-border text-destructive rounded-lg border p-2.5 text-xs"
        >
          {formError}
        </p>
      )}

      <FormField label="Email address" required error={fields.email}>
        {(field) => (
          <input
            {...field}
            className={controlClassName}
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        )}
      </FormField>

      <FormField
        label="Password"
        required
        hint="At least 8 characters."
        error={fields.password}
      >
        {(field) => (
          <input
            {...field}
            className={controlClassName}
            type="password"
            name="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        )}
      </FormField>

      <Button type="submit" disabled={submitting} className="mt-1 self-start">
        {submitting ? "Sending…" : "Create account"}
      </Button>

      <p className="text-ui-muted border-border border-t pt-3 text-2xs">
        Already confirmed your email?{" "}
        <Link href="/signin" className="hover:text-ui-link-hover underline underline-offset-2">
          Sign in
        </Link>
        .
      </p>
    </form>
  );
}
