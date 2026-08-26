import { z } from 'zod';

import { codeSchema } from './common';

/**
 * Closing a product from the interaction form.
 *
 * Conversion used to live only on its own tab and demanded a PAN in the exact
 * ten-character format, plus an email. That is right when SIHL ONE is the first
 * place the account is opened, and wrong for what reps actually do: the account
 * is opened in the back office, the rep already has a client code, and being
 * asked for a PAN they would have to go and look up is what makes them close
 * the tab and record nothing at all.
 *
 * So either identifier will do, and neither is format-checked beyond being
 * present and plausible. The back office remains the authority on both — this
 * is a pointer to their record, not a copy of it (ADR-0002), and a rep mistyping
 * one digit should not be the reason a conversion goes unrecorded.
 */
export const CONVERSION_IDENTIFIER_KINDS = ['PAN', 'CLIENT_CODE'] as const;
export type ConversionIdentifierKind = (typeof CONVERSION_IDENTIFIER_KINDS)[number];

/**
 * Loose on purpose. A PAN is ten characters and a client code is whatever the
 * back office issues, so the only rules are: long enough to be a real
 * reference, short enough to fit the column, and no spaces in the middle.
 */
const identifierSchema = z
  .string()
  .trim()
  .min(4, 'Enter the PAN or the client code')
  .max(30)
  .transform((value) => value.toUpperCase())
  .refine((value) => !/\s/.test(value), 'A PAN or client code has no spaces in it');

/**
 * What the client actually put in, as the rep understands it.
 *
 * Distinct from the expected investment recorded against an interaction, which
 * is a forecast. This is the figure at the point of conversion. It is still not
 * a ledger number: the back office owns that, and this is labelled a recorded
 * figure everywhere it appears.
 */
export const MAX_FINAL_AMOUNT = 1_000_000_000;

export const convertProductSchema = z.object({
  productCode: codeSchema,
  identifier: identifierSchema,
  identifierKind: z.enum(CONVERSION_IDENTIFIER_KINDS),
  /** Sent as a string; it becomes a Decimal and is never a JavaScript number. */
  finalAmount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount, for example 250000 or 250000.50')
    .refine((value) => Number(value) <= MAX_FINAL_AMOUNT, 'That figure looks too large')
    .optional(),
  note: z.string().trim().max(1000).optional(),
});
export type ConvertProductInput = z.infer<typeof convertProductSchema>;

/**
 * A PAN is exactly ten characters in the shape AAAAA9999A. Used to guess which
 * kind of identifier was pasted, never to reject one — a client code that
 * happens to look like a PAN is still a client code if the rep says so.
 */
export function looksLikePan(value: string): boolean {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(value.trim().toUpperCase());
}

export function guessIdentifierKind(value: string): ConversionIdentifierKind {
  return looksLikePan(value) ? 'PAN' : 'CLIENT_CODE';
}
