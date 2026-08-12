/**
 * Fills the product master with the words a salesperson actually uses.
 *
 * The catalogue screen is only as good as this text, and the migration seeded
 * codes and names only — so every product rendered as an empty card. Written to
 * be read aloud: short benefit lines rather than paragraphs, charges phrased as
 * indicative because the back office owns pricing (ADR-0002), and SEBI risk
 * wording wherever it applies.
 *
 * Safe to re-run: only fills products that have no description yet, so
 * anything an administrator has since written is left alone.
 *
 *   npm run seed:products -w @sihl-one/api
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const CONTENT: Record<
  string,
  {
    summary: string;
    description: string;
    keyBenefits: string[];
    chargesSummary?: string;
    eligibility?: string;
    riskNote?: string;
  }
> = {
  EQUITY: {
    summary: 'Buy and sell shares on NSE and BSE from one account.',
    description:
      'A demat and trading account that lets a client hold shares in their own name and trade them on either exchange.\n\nSettlement is T+1, so money from a sale is available the next working day. Holdings sit with CDSL in the client’s name, not with SIHL.',
    keyBenefits: [
      'One account for both exchanges, with a single view of holdings',
      'Shares held in the client’s own name at CDSL',
      'Research and recommendations from the SIHL desk',
      'Same login on web and mobile',
    ],
    chargesSummary: 'Brokerage on delivery and intraday, plus statutory charges and annual demat maintenance.',
    eligibility: 'Any resident individual over 18 with a PAN, a bank account and Aadhaar-linked mobile.',
    riskNote:
      'Investments in securities are subject to market risks. The value of a holding can fall as well as rise, and past performance does not indicate future returns.',
  },
  DERIVATIVES: {
    summary: 'Futures and options on indices and stocks, with margin funding.',
    description:
      'Trading in equity derivatives on NSE, for clients who want to hedge a portfolio or take a leveraged view.\n\nRequires an income declaration, because leverage means losses can exceed the amount deposited.',
    keyBenefits: [
      'Index and single-stock futures and options',
      'Hedge an existing equity portfolio against a fall',
      'Margin reporting and position limits visible in the terminal',
    ],
    chargesSummary: 'Brokerage per lot, plus exchange transaction charges, STT and GST.',
    eligibility: 'Existing equity clients who have submitted an income proof and signed the derivatives risk disclosure.',
    riskNote:
      'Derivatives are leveraged instruments. Losses can exceed the margin deposited, and a client may be required to bring in additional funds at short notice. Not suitable for every investor.',
  },
  MUTUAL_FUNDS: {
    summary: 'Direct and regular plans across fund houses, with SIP.',
    description:
      'Investment in mutual fund schemes from a single account, including systematic investment plans.\n\nUnits are held in demat form alongside the client’s equity holdings, so the whole portfolio appears in one statement.',
    keyBenefits: [
      'SIP from a fixed date each month, stoppable at any time',
      'Units held in demat, in one portfolio view',
      'Switch between schemes without redeeming to bank first',
    ],
    chargesSummary: 'No brokerage on mutual fund transactions. The scheme’s own expense ratio applies.',
    eligibility: 'Any client with a completed KYC and a bank mandate for SIP.',
    riskNote:
      'Mutual fund investments are subject to market risks. Read all scheme related documents carefully before investing.',
  },
  IPO: {
    summary: 'Apply to public issues through UPI, from the same account.',
    description:
      'Applications to initial public offers using the client’s own UPI mandate, so funds stay blocked in their bank account until allotment.\n\nAllotted shares arrive directly in the client’s demat account.',
    keyBenefits: [
      'Funds stay in the client’s account until shares are allotted',
      'Apply from web or mobile up to the closing time',
      'Allotment status visible without checking the registrar',
    ],
    chargesSummary: 'No charge to apply. Standard brokerage applies when the shares are later sold.',
    eligibility: 'Any client with a demat account and a UPI ID on a bank supported by the exchange.',
    riskNote:
      'Allotment is not guaranteed and is subject to subscription. A listing price may be below the issue price.',
  },
};

async function main(): Promise<void> {
  let filled = 0;
  let skipped = 0;

  for (const [code, content] of Object.entries(CONTENT)) {
    const product = await prisma.product.findUnique({ where: { code } });
    if (!product) {
      console.log(`  ${code.padEnd(14)} not in the master — skipped`);
      continue;
    }
    if (product.description) {
      skipped += 1;
      continue;
    }

    await prisma.product.update({
      where: { code },
      data: {
        summary: content.summary,
        description: content.description,
        keyBenefits: content.keyBenefits,
        chargesSummary: content.chargesSummary ?? null,
        eligibility: content.eligibility ?? null,
        riskNote: content.riskNote ?? null,
      },
    });
    filled += 1;
  }

  const remaining = await prisma.product.count({ where: { isActive: true, description: null } });
  console.log(`Filled ${filled}, left alone ${skipped}.`);
  console.log(`${remaining} active products still have no details — write them in /admin/masters.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
