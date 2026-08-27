import { redirect } from "next/navigation";

import { SigninForm } from "@/components/auth/signin-form";
import { currentUser } from "@/lib/auth/session";

export const metadata = { title: "Sign in" };

/**
 * Sign in.
 *
 * The "already signed in" check lives here rather than in the route handler.
 * On the page it is a convenience — do not show a form to somebody who does
 * not need it. In the handler it would be a lockout: a caller holding auth
 * cookies whose refresh token has expired has cookies and no usable session,
 * and refusing them is the exact failure this screen exists to end.
 */
export default async function Page() {
  if (await currentUser()) redirect("/");

  return <SigninForm />;
}
