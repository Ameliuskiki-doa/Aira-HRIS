import { redirect } from "next/navigation";

import { CompanyRegistrationForm } from "@/components/company/company-registration-form";
import { currentCompany } from "@/lib/auth/session";

export const metadata = { title: "Register your company" };

/**
 * Register the company.
 *
 * Where the confirmation link lands. The session already exists by the time
 * this renders — the callback exchanged the code for one, and the layout above
 * refuses to render without it.
 *
 * A user who already has a company is sent to the dashboard rather than shown
 * a form that would resume rather than create. The RPC behind the form is
 * idempotent either way; this is so the screen does not *invite* a second
 * registration that would silently do nothing.
 */
export default async function Page() {
  if (await currentCompany()) redirect("/");

  return (
    <>
      <h1 className="text-xl font-medium tracking-tight">Register your company</h1>
      <p className="text-ui-body max-w-prose text-xs">
        One legal entity, which becomes your workspace. Only the legal name is
        required — the tax and BPJS identifiers can be added later from
        Configuration.
      </p>
      <CompanyRegistrationForm />
    </>
  );
}
