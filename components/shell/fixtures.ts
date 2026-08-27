import { roleLabel } from "@/lib/domain/roles";

/**
 * The shell's subject: what is now real, and what is still a placeholder.
 *
 * Story 1.3 built the frame with nothing behind it. Story 1.5 put a company
 * there. Story 1.6 puts the person there — so this module now says explicitly
 * which of the header's facts come from the database and which are invented:
 *
 *   legalName        REAL — `companies.legal_name`
 *   timeZone         REAL — `companies.timezone`
 *   planLabel        REAL — derived from `organizations.plan`
 *   membershipCount  REAL — how many active memberships `switch_company()`
 *                    returned. 1 (or 0) means no switcher menu at all.
 *   user.role        REAL — `app_metadata.role`, put in the token by the
 *                    access token hook. No query: authorization never reads
 *                    `memberships` on a request path (AD-25).
 *   user.name        REAL, in the weak sense that it is the person's own email
 *                    address. See `shellUserFor` — the branch that resolves a
 *                    real name is written and is unreachable until Story 1.8.
 *   branchCount      FIXTURE — `branches` does not exist until Story 1.7
 *
 * `SHELL_COMPANY_FIXTURE` and `SHELL_USER_FIXTURE` stay because the browser
 * suite measures the frame against a fully-populated header, including the
 * branch count the switcher only renders above zero. A real company registered
 * today has none.
 */

export type ShellCompany = {
  /** `companies.legal_name`. Required by the data model. */
  readonly legalName: string;
  /** How many branches the company has. Shown beside the name because it is
   *  what distinguishes two similarly-named PTs. */
  readonly branchCount: number;
  /** `companies.timezone`, default `Asia/Jakarta`. Drives the header date. */
  readonly timeZone: string;
  /** The organisation's plan, shown under the brand mark. */
  readonly planLabel: string;
  /**
   * Active memberships this user holds. **1 or fewer means no switcher menu
   * at all** — a dropdown holding a single item is noise, and most tenants are
   * one PT. Derived from the same list the switcher renders, in
   * `shellCompanyFor`, so the count and the panel cannot disagree.
   */
  readonly membershipCount: number;
};

export type ShellUser = {
  /** The person's name, or — until Story 1.8 — their email address. */
  readonly name: string;
  /**
   * The membership role, rendered as a label rather than as the enum value.
   * **Null when the session carries no role**, which is every session with no
   * active membership. Rendering a permission the database does not grant
   * would be worse than rendering nothing.
   */
  readonly role: string | null;
  readonly initials: string;
};

/**
 * `organizations.plan` is one of `free`, `core` or `payroll` — a check
 * constraint says so — and none of those three is a phrase to put under a
 * wordmark. An unrecognised value falls through to itself rather than to a
 * default, so a plan added to the database and not to this map reads as
 * unfamiliar instead of silently reading as "Free plan".
 */
const PLAN_LABELS: Record<string, string> = {
  free: "Free plan",
  core: "Core plan",
  payroll: "Payroll plan",
};

export const planLabel = (plan: string): string => PLAN_LABELS[plan] ?? plan;

/** The real facts the shell needs. Everything else is filled in below. */
export type ShellCompanySource = {
  readonly legalName: string;
  readonly timeZone: string;
  /** `organizations.plan`. */
  readonly plan: string;
};

/**
 * The shell's company for a signed-in user.
 *
 * Real where a real value exists, and a stated placeholder where one does not
 * — `branchCount: 0` is not a guess, it is the truth for a company registered
 * minutes ago, and the switcher already drops a zero rather than rendering
 * "0 branches" beside the name.
 *
 * `membershipCount` is derived from the list the switcher will render, and
 * that is deliberate: it is the value the switcher branches on, so computing
 * it from anything else would let the count say "two companies" while the
 * panel had one row in it.
 */
