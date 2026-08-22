-- What a rep expects an interaction to earn, per product.
--
-- Change 8a. The figure is an estimate and the column name says so: ADR-0002
-- puts brokerage in the back office, which knows what was actually charged,
-- while this system knows what a salesperson believed on a Tuesday. If the two
-- ever share the word "brokerage", a forecast gets quoted as revenue in a
-- meeting — so nothing here is called that alone.
--
-- A table rather than a JSON column on activity, because the whole point is to
-- group by product: "expected brokerage by product this quarter" has to be a
-- query, not a scan that parses JSON in application code.
--
-- Every step is guarded. Prisma does not wrap a multi-statement SQL migration
-- in one transaction, so a failure part-way leaves earlier statements applied.

CREATE TABLE IF NOT EXISTS "activity_product" (
    "id"                TEXT NOT NULL,
    "activityId"        TEXT NOT NULL,
    "productCode"       VARCHAR(40) NOT NULL,
    -- Decimal, never a float. Binary floating point cannot represent rupee
    -- values exactly, and this column is summed and reported.
    "expectedBrokerage" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "activity_product_pkey" PRIMARY KEY ("id")
);

-- Cascade from the activity: these lines have no meaning without the
-- interaction they describe, and an activity is never hard-deleted anyway.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'activity_product_activityId_fkey'
    ) THEN
        ALTER TABLE "activity_product"
            ADD CONSTRAINT "activity_product_activityId_fkey"
            FOREIGN KEY ("activityId") REFERENCES "activity"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Restrict on the product: a product with recorded expectations against it
-- cannot be deleted out from under them. Deactivation is the supported way to
-- retire one, which keeps history readable.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'activity_product_productCode_fkey'
    ) THEN
        ALTER TABLE "activity_product"
            ADD CONSTRAINT "activity_product_productCode_fkey"
            FOREIGN KEY ("productCode") REFERENCES "product"("code")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- One line per product per interaction. Two would silently double the forecast,
-- which is exactly the sort of error nobody notices until a review meeting.
CREATE UNIQUE INDEX IF NOT EXISTS "activity_product_activityId_productCode_key"
    ON "activity_product" ("activityId", "productCode");

-- The reporting query: expected brokerage grouped by product over a period.
CREATE INDEX IF NOT EXISTS "activity_product_productCode_createdAt_idx"
    ON "activity_product" ("productCode", "createdAt");

-- A negative expectation is not a thing. Enforced here as well as in the schema
-- so an import or a direct write cannot introduce one.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'activity_product_amount_not_negative'
    ) THEN
        ALTER TABLE "activity_product"
            ADD CONSTRAINT "activity_product_amount_not_negative"
            CHECK ("expectedBrokerage" >= 0);
    END IF;
END $$;
