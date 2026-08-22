import { z } from 'zod';

/**
 * The client profile a rep builds up over time.
 *
 * Everything here is optional, and that is the design rather than laziness. A
 * lead is created from a phone call where somebody gave their name and number;
 * occupation, income and family come out over weeks, if at all. A form that
 * demanded them would be filled with guesses, and a guessed income is worse
 * than a blank one because it looks like a fact.
 *
 * This is engagement context, not a regulated record. ADR-0002 applies: income
 * and holdings recorded here are what a client told a salesperson, not
 * verified financials — the back office and the KYC system hold anything that
 * has to be true.
 */

/** Bands as the business specified them, not invented here. */
export const ANNUAL_INCOME_BANDS = [
  'UNDER_1L',
  'ONE_TO_5L',
  'FIVE_TO_10L',
  'TEN_TO_25L',
  'TWENTYFIVE_TO_50L',
  'ABOVE_50L',
] as const;
export type AnnualIncomeBand = (typeof ANNUAL_INCOME_BANDS)[number];

export const ANNUAL_INCOME_LABELS: Record<AnnualIncomeBand, string> = {
  UNDER_1L: 'Under ₹1 L',
  ONE_TO_5L: '₹1 L – 5 L',
  FIVE_TO_10L: '₹5 L – 10 L',
  TEN_TO_25L: '₹10 L – 25 L',
  TWENTYFIVE_TO_50L: '₹25 L – 50 L',
  ABOVE_50L: '₹50 L and above',
};

export const MEDICLAIM_BANDS = ['NONE', 'ONE_TO_5L', 'FIVE_TO_10L', 'TEN_TO_25L', 'ABOVE_25L'] as const;
export type MediclaimBand = (typeof MEDICLAIM_BANDS)[number];

export const MEDICLAIM_LABELS: Record<MediclaimBand, string> = {
  NONE: 'No cover',
  ONE_TO_5L: '₹1 L – 5 L',
  FIVE_TO_10L: '₹5 L – 10 L',
  TEN_TO_25L: '₹10 L – 25 L',
  ABOVE_25L: 'Above ₹25 L',
};

/**
 * Appetite for risk, in the client's own estimation.
 *
 * Not a suitability assessment. SEBI-regulated risk profiling is a separate
 * exercise with its own questionnaire and record-keeping, and nothing here
 * substitutes for it — this is a salesperson's note about which conversations
 * are worth having.
 */
export const RISK_CATEGORIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export const RISK_LABELS: Record<RiskCategory, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
};

/**
 * What the client already holds elsewhere.
 *
 * A multi-select of codes rather than a row per holding with an amount: the
 * business listed these as things a client has, not as a portfolio to value.
 * Amounts a rep half-remembers from a conversation would be treated as a
 * valuation the moment they appeared in a column.
 */
export const EXISTING_INVESTMENTS = [
  'FD',
  'DIRECT_EQUITY',
  'MUTUAL_FUNDS',
  'SIP',
  'BONDS',
  'INSURANCE',
  'PROPERTY',
  'GOLD',
  'OTHER',
] as const;
export type ExistingInvestment = (typeof EXISTING_INVESTMENTS)[number];

export const EXISTING_INVESTMENT_LABELS: Record<ExistingInvestment, string> = {
  FD: 'Fixed deposits',
  DIRECT_EQUITY: 'Direct equity',
  MUTUAL_FUNDS: 'Mutual funds',
  SIP: 'SIP',
  BONDS: 'Bonds',
  INSURANCE: 'Insurance',
  PROPERTY: 'Property',
  GOLD: 'Gold',
  OTHER: 'Other',
};

export const FAMILY_RELATIONS = [
  'SPOUSE',
  'SON',
  'DAUGHTER',
  'FATHER',
  'MOTHER',
  'BROTHER',
  'SISTER',
  'OTHER',
] as const;
export type FamilyRelation = (typeof FAMILY_RELATIONS)[number];

