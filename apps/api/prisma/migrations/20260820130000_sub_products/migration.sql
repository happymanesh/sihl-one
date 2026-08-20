-- Sub-products: a second level under an existing product.
--
-- Restrict on delete, so a product with sub-products cannot be removed out from
-- under them. Depth is capped at two in the service rather than here — Postgres
-- cannot express "a parent may not itself have a parent" without a trigger, and
-- a trigger is a surprising place to keep a product rule.

ALTER TABLE "product" ADD COLUMN "parentId" TEXT;

ALTER TABLE "product"
    ADD CONSTRAINT "product_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "product"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "product_parentId_idx" ON "product"("parentId");
