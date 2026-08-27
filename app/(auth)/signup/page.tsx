import { SignupForm } from "@/components/auth/signup-form";
import { callbackErrorMessage } from "@/lib/auth/callback-errors";

export const metadata = { title: "Sign up" };

/**
 * Sign up by email.
 *
 * Also where a failed confirmation lands: the callback redirects here with an
 * `error` code rather than leaving the user on a blank screen, and the code is
 * translated into a sentence here so the raw Supabase message never appears in
 * the address bar.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const linkError = callbackErrorMessage(params.error);

  return <SignupForm linkError={linkError} />;
}
