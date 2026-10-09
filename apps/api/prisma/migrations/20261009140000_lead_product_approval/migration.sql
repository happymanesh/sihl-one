-- Sign-off on what a rep has committed to a client for one product.
--
-- Raised when a product is moved to Qualified and the rep ticks "send for
-- approval"; decided by the National Head above them. It never gates the sale —
-- a product may be converted while this is pending or after it was refused.
-- The record exists so the person accountable for a commitment can see it.
--
-- Idempotent throughout, because a Prisma multi-statement migration is not
-- transactional: a failure halfway must leave something a re-run can finish.
CREATE TABLE IF NOT EXISTS "lead_product_approval" (
  "id"             TEXT         NOT NULL,
  "leadId"         TEXT         NOT NULL,
  "productCode"    VARCHAR(40)  NOT NULL,
  "requestedById"  TEXT         NOT NULL,
  "approverId"     TEXT         NOT NULL,
  "status"         VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
  "requestNote"    VARCHAR(1000),
  "decisionReason" VARCHAR(1000),
  "requestedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt"      TIMESTAMP(3),
  "lastReminderAt" TIMESTAMP(3),
  "emailNote"      VARCHAR(200),
  CONSTRAINT "lead_product_approval_pkey" PRIMARY KEY ("id")
);

-- One live request per product per lead. Re-raising replaces the decision
-- rather than stacking a second request nobody would know which of to answer.
CREATE UNIQUE INDEX IF NOT EXISTS "lead_product_approval_leadId_productCode_key"
  ON "lead_product_approval" ("leadId", "productCode");

-- The approver's queue: "what is waiting for me".
CREATE INDEX IF NOT EXISTS "lead_product_approval_approverId_status_idx"
  ON "lead_product_approval" ("approverId", "status");

DO $$
BEGIN
  -- Cascade from the lead: an approval has no meaning without it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_product_approval_leadId_fkey'
  ) THEN
    ALTER TABLE "lead_product_approval"
      ADD CONSTRAINT "lead_product_approval_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- Restrict on both people: a request records who asked and who was asked,
  -- and a leaver must not take that record with them.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_product_approval_requestedById_fkey'
  ) THEN
    ALTER TABLE "lead_product_approval"
      ADD CONSTRAINT "lead_product_approval_requestedById_fkey"
      FOREIGN KEY ("requestedById") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_product_approval_approverId_fkey'
  ) THEN
    ALTER TABLE "lead_product_approval"
      ADD CONSTRAINT "lead_product_approval_approverId_fkey"
      FOREIGN KEY ("approverId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
