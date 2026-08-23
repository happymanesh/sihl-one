-- The figure recorded against a product is the investment, not the brokerage.
--
-- Change 8a was specified as expected brokerage and built that way yesterday.
-- The business has since settled on the investment itself — what the client
-- puts in, rather than the fee SIHL earns on it. Those differ by roughly an
-- order of magnitude, so leaving the column named for one while the screen says
-- the other is exactly how a forecast gets misread in a review meeting.
--
-- A rename rather than a new column: the two meanings are mutually exclusive,
-- nobody has entered production data against it, and carrying both would leave
-- a permanently ambiguous pair.
--
-- Values already captured on staging were entered under the old label and are
-- left as they are. There are a handful, all from testing, and inventing a
-- conversion factor between a fee and a principal would be worse than leaving
-- them to be corrected by hand.
--
-- Guarded, and idempotent: Prisma does not wrap a multi-statement migration in
-- one transaction.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'activity_product' AND column_name = 'expectedBrokerage'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'activity_product' AND column_name = 'expectedInvestment'
    ) THEN
        ALTER TABLE "activity_product" RENAME COLUMN "expectedBrokerage" TO "expectedInvestment";
    END IF;
END $$;

-- The check constraint names the old column in its own definition, so it is
-- rebuilt rather than renamed.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'activity_product_amount_not_negative'
    ) THEN
        ALTER TABLE "activity_product" DROP CONSTRAINT "activity_product_amount_not_negative";
    END IF;

    ALTER TABLE "activity_product"
        ADD CONSTRAINT "activity_product_amount_not_negative"
        CHECK ("expectedInvestment" >= 0);
END $$;