export const shellCompanyFor = (
  source: ShellCompanySource,
  membershipCount = 0,
): ShellCompany => ({
  legalName: source.legalName,
  timeZone: source.timeZone,
  planLabel: planLabel(source.plan),
  // FIXTURE. Story 1.7 creates `branches`; until then every company has none.
  branchCount: 0,
  membershipCount,
});

/**
 * The header between confirming an email and registering a company.
 *
 * That window is real — the callback lands the user inside the shell, on the
 * registration form — and the header still has to render something. It says
 * what is true rather than borrowing a fixture's company name.
 */
export const PENDING_SHELL_COMPANY: ShellCompany = {
  legalName: "No company yet",
  branchCount: 0,
  timeZone: "Asia/Jakarta",
  planLabel: "Get started",
  membershipCount: 0,
};

/**
 * A fully-populated company, used by the browser suite to measure the frame.
 *
 * Not reachable from the application: `app/(app)/layout.tsx` renders either a
 * real company or `PENDING_SHELL_COMPANY`.
 */
export const SHELL_COMPANY_FIXTURE: ShellCompany = {
  legalName: "PT Nusantara Rasa",
  branchCount: 6,
  timeZone: "Asia/Jakarta",
  planLabel: planLabel("core"),
  membershipCount: 1,
};

/** What the shell knows about the signed-in person. */
export type ShellUserSource = {
  /**
   * `employees.full_name` for the employee this membership points at.
   *
   * **Always null today, and the branch that consumes it is unreachable until
   * Story 1.8**, which is the story that creates `employees`. It is written
   * now rather than later because the fallback below only makes sense as a
   * fallback: a function that takes an email and returns it is not a name
   * resolver, and the next reader would have no reason to suspect one was
   * intended. Said here, where a reader will find it.
   */
  readonly fullName: string | null;
  /** `auth.users.email`. Every account has one — signup is by email (AD-7). */
  readonly email: string;
  /** `app_metadata.role` from the token, or null for no active membership. */
  readonly role: string | null;
};

/**
 * Two letters for the avatar.
 *
 * A person's name gives the first letter of the first and last words. A single
 * word gives its first two letters. Never empty: the avatar's fallback is the
 * only thing left below 768px, and a blank circle is not an identity.
 *
 * **An email address is initialled from its local part.** The domain belongs
 * to the company, not to the person — `hr@nusantara.co.id` split on every
 * separator reads as four words and initials as "HI", which is neither the
 * person nor the company. Taking `hr` gives "HR", and `sari.wijaya@…` gives
 * "SW". This branch is the live one until Story 1.8 provides a real name.
 */
export function initialsFor(name: string): string {
  const local = name.split("@")[0] ?? name;
  const words = local.trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

/**
 * The signed-in person, as the header renders them.
 *
 * The display name resolves to `employees.full_name` and falls back to the
 * email address. **In this story it always falls back**, because `employees`
 * arrives in Story 1.8 and `fullName` is therefore always null — the first
 * branch is written, correct, and unreachable. That is a deliberate seam and
 * not dead code: when 1.8 lands, the only change here is that the argument
 * stops being null.
 *
 * An email is a poor display name and a truthful one, which is the trade taken
 * over the alternative Story 1.3 used — a hardcoded "Sari Wijaya", an
 * invention wearing the clothes of real data.
 */
export const shellUserFor = (source: ShellUserSource): ShellUser => {
  const name = source.fullName?.trim() || source.email;
  return {
    name,
    role: roleLabel(source.role),
    initials: initialsFor(name),
  };
};

/**
 * A fully-populated person, used by the browser suite to measure the header.
 *
 * Not reachable from the application: `app/(app)/layout.tsx` builds a real one
 * with `shellUserFor`. It carries a name with two words and a role, because
 * those are the shapes the header's collapse behaviour is measured against.
 */
export const SHELL_USER_FIXTURE: ShellUser = {
  name: "Sari Wijaya",
  role: "HR Manager",
  initials: "SW",
};
