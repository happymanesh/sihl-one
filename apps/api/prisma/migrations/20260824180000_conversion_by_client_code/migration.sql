-- Record a conversion against a client code, not only a PAN.
--
-- Conversion demanded a PAN in the exact ten-character format plus an email.
-- That is right when SIHL ONE is where the account is opened, and wrong for
-- what reps actually do: the account is opened in the back office, the rep has
-- the client code in front of them, and being sent away to look up a PAN is why
-- conversions were going unrecorded entirely.
--
-- So `pan` and `email` become nullable and a check constraint takes over the
-- job the NOT NULL was doing badly: a customer must carry a PAN or a client
-- code, and which one is the rep's business. The back office remains the
-- authority on both (ADR-0002) — these are pointers to their record.
--
-- The unique index on `pan` is kept. Postgres allows many NULLs under a unique
-- index, so customers identified only by client code do not collide.
--
-- Guarded and idempotent: Prisma does not wrap a multi-statement migration in a
-- transaction, so every step must survive a retry after a partial failure.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'customer' AND column_name = 'pan' AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE "customer" ALTER COLUMN "pan" DROP NOT NULL;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'customer' AND column_name = 'email' AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE "customer" ALTER COLUMN "email" DROP NOT NULL;
    END IF;
END $$;

-- One identifier or the other, never neither. Written as NOT VALID first and
-- validated separately so the table is not exclusively locked while every
-- existing row is scanned; every existing row has a PAN, so validation passes.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_has_an_identifier') THEN
        ALTER TABLE "customer"
            ADD CONSTRAINT "customer_has_an_identifier"
            CHECK ("pan" IS NOT NULL OR "clientCode" IS NOT NULL) NOT VALID;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'customer_has_an_identifier' AND NOT convalidated
    ) THEN
        ALTER TABLE "customer" VALIDATE CONSTRAINT "customer_has_an_identifier";
    END IF;
END $$;

-- What the client actually put in, and what the conversion was recorded
-- against. On the product rather than the lead, because conversion is per
-- product: equity in March and F&O in May are two figures, not one.
ALTER TABLE "lead_product"
    ADD COLUMN IF NOT EXISTS "finalAmount" DECIMAL(18,2),
    ADD COLUMN IF NOT EXISTS "conversionRef" VARCHAR(30),
    ADD COLUMN IF NOT EXISTS "conversionRefKind" VARCHAR(20);

-- Decimal, never float. These are rupee figures and they get reported on.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'lead_product_final_amount_not_negative'
    ) THEN
        ALTER TABLE "lead_product"
            ADD CONSTRAINT "lead_product_final_amount_not_negative"
            CHECK ("finalAmount" IS NULL OR "finalAmount" >= 0);
    END IF;
END $$;
