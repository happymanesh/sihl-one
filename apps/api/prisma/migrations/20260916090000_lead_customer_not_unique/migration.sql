-- Many leads may point at one customer.
--
-- `lead.customerId` carried a UNIQUE index, which said a client arrives as a
-- lead exactly once. An existing client enquiring about a second product is
-- routine, and because conversion runs in a single transaction the constraint
-- did not merely refuse the link — it rolled the whole conversion back. The
-- product stayed NEW and the rep saw an outcome that would not stick.
--
-- Nothing is deleted or rewritten here. One index is dropped and a non-unique
-- one replaces it, so the reverse lookup — which leads belong to this customer,
-- asked on every 360 view — does not degrade into a sequential scan.
--
-- Hand-written and idempotent. Prisma applies a multi-statement migration
-- without wrapping it in a transaction, so a failure part-way through leaves
-- the earlier statements applied; every statement here can be run twice.

DROP INDEX IF EXISTS "lead_customerId_key";

CREATE INDEX IF NOT EXISTS "lead_customerId_idx" ON "lead"("customerId");
