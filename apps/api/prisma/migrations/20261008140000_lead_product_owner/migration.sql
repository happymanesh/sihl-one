-- The lead product owner: who is working one product on one lead.
--
-- Additive. Null means nobody has been named for that product specifically and
-- the lead's own owner answers for it, which is every row today — so nothing
-- changes hands when this ships.
ALTER TABLE "lead_product"
  ADD COLUMN IF NOT EXISTS "ownerId" TEXT,
  ADD COLUMN IF NOT EXISTS "assignedAt" TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_product_ownerId_fkey') THEN
    ALTER TABLE "lead_product"
      ADD CONSTRAINT "lead_product_ownerId_fkey"
      FOREIGN KEY ("ownerId") REFERENCES "app_user"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Serves the scope filter: "leads where I own at least one product".
CREATE INDEX IF NOT EXISTS "lead_product_ownerId_idx" ON "lead_product" ("ownerId");
