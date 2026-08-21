-- Expenses claimed against a visit.
--
-- Claims, not payables. No approval state, no reimbursement status, no payment
-- date: money belongs to the back office (ADR-0002), and the moment this table
-- carries "approved" or "paid" it becomes a second system of record for it.
--
-- Guarded throughout, as every migration here is now: Prisma does not wrap a
-- multi-statement SQL migration in one transaction.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExpenseCategory') THEN
        CREATE TYPE "ExpenseCategory" AS ENUM ('TRAVEL', 'FOOD', 'PARKING', 'ACCOMMODATION', 'OTHER');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "visit_expense" (
    "id"          TEXT NOT NULL,
    "visitId"     TEXT NOT NULL,
    "category"    "ExpenseCategory" NOT NULL,
    -- Numeric, not double precision. This figure is read by finance and a rupee
    -- amount must survive the round trip exactly.
    "amount"      DECIMAL(18,2) NOT NULL,
    "note"        VARCHAR(300),
    "receiptKey"  VARCHAR(300),
    "claimedById" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "visit_expense_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "visit_expense_visitId_idx" ON "visit_expense"("visitId");

-- A claim cannot be zero or negative: a nil expense is a mis-tap, and a negative
-- one is a refund, which is the back office's business rather than a visit's.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_expense_amount_positive') THEN
        ALTER TABLE "visit_expense"
            ADD CONSTRAINT "visit_expense_amount_positive" CHECK ("amount" > 0);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_expense_visitId_fkey') THEN
        ALTER TABLE "visit_expense"
            ADD CONSTRAINT "visit_expense_visitId_fkey"
            FOREIGN KEY ("visitId") REFERENCES "visit"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
