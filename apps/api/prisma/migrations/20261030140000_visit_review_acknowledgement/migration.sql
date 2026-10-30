-- Acknowledging a visit whose location evidence did not hold up.
--
-- `requiresReview` is derived from the geometry at read time — no fix at
-- check-in, a check-out beyond the drift threshold, a visit under two
-- minutes — and it stays true for ever, because the geometry never changes.
-- There was no way to say "I have looked at this and it is fine", so every
-- flagged visit stayed in the queue and the queue only grew.
--
-- Two columns, not a status: the flag is a fact about the evidence and does
-- not become untrue. What changes is that a named person accepted it, on a
-- date, which is exactly what an inspection would ask for.
--
-- Idempotent, because a Prisma multi-statement migration is not transactional.

ALTER TABLE "visit" ADD COLUMN IF NOT EXISTS "reviewedById" TEXT;
ALTER TABLE "visit" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);

DO $$
BEGIN
  -- The reviewer may leave; the review stands. Nulling the name is better
  -- than blocking the offboarding of a manager, and `reviewedAt` still
  -- records that the visit was accepted.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_reviewedById_fkey') THEN
    ALTER TABLE "visit" ADD CONSTRAINT "visit_reviewedById_fkey"
      FOREIGN KEY ("reviewedById") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- The outstanding queue is "flagged and not yet accepted". Only the second
-- half can be expressed in SQL, so this indexes the rows still awaiting an
-- eye rather than the whole table.
CREATE INDEX IF NOT EXISTS "visit_awaiting_review_idx"
  ON "visit" ("checkOutAt")
  WHERE "reviewedAt" IS NULL;
