"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { controlClassName, FormField } from "@/components/app/form-field";
import { Button } from "@/components/ui/button";

/**
 * Sign in.
 *
 * The route handler decides where a successful sign-in lands, not this
 * component: a user whose company registration never completed has to come
 * back to the registration form, and only the server can tell whether it did.
 * A hardcoded `push("/")` here would drop them on a dashboard whose shell says
 * "No company yet" with nothing to click.
 */

type ApiError = { error?: string; fields?: Record<string, string> };

export function SigninForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setFields({});

    try {
      const response = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiError;
        setFields(body.fields ?? {});
        setFormError(body.error ?? "Could not sign you in.");
        return;
      }

      const { next } = (await response.json()) as { next: string };
      // `refresh()` before `push()`: the shell reads the company on the server,
      // and without this the first render after signing in still has no session.
      router.refresh();
      router.push(next);
    } catch {
      setFormError("Aira could not be reached. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form data-slot="signin-form" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-lg font-medium tracking-tight">Sign in</h1>
        <p className="text-ui-body text-xs">
          Welcome back. Use the email address you confirmed when you signed up.
        </p>
      </div>

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

      <FormField label="Password" required error={fields.password}>
        {(field) => (
          <input
            {...field}
            className={controlClassName}
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        )}
      </FormField>

      <Button type="submit" disabled={submitting} className="mt-1 self-start">
        {submitting ? "Signing in…" : "Sign in"}
      </Button>

      <p className="text-ui-muted border-border border-t pt-3 text-2xs">
        No account yet?{" "}
        <Link href="/signup" className="hover:text-ui-link-hover underline underline-offset-2">
          Create one
        </Link>
        .
      </p>
    </form>
  );
}
