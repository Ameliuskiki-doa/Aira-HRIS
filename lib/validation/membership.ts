import { z } from "zod";

/**
 * The company-switch boundary.
 *
 * One field, and `.strict()` still matters: the request body is the only thing
 * a caller controls on this path, and an unknown key is far more likely to be
 * a renamed field than a typo. Rejecting it turns "the switch silently did
 * nothing" into a 400 with a message.
 *
 * `companyId` is validated as a UUID here and validated again by the database
 * — `switch_company()` takes a `uuid`, and refuses outright when the caller
 * holds no active membership in it. That second wall is the real one. This one
 * exists so a malformed id comes back as a 400 the form can render rather than
 * as a 500 carrying Postgres' text.
 *
 * There is deliberately no `role` and no `tenantId` in this schema, and there
 * never will be: neither is writable from a request path at all. See the
 * migration.
 */
export const companySwitchSchema = z
  .object({
    companyId: z.uuid("Choose a company to switch to."),
  })
  .strict();

export type CompanySwitchInput = z.infer<typeof companySwitchSchema>;
