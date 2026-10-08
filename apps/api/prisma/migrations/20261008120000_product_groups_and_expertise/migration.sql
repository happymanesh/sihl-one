-- Product groups, and which of them a person sells.
--
-- Additive throughout: a new table, a nullable column on product, and an array
-- on user that defaults to empty. Nothing existing changes meaning, and every
-- statement is written so a retry can run over the top of a partial apply —
-- Prisma runs a multi-statement migration outside a transaction, so a failure
-- halfway through leaves the earlier statements in place.

CREATE TABLE IF NOT EXISTS "product_group" (
  "id"        TEXT         NOT NULL,
  "code"      VARCHAR(40)  NOT NULL,
  "name"      VARCHAR(80)  NOT NULL,
  "isActive"  BOOLEAN      NOT NULL DEFAULT true,
  "isSystem"  BOOLEAN      NOT NULL DEFAULT false,
  "sortOrder" INTEGER      NOT NULL DEFAULT 100,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_group_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_group_code_key"
  ON "product_group" ("code");

CREATE INDEX IF NOT EXISTS "product_group_isActive_sortOrder_idx"
  ON "product_group" ("isActive", "sortOrder");

ALTER TABLE "product"
  ADD COLUMN IF NOT EXISTS "groupId" TEXT;

-- Guarded, because a repeated run would otherwise fail on the constraint name.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_groupId_fkey'
  ) THEN
    ALTER TABLE "product"
      ADD CONSTRAINT "product_groupId_fkey"
      FOREIGN KEY ("groupId") REFERENCES "product_group"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Which groups a person sells. Empty means "no stated expertise", which the
-- assignment engine reads as "eligible for anything" rather than "eligible for
-- nothing" — the opposite would strand every lead the day this ships.
ALTER TABLE "app_user"
  ADD COLUMN IF NOT EXISTS "productGroups" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
