import { z } from "zod";

import {
  COMPANY_TIME_ZONE_IDS,
  DEFAULT_COMPANY_TIME_ZONE,
} from "@/lib/domain/timezones";

/**
 * The company-registration boundary.
 *
 * Every field the route handler will hand to the database is declared here,
 * and nothing else: `.strict()` rejects an unknown key rather than dropping
 * it, so a renamed field fails loudly instead of silently registering a
 * company with a missing NPWP.
 *
 * Required and optional are not stylistic here. `legal_name` is `not null` in
 * the schema and is the name that appears on a payslip; the three identifiers
 * are genuinely absent for a young PT and are stored null rather than as an
 * empty string, because "" and "not provided" are different facts and only one
 * of them should ever be printed.
 *
 * Indonesian regulatory names — NPWP, NPP BPJS, BPJS Kesehatan — are kept in
 * Indonesian on purpose. They are legal terms, not translatable jargon.
 */

/** Blank, absent or null all mean "not provided", and all store as null. */
const optionalIdentifier = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters.`)
    .nullish()
    .transform((value) => (value ? value : null));

export const companyRegistrationSchema = z
  .object({
    /**
     * `.trim()` runs before `.min(1)`, so "   " is rejected rather than stored
     * as three spaces. The matrix calls that out explicitly.
     */
    legalName: z
      .string("Legal name is required.")
      .trim()
      .min(1, "Legal name is required.")
      .max(200, "Legal name must be at most 200 characters."),
    npwp: optionalIdentifier("NPWP", 32),
    nppBpjsTk: optionalIdentifier("NPP BPJS", 32),
    bpjsKesCode: optionalIdentifier("BPJS Kesehatan", 32),
    /**
     * Closed set, defaulted. Indonesia has **three legal zones spread over
     * four IANA identifiers** — `Asia/Pontianak` is West Kalimantan and is
     * also WIB — and conflating those two counts is what left a whole province
     * unable to register. An identifier outside the four is rejected here and
     * again by a check constraint on `companies.timezone`; the day boundary is
     * not a field to be lenient about.
     */
    timeZone: z
      .enum(COMPANY_TIME_ZONE_IDS, "Choose one of Indonesia's four time zone identifiers.")
      .default(DEFAULT_COMPANY_TIME_ZONE),
  })
  .strict();

export type CompanyRegistrationInput = z.infer<typeof companyRegistrationSchema>;
