"use client";

import { useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A labelled input, with the accessibility wiring done once.
 *
 * shadcn ships no field primitive in this repository, and the two forms this
 * story adds would otherwise repeat the same four bindings eight times: the
 * label's `htmlFor`, the input's `id`, `aria-describedby` pointing at the hint
 * *and* the error, and `aria-invalid`. Repeating them is how one of them ends
 * up missing on the one field that fails validation.
 *
 * The error is announced rather than merely rendered: `role="alert"` is what
 * makes a screen reader say the message when it appears after a submit, and a
 * message a screen-reader user has to go hunting for is not a message.
 */
export type FormFieldProps = {
  readonly label: string;
  /** Rendered under the label. Say what an optional field is *for*. */
  readonly hint?: ReactNode;
  readonly error?: string | null;
  /** Marked visually and to assistive tech; optional fields say so in words. */
  readonly required?: boolean;
  readonly children: (props: {
    id: string;
    "aria-describedby": string | undefined;
    "aria-invalid": boolean | undefined;
    required: boolean;
  }) => ReactNode;
};

export function FormField({
  label,
  hint,
  error,
  required = false,
  children,
}: FormFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div data-slot="form-field" className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium">
        {label}
        {!required && (
          <span className="text-ui-muted ml-1.5 font-normal">optional</span>
        )}
      </label>
      {hint && (
        <p id={hintId} className="text-ui-muted text-2xs">
          {hint}
        </p>
      )}
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        required,
      })}
      {error && (
        <p id={errorId} role="alert" className="text-destructive text-2xs">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The input and select share one visual definition so a form does not drift
 * into two shapes of control. `aria-invalid` drives the error border, which is
 * why nothing here needs an `isInvalid` prop of its own.
 */
export const controlClassName = cn(
  "bg-background border-input h-8 w-full rounded-lg border px-2.5 text-sm",
  "focus-visible:border-ring focus-visible:ring-ring/50 outline-none focus-visible:ring-3",
  "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
  "disabled:pointer-events-none disabled:opacity-50",
);
