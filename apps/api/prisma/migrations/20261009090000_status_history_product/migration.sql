-- Which product a stage change was about.
--
-- `lead_status_history` only ever recorded the lead's own status, so once work
-- moved to one product at a time the history could not say what had changed:
-- three products going through their own stages produced rows that all read
-- the same and none of which named a product. Null means the row is about the
-- lead as a whole, which is what every existing row is.
--
-- No foreign key to `product` on purpose. This is a log, and a log must not be
-- the reason a master row cannot be retired; `lead_product.productCode` holds
-- the referential relationship and is the last word on which codes are real.
ALTER TABLE "lead_status_history" ADD COLUMN IF NOT EXISTS "productCode" VARCHAR(40);

-- The history panel reads a lead's rows and groups them by product.
CREATE INDEX IF NOT EXISTS "lead_status_history_leadId_productCode_idx"
  ON "lead_status_history" ("leadId", "productCode");
