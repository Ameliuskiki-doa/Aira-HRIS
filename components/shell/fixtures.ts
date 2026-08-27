/**
 * The shell's placeholder subject.
 *
 * Story 1.3 builds the frame and nothing behind it: there is no data layer, no
 * Supabase and no auth until Stories 1.5 and 1.6. The header still has to
 * render a company and a person, so it renders these — kept in one module,
 * clearly named, so the seam is a single import to delete rather than literals
 * scattered through the components.
 *
 * `membershipCount` is 1, which is the case the switcher is built for in this
 * story: one membership renders a plain label with no caret and no menu. The
 * multi-company panel is explicitly out of scope here.
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

export const SHELL_COMPANY_FIXTURE: ShellCompany = {
  legalName: "PT Nusantara Rasa",
  branchCount: 6,
  timeZone: "Asia/Jakarta",
  planLabel: "Paket Bisnis",
  membershipCount: 1,
};

export const SHELL_USER_FIXTURE: ShellUser = {
  name: "Sari Wijaya",
  role: "Manajer HR",
  initials: "SW",
};
