-- Per-product outcomes on a lead.
--
-- A single status could not describe a client who takes equity in March, F&O in
-- May and declines mutual funds entirely. Reps were forced to choose between
-- marking the lead converted — and losing sight of the two conversations still
-- running — or leaving it open, and never recording the business that was won.
--
-- The lead keeps its own status. It is now rolled up from these rows on every
-- change, by `rollUpLeadStatus` in the contracts, which is the only definition
-- of how. Nothing reads a derived value at query time: the pipeline groups and
-- counts by `lead.status`, and recomputing that per query would be a table scan.
--
-- Guarded and idempotent throughout: Prisma does not wrap a multi-statement
-- migration in a transaction, so every step has to survive being retried after a
-- partial failure.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lead_product') THEN
        CREATE TABLE "lead_product" (
            "id"          TEXT PRIMARY KEY,
            "leadId"      TEXT NOT NULL,
            "productCode" VARCHAR(40) NOT NULL,
            "status"      VARCHAR(40) NOT NULL DEFAULT 'NEW',
            "closedAt"    TIMESTAMP(3),
            "lostReason"  VARCHAR(40),
            "note"        VARCHAR(1000),
            "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_product_leadId_fkey') THEN
        ALTER TABLE "lead_product"
            ADD CONSTRAINT "lead_product_leadId_fkey"
            FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- Restrict, not cascade: retiring a product from the catalogue must not
    -- silently delete the record of who wanted it.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_product_productCode_fkey') THEN
        ALTER TABLE "lead_product"
            ADD CONSTRAINT "lead_product_productCode_fkey"
            FOREIGN KEY ("productCode") REFERENCES "product"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- One row per product per lead. Without it a double-submit doubles the lead's
-- presence on a board that now shows one card per lead-product.
CREATE UNIQUE INDEX IF NOT EXISTS "lead_product_leadId_productCode_key"
    ON "lead_product" ("leadId", "productCode");

CREATE INDEX IF NOT EXISTS "lead_product_status_idx" ON "lead_product" ("status");

-- Backfill from the array every lead already carries.
--
-- The existing lead status is copied onto each of its products, which is the
-- only honest reading of the history: nothing recorded per-product outcomes
-- before now, so the lead's status is all that is known about any of them.
-- Inventing a spread — say, marking one converted and the rest lost — would be
-- fabricating a record of conversations nobody logged.
--
-- Products no longer in the catalogue are skipped rather than failing the
-- migration; the array was never foreign-keyed, so a retired code can sit in it.
INSERT INTO "lead_product" ("id", "leadId", "productCode", "status", "closedAt", "createdAt", "updatedAt")
SELECT
    'lp_' || md5(l."id" || ':' || code_value),
    l."id",
    code_value,
    l."status",
    CASE WHEN l."status" IN ('CONVERTED', 'LOST', 'DISQUALIFIED') THEN l."updatedAt" END,
    l."createdAt",
    CURRENT_TIMESTAMP
FROM "lead" l
CROSS JOIN LATERAL unnest(l."productInterest") AS code_value
WHERE l."deletedAt" IS NULL
  AND EXISTS (SELECT 1 FROM "product" p WHERE p."code" = code_value)
ON CONFLICT ("leadId", "productCode") DO NOTHING;