export const FAMILY_RELATION_LABELS: Record<FamilyRelation, string> = {
  SPOUSE: 'Spouse',
  SON: 'Son',
  DAUGHTER: 'Daughter',
  FATHER: 'Father',
  MOTHER: 'Mother',
  BROTHER: 'Brother',
  SISTER: 'Sister',
  OTHER: 'Other',
};

export const MARITAL_STATUSES = ['MARRIED', 'UNMARRIED'] as const;
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];

/**
 * Money a rep types from memory after a meeting.
 *
 * A string, like every other rupee value that crosses the wire, so it never
 * passes through a float. Nine digits before the decimal is more than any
 * monthly figure needs and stops a mistyped income becoming a headline.
 */
const rupeeAmountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, 'Enter an amount like 45000 or 45000.50')
  .refine((value) => Number(value) >= 0, 'An amount cannot be negative');

export const familyMemberSchema = z.object({
  relation: z.enum(FAMILY_RELATIONS),
  name: z.string().trim().max(80).optional(),
  occupation: z.string().trim().max(80).optional(),
  location: z.string().trim().max(80).optional(),
  maritalStatus: z.enum(MARITAL_STATUSES).optional(),
});
export type FamilyMemberInput = z.infer<typeof familyMemberSchema>;

export const leadProfileSchema = z.object({
  occupation: z.string().trim().max(120).optional(),
  companyName: z.string().trim().max(160).optional(),
  designation: z.string().trim().max(120).optional(),

  riskCategory: z.enum(RISK_CATEGORIES).optional(),

  monthlyIncome: rupeeAmountSchema.optional(),
  annualIncomeBand: z.enum(ANNUAL_INCOME_BANDS).optional(),
  monthlySip: rupeeAmountSchema.optional(),
  monthlyEmi: rupeeAmountSchema.optional(),

  investmentGoal: z.string().trim().max(400).optional(),

  existingInvestments: z.array(z.enum(EXISTING_INVESTMENTS)).max(9).optional(),
  insuranceCover: rupeeAmountSchema.optional(),
  mediclaimBand: z.enum(MEDICLAIM_BANDS).optional(),
  otherInvestments: z.string().trim().max(300).optional(),

  /**
   * Capped at a number no household exceeds in practice. The limit exists so a
   * malformed submission cannot write thousands of rows, not because a large
   * family is unusual.
   */
  familyMembers: z.array(familyMemberSchema).max(12).optional(),
});
export type LeadProfileInput = z.infer<typeof leadProfileSchema>;

export interface LeadProfileView {
  occupation: string | null;
  companyName: string | null;
  designation: string | null;
  riskCategory: RiskCategory | null;
  /** Strings, as stored. Formatting is the caller's business. */
  monthlyIncome: string | null;
  annualIncomeBand: AnnualIncomeBand | null;
  monthlySip: string | null;
  monthlyEmi: string | null;
  investmentGoal: string | null;
  existingInvestments: ExistingInvestment[];
  insuranceCover: string | null;
  mediclaimBand: MediclaimBand | null;
  otherInvestments: string | null;
  familyMembers: Array<{
    id: string;
    relation: FamilyRelation;
    name: string | null;
    occupation: string | null;
    location: string | null;
    maritalStatus: MaritalStatus | null;
  }>;
  updatedAt: string | null;
}

/**
 * Whether a profile holds anything worth showing.
 *
 * Used to decide between rendering the section and rendering nothing: an empty
 * profile card with fourteen dashes tells a reader less than its absence does.
 */
export function hasProfileContent(profile: LeadProfileView | null | undefined): boolean {
  if (!profile) return false;

  return Boolean(
    profile.occupation ||
      profile.companyName ||
      profile.designation ||
      profile.riskCategory ||
      profile.monthlyIncome ||
      profile.annualIncomeBand ||
      profile.monthlySip ||
      profile.monthlyEmi ||
      profile.investmentGoal ||
      profile.existingInvestments.length > 0 ||
      profile.insuranceCover ||
      profile.mediclaimBand ||
      profile.otherInvestments ||
      profile.familyMembers.length > 0,
  );
}
