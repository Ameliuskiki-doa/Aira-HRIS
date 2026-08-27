/**
 * The shell's subject: what is now real, and what is still a placeholder.
 *
 * Story 1.3 built the frame with nothing behind it. Story 1.5 puts a company
 * there, and the seam moved rather than disappearing — so this module now says
 * explicitly which of the header's five facts come from the database and which
 * are still invented:
 *
 *   legalName        REAL — `companies.legal_name`
 *   timeZone         REAL — `companies.timezone`
 *   planLabel        REAL — derived from `organizations.plan`
 *   branchCount      FIXTURE — `branches` does not exist until Story 1.7
 *   membershipCount  FIXTURE — `memberships` does not exist until Story 1.6
 *   user (all of it) FIXTURE — `auth.users` carries an email, not a name and
 *                    not a role; the role lives on a membership, so both wait
 *                    for Story 1.6
 *
 * `SHELL_COMPANY_FIXTURE` stays because the browser suite measures the frame
 * against a fully-populated company, including the branch count the switcher
 * only renders above zero. A real company registered today has none.
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
  /** Active memberships this user holds. 1 means no switcher menu at all. */
  readonly membershipCount: number;
};

export type ShellUser = {
  readonly name: string;
  /** The membership role, rendered in Indonesian rather than as the enum. */
  readonly role: string;
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
 * The shell's company for a signed-in owner.
 *
 * Real where a real value exists, and a stated placeholder where one does not
 * — `branchCount: 0` is not a guess, it is the truth for a company registered
 * minutes ago, and the switcher already drops a zero rather than rendering
 * "0 branches" beside the name. `membershipCount: 1` is the fixture half: the
 * switcher hardcodes the one-membership form and the multi-company panel is
 * Story 1.6's, so a value above 1 would render the wrong thing today.
 */
export const shellCompanyFor = (source: ShellCompanySource): ShellCompany => ({
  legalName: source.legalName,
  timeZone: source.timeZone,
  planLabel: planLabel(source.plan),
  // FIXTURE. Story 1.7 creates `branches`; until then every company has none.
  branchCount: 0,
  // FIXTURE. Story 1.6 creates `memberships`.
  membershipCount: 1,
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

/**
 * Still entirely a fixture, and stated as one.
 *
 * `auth.users` carries an email address. It does not carry a person's name,
 * and a role is a property of a membership, which has no table until Story
 * 1.6. Deriving a display name from the email would be an invention wearing
 * the clothes of real data, which is worse than an obvious placeholder.
 */
export const SHELL_USER_FIXTURE: ShellUser = {
  name: "Sari Wijaya",
  role: "HR Manager",
  initials: "SW",
};
