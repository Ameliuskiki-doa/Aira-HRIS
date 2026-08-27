"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { controlClassName, FormField } from "@/components/app/form-field";
import { Button } from "@/components/ui/button";
import {
  COMPANY_TIME_ZONES,
  DEFAULT_COMPANY_TIME_ZONE,
} from "@/lib/domain/timezones";

/**
 * Register the company — the write that turns a confirmed account into a
 * tenant.
 *
 * One legal name is required and three identifiers are not, and that split is
 * a deliberate reading of who is signing up: a PT that has just been formed
 * has its deed and very little else, and being made to invent an NPWP to get
 * past a form is how a self-serve product loses the customer at the door. A
 * blank identifier is stored as null, not as "", so nothing later prints an
 * empty string where a tax number belongs.
 *
 * NPWP, NPP BPJS and BPJS Kesehatan keep their Indonesian names. They are
 * legal terms, not jargon to be translated.
 *
 * The submit posts to a route handler (AD-15 — no Server Actions), which
 * validates with Zod and then makes the whole registration in one transaction.
 */

type ApiError = {
  error?: string;
  fields?: Record<string, string>;
};

export function CompanyRegistrationForm() {
  const router = useRouter();
  const [values, setValues] = useState({
    legalName: "",
    npwp: "",
    nppBpjsTk: "",
    bpjsKesCode: "",
    timeZone: DEFAULT_COMPANY_TIME_ZONE as string,
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const set = (key: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setFields({});

    try {
      const response = await fetch("/api/companies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiError;
        setFields(body.fields ?? {});
        setFormError(body.error ?? "The company could not be registered.");
        return;
      }

      const result = (await response.json()) as {
        created: boolean;
        legalName: string;
      };

      if (!result.created) {
        // The registration resumed rather than being created, so the name that
        // was just typed is **not** the name that exists. Two tabs submitting
        // at once serialise in the database and the loser gets the winner's
        // company back; saying "done" here would be saying it about a name
        // that was discarded.
        setFormError(
          `A company is already registered on this account as ${result.legalName}. ` +
            `Taking you to it — the details you just entered were not saved.`,
        );
      }

      // `refresh()` before `push()`: the shell's company comes from the server
      // layout, and without the refresh the dashboard renders with the shell
      // still saying no company has been registered.
      router.refresh();
      router.push("/");
    } catch {
      setFormError("Aira could not be reached. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      data-slot="company-registration-form"
      onSubmit={onSubmit}
      className="flex max-w-120 flex-col gap-4"
      noValidate
    >
      {formError && (
        <p
          data-slot="form-error"
          role="alert"
          className="border-border text-destructive rounded-lg border p-2.5 text-xs"
        >
          {formError}
        </p>
      )}

      <FormField label="Legal name" required error={fields.legalName}>
        {(field) => (
          <input
            {...field}
            className={controlClassName}
            name="legalName"
            placeholder="PT Nusantara Rasa"
            value={values.legalName}
            onChange={(event) => set("legalName")(event.target.value)}
          />
        )}
      </FormField>

      <FormField
        label="NPWP"
        hint="The company's tax number. Add it later from Configuration if you do not have it yet."
        error={fields.npwp}
      >
        {(field) => (
          <input
            {...field}
            className={controlClassName}
            name="npwp"
            value={values.npwp}
            onChange={(event) => set("npwp")(event.target.value)}
          />
        )}
      </FormField>

      <FormField
        label="NPP BPJS Ketenagakerjaan"
        hint="Your employer registration number with BPJS Ketenagakerjaan."
        error={fields.nppBpjsTk}
      >
        {(field) => (
          <input
            {...field}
            className={controlClassName}
            name="nppBpjsTk"
            value={values.nppBpjsTk}
            onChange={(event) => set("nppBpjsTk")(event.target.value)}
          />
        )}
      </FormField>

      <FormField
        label="BPJS Kesehatan code"
        hint="Your employer code with BPJS Kesehatan."
        error={fields.bpjsKesCode}
      >
        {(field) => (
          <input
            {...field}
            className={controlClassName}
            name="bpjsKesCode"
            value={values.bpjsKesCode}
            onChange={(event) => set("bpjsKesCode")(event.target.value)}
          />
        )}
      </FormField>

      <FormField
        label="Time zone"
        required
        hint="Where the working day starts and ends. Attendance and payroll periods are resolved in this zone, never the server's."
        error={fields.timeZone}
      >
        {(field) => (
          <select
            {...field}
            className={controlClassName}
            name="timeZone"
            value={values.timeZone}
            onChange={(event) => set("timeZone")(event.target.value)}
          >
            {COMPANY_TIME_ZONES.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.zone} ({zone.offset}) · {zone.region}
              </option>
            ))}
          </select>
        )}
      </FormField>

      <Button type="submit" disabled={submitting} className="mt-1 self-start">
        {submitting ? "Registering…" : "Register company"}
      </Button>
    </form>
  );
}
