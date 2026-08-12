import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

export type ReferencePrefix = 'LD' | 'CU' | 'PT' | 'CM' | 'TK' | 'VS' | 'US' | 'IM' | 'EV';

/**
 * Human-readable business references (`LD-2026-000123`).
 *
 * Why not just show the cuid: an RM reads these aloud on calls and writes them
 * on paper. A 25-character opaque id is unusable for that, and exposing a
 * sequential integer as the primary key would leak volume ("we're their 43rd
 * customer this year") and invite enumeration.
 *
 * Concurrency: `UPDATE counter SET value = value + 1 RETURNING value` is
 * executed atomically under a row lock, so two simultaneous creations always
 * receive different numbers. The read-then-write pattern that would be the
 * obvious alternative is a race.
 */
@Injectable()
export class ReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async next(prefix: ReferencePrefix, at: Date = new Date()): Promise<string> {
    const year = at.getFullYear();
    const key = `${prefix}-${year}`;

    const rows = await this.prisma.$queryRaw<Array<{ value: number }>>`
      INSERT INTO "counter" ("key", "value", "updatedAt")
      VALUES (${key}, 1, NOW())
      ON CONFLICT ("key")
      DO UPDATE SET "value" = "counter"."value" + 1, "updatedAt" = NOW()
      RETURNING "value"
    `;

    const value = rows[0]?.value ?? 1;
    return `${prefix}-${year}-${String(value).padStart(6, '0')}`;
  }
}
