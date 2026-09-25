/**
 * The brochure library, and who gets which.
 *
 * Linked, never attached. The largest of these is 27MB; base64 in transit makes
 * it roughly 37MB, which is over Gmail's limit, over Outlook's, and far over
 * what most corporate gateways accept. A link also means a corrected brochure
 * reaches everyone, while an attachment is wrong forever in every inbox it
 * already landed in.
 */

export interface Brochure {
  /** File name under the configured base URL. */
  file: string;
  title: string;
  /** A few words, so the reader knows why they would open it. */
  description: string;
  /**
   * Product codes this brochure answers for.
   *
   * Empty means it suits anybody, and is used when a visitor ticked nothing in
   * particular.
   */
  interests: string[];
}

export const BROCHURES: Brochure[] = [
  {
    file: 'All_product.pdf',
    title: 'Our products at a glance',
    description: 'everything we offer, in two pages',
    interests: [],
  },
  {
    file: 'All_TradeInvest_Products.pdf',
    title: 'Trade & Invest',
    description: 'our full trading and investment services',
    interests: [
      'EQUITY',
      'EQUITY_DELIVERY',
      'EQUITY_INTRADAY',
      'DERIVATIVES',
      'COMMODITY',
      'CURRENCY',
      'IPO',
    ],
  },
  {
    file: 'Wealth.pdf',
    title: 'Wealth Management',
    description: 'portfolio planning for long-term goals',
    interests: ['PMS', 'MUTUAL_FUNDS', 'BONDS', 'INSURANCE'],
  },
  {
    file: 'AIF.pdf',
    title: 'Alternative Investment Funds',
    description: 'AIF strategies for qualified investors',
    interests: ['AIF', 'PMS'],
  },
  {
    file: 'Global.pdf',
    title: 'SIHL Global',
    description: 'investing in international markets from India',
    interests: ['NRI'],
  },
  {
    file: 'Algofy.pdf',
    title: 'Algofy',
    description: 'exchange-approved algorithmic strategies',
    interests: ['ALGO', 'DERIVATIVES'],
  },
  {
    file: 'Partner_Program.pdf',
    title: 'Partner Programme',
    description: 'build your practice with SIHL behind you',
    interests: ['PARTNER'],
  },
  {
    file: 'Ezee_Partners.pdf',
    title: 'Ezee for Partners',
    description: 'a one-page introduction for prospective partners',
    interests: ['PARTNER'],
  },
];

/** Nobody wants eight. Two relevant ones get read; eight get ignored. */
const MAX_BROCHURES = 2;

/**
 * The brochures worth sending to one visitor.
 *
 * Matched against what they actually ticked at registration. A visitor who
 * ticked nothing gets the general overview rather than nothing at all — the
 * point of the email is to tell them what we do.
 */
export function brochuresFor(productInterest: string[]): Brochure[] {
  const wanted = new Set(productInterest);

  const matched = BROCHURES.filter(
    (brochure) =>
      brochure.interests.length > 0 && brochure.interests.some((code) => wanted.has(code)),
  );

  const general = BROCHURES.filter((brochure) => brochure.interests.length === 0);

  // Matches first, then the general overview to fill the remaining place.
  const chosen = [...matched, ...general].slice(0, MAX_BROCHURES);
  return chosen.length > 0 ? chosen : general;
}

/** A full URL, from wherever the library is hosted today. */
export function brochureUrl(baseUrl: string, file: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${file}`;
}
