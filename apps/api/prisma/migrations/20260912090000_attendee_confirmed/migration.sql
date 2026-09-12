-- Distinguishes "expected on this visit" from "actually came".
--
-- Guarded: Prisma runs a multi-statement migration outside a transaction, so a
-- failure halfway leaves earlier statements applied and the migration marked
-- failed. Every statement must survive meeting its own work already done.
ALTER TABLE "attendee" ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3);

-- The manager's question is "who went out with whom today", which reads by
-- person and date rather than by visit.
CREATE INDEX IF NOT EXISTS "attendee_userId_confirmedAt_idx"
  ON "attendee"("userId", "confirmedAt");
