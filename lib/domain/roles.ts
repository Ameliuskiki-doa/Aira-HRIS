/**
 * The membership role set, and what to call each one on screen.
 *
 * Pure and total, like everything in `lib/domain`: no I/O, no clock, no
 * database client. It is imported by the route boundary, by the shell, and
 * (later) by the worker, which is why it lives here rather than beside any one
 * of them.
 *
 * **Fixed and not tenant-customisable** (AD-33). The same six values appear as
 * a check constraint on `memberships.role`, and the constraint is the wall
 * that matters — this list exists so the two cannot disagree without a test
 * noticing, and so a label is written once instead of in each screen that
 * renders one.
 *
 * `owner` is deliberately absent. It is not a membership role: it lives above
 * the tenant boundary, on `organizations.owner_user_id`.
 *
 * The tiers behind these names are not decoration either. `hr_staff` is a
 * separate tier from `admin`/`hr_manager` precisely because it must not see
 * salary; `staff` sees only its own row; `supervisor` sees the employees whose
 * current assignment names them as manager; `accountant` is external and
 * carries a null `employee_id`. Those rules are enforced by policy from Story
 * 1.8 onward — this module only names them.
 */

export const MEMBERSHIP_ROLES = [
  "admin",
  "hr_manager",
  "hr_staff",
  "supervisor",
  "staff",
  "accountant",
] as const;

export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

/**
 * Display names. Interface copy is English (the epic's acceptance criterion
 * says so); Indonesian regulatory terms stay Indonesian, and none of these six
 * is one.
 */
const ROLE_LABELS: Record<MembershipRole, string> = {
  admin: "Admin",
  hr_manager: "HR Manager",
  hr_staff: "HR Staff",
  supervisor: "Supervisor",
  staff: "Staff",
  accountant: "Accountant",
};

/**
 * The label for a role, or the raw value when it is not one of the six.
 *
 * Falls through to itself rather than to a default, on the same reasoning as
 * `planLabel`: a role added to the check constraint and not to this map should
 * read as unfamiliar, not as "Staff". Null in, null out — a session with no
 * membership has no role, and inventing one would put a permission on screen
 * that the database does not grant.
 */
export function roleLabel(role: string | null | undefined): string | null {
  if (!role) return null;
  return ROLE_LABELS[role as MembershipRole] ?? role;
}

/** Whether a value is one of the six the database will accept. */
export const isMembershipRole = (value: unknown): value is MembershipRole =>
  typeof value === "string" && (MEMBERSHIP_ROLES as readonly string[]).includes(value);
