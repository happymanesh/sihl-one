-- The legal entity a lead's account would be opened for.
--
-- An HUF is a different entity from the individual who is its karta: different
-- PAN, different account, routinely the same mobile number. Until now the
-- duplicate check saw only the number, so the second account could not be
-- added at all while the first lead was open.
--
-- Idempotent throughout, because a Prisma multi-statement migration is not
-- transactional: a failure halfway must leave something a re-run can finish.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LeadEntityType') THEN
    CREATE TYPE "LeadEntityType" AS ENUM ('INDIVIDUAL', 'HUF', 'CORPORATE', 'NRI', 'TRUST');
  END IF;
END $$;

-- Defaulted rather than nullable, and backfilled by the default itself: every
-- lead that existed before this column was an individual, because that is the
-- only kind the product could record. NOT NULL from the start means no code
-- ever has to handle the "we do not know" case, which would otherwise outlive
-- the migration by years.
ALTER TABLE "lead"
  ADD COLUMN IF NOT EXISTS "entityType" "LeadEntityType" NOT NULL DEFAULT 'INDIVIDUAL';

-- The duplicate check reads mobile together with entity type, so the pair is
-- what needs to be fast. The existing index on mobile alone stays: it still
-- serves search, and this one does not replace it for a lookup that supplies
-- no entity type.
CREATE INDEX IF NOT EXISTS "lead_mobile_entityType_idx"
  ON "lead" ("mobile", "entityType");
