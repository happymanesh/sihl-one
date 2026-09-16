/**
 * Reconnect converted leads to the customer they actually produced.
 *
 * While `lead.customerId` was unique, converting a product for somebody who was
 * already a customer failed outright — the transaction rolled back and the lead
 * was left converted with no customer behind it. The constraint is gone (see
 * 20260916090000_lead_customer_not_unique) but the leads it stranded are still
 * stranded, and nothing repairs them on its own.
 *
 * Matching is done on the reference the rep recorded at conversion — the PAN or
 * client code on the lead's own converted product — never on a name or a mobile.
 * A mobile is shared by a family and a name is shared by thousands; attaching a
 * lead to the wrong client's record is far worse than leaving it unattached, so
 * anything that does not match exactly on an identifier is reported and skipped.
 *
 *   npx tsx prisma/relink-converted-leads.ts            # report only
 *   npx tsx prisma/relink-converted-leads.ts --apply    # write the links
 *
 * Writes nothing but `lead.customerId`, and only where it is currently null.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';

import { PrismaClient } from '../src/generated/prisma/client';

config();

const APPLY = process.argv.includes('--apply');

interface Candidate {
  leadReference: string;
  leadId: string;
  identifier: string;
  kind: string;
  customerReference: string;
  customerId: string;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  const stranded = await prisma.lead.findMany({
    where: { status: 'CONVERTED', customerId: null, deletedAt: null },
    select: {
      id: true,
      reference: true,
      firstName: true,
      lastName: true,
      products: {
        where: { status: 'CONVERTED', conversionRef: { not: null } },
        select: { conversionRef: true, conversionRefKind: true, productCode: true },
      },
    },
  });

  console.log(`Converted leads with no customer: ${stranded.length}\n`);
  if (stranded.length === 0) {
    console.log('Nothing to repair.');
    await prisma.$disconnect();
    return;
  }

  const matched: Candidate[] = [];
  const skipped: string[] = [];

  for (const lead of stranded) {
    const name = `${lead.firstName} ${lead.lastName ?? ''}`.trim();
    const refs = lead.products.filter((p) => p.conversionRef);

    if (refs.length === 0) {
      skipped.push(`${lead.reference} ${name} — converted with no PAN or client code recorded`);
      continue;
    }

    // More than one distinct reference on one lead means the rep recorded two
    // different clients against it. That is a data question for a human, not
    // something to guess at.
    const distinct = [...new Set(refs.map((r) => r.conversionRef))];
    if (distinct.length > 1) {
      skipped.push(`${lead.reference} ${name} — conflicting references: ${distinct.join(', ')}`);
      continue;
    }

    const identifier = distinct[0]!;
    const kind = refs[0]!.conversionRefKind ?? 'UNKNOWN';
    const customer = await prisma.customer.findFirst({
      where: kind === 'PAN' ? { pan: identifier } : { clientCode: identifier },
      select: { id: true, reference: true },
    });

    if (!customer) {
      skipped.push(`${lead.reference} ${name} — no customer holds ${kind} ${identifier}`);
      continue;
    }

    matched.push({
      leadReference: lead.reference,
      leadId: lead.id,
      identifier,
      kind,
      customerReference: customer.reference,
      customerId: customer.id,
    });
  }

  if (matched.length > 0) {
    console.log(`Would link ${matched.length}:`);
    for (const m of matched) {
      console.log(`  ${m.leadReference}  ->  ${m.customerReference}   (${m.kind} ${m.identifier})`);
    }
  }

  if (skipped.length > 0) {
    console.log(`\nLeft alone (${skipped.length}) — each needs a person to look at it:`);
    for (const s of skipped) console.log(`  ${s}`);
  }

  if (!APPLY) {
    console.log('\nReport only. Re-run with --apply to write the links.');
    await prisma.$disconnect();
    return;
  }

  let written = 0;
  for (const m of matched) {
    // Guarded on customerId still being null, so a link written by a real
    // conversion between the report and the apply is never overwritten.
    const result = await prisma.lead.updateMany({
      where: { id: m.leadId, customerId: null },
      data: { customerId: m.customerId },
    });
    written += result.count;
    if (result.count === 0) {
      console.log(`  ${m.leadReference} already linked in the meantime — left as it is`);
    }
  }

  console.log(`\nLinked ${written} of ${matched.length}.`);
  await prisma.$disconnect();
}

void main();
