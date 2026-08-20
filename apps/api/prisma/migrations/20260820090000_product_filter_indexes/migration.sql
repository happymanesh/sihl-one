-- Indexes for filtering by product.
--
-- Hand-written because Prisma cannot express a GIN index. `productInterest` is a
-- text array and the filter uses array overlap (`hasSome`), which a btree cannot
-- serve — without GIN, every product filter is a sequential scan over the whole
-- table. Invisible at pilot volume, and the reason the pipeline screen would be
-- the first thing to get slow.
--
-- CONCURRENTLY is deliberately not used: it cannot run inside the transaction
-- Prisma wraps migrations in, and these tables are small enough that the brief
-- lock is not worth the added failure modes.

CREATE INDEX IF NOT EXISTS "lead_productInterest_idx"
    ON "lead" USING GIN ("productInterest");

CREATE INDEX IF NOT EXISTS "customer_productInterest_idx"
    ON "customer" USING GIN ("productInterest");

-- customer_product already has a unique index on (customerId, product), but that
-- btree leads on customerId, so it cannot serve "every customer holding PMS" —
-- which is exactly what the holdings filter asks.
CREATE INDEX IF NOT EXISTS "customer_product_product_idx"
    ON "customer_product" ("product");
