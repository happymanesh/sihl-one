-- Source and product become editable masters.
--
-- Hand-written, not generated. Prisma's diff for an enum-to-varchar change is a
-- DROP COLUMN followed by an ADD COLUMN, which would discard the source of every
-- lead in the book. These are converted in place with USING, so the existing
-- values survive as their own codes.

-- 1. The masters -------------------------------------------------------------

CREATE TABLE "lead_source" (
    "id"            TEXT NOT NULL,
    "code"          VARCHAR(40) NOT NULL,
    "label"         VARCHAR(80) NOT NULL,
    "description"   VARCHAR(300),
    "scoringWeight" INTEGER NOT NULL DEFAULT 4,
    "isActive"      BOOLEAN NOT NULL DEFAULT true,
    "isSystem"      BOOLEAN NOT NULL DEFAULT false,
    "sortOrder"     INTEGER NOT NULL DEFAULT 100,
    "createdById"   TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lead_source_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "lead_source_code_key" ON "lead_source"("code");
CREATE INDEX "lead_source_isActive_sortOrder_idx" ON "lead_source"("isActive", "sortOrder");

CREATE TABLE "product" (
    "id"             TEXT NOT NULL,
    "code"           VARCHAR(40) NOT NULL,
    "name"           VARCHAR(80) NOT NULL,
    "summary"        VARCHAR(300),
    "description"    TEXT,
    "keyBenefits"    TEXT[],
    "chargesSummary" VARCHAR(600),
    "eligibility"    VARCHAR(600),
    "riskNote"       VARCHAR(600),
    "brochureKey"    VARCHAR(300),
    "isActive"       BOOLEAN NOT NULL DEFAULT true,
    "isSystem"       BOOLEAN NOT NULL DEFAULT false,
    "sortOrder"      INTEGER NOT NULL DEFAULT 100,
    "createdById"    TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "product_code_key" ON "product"("code");
CREATE INDEX "product_isActive_sortOrder_idx" ON "product"("isActive", "sortOrder");

-- 2. Seed from the enums being replaced --------------------------------------
--
-- Weights mirror SOURCE_WEIGHTS in the scoring engine exactly, so converting
-- changes no lead's score by a single point.

INSERT INTO "lead_source" ("id","code","label","scoringWeight","isSystem","sortOrder","updatedAt") VALUES
  ('lsrc_referral',     'REFERRAL',      'Referral',      22, true, 10, NOW()),
  ('lsrc_walkin',       'WALK_IN',       'Walk-in',       20, true, 20, NOW()),
  ('lsrc_partner',      'PARTNER',       'Partner',       18, true, 30, NOW()),
  ('lsrc_inboundcall',  'INBOUND_CALL',  'Inbound call',  18, true, 40, NOW()),
  ('lsrc_website',      'WEBSITE',       'Website',       14, true, 50, NOW()),
  ('lsrc_campaign',     'CAMPAIGN',      'Campaign',      12, true, 60, NOW()),
  ('lsrc_social',       'SOCIAL',        'Social',         8, true, 70, NOW()),
  ('lsrc_outboundcall', 'OUTBOUND_CALL', 'Outbound call',  6, true, 80, NOW()),
  ('lsrc_other',        'OTHER',         'Other',          4, true, 90, NOW()),
  ('lsrc_import',       'IMPORT',        'Import',         2, true, 95, NOW());

INSERT INTO "product" ("id","code","name","keyBenefits","isSystem","sortOrder","updatedAt") VALUES
  ('prod_equity',      'EQUITY',       'Equity',        '{}', true, 10, NOW()),
  ('prod_derivatives', 'DERIVATIVES',  'F&O',           '{}', true, 20, NOW()),
  ('prod_commodity',   'COMMODITY',    'Commodities',   '{}', true, 30, NOW()),
  ('prod_currency',    'CURRENCY',     'Currency',      '{}', true, 40, NOW()),
  ('prod_mf',          'MUTUAL_FUNDS', 'Mutual funds',  '{}', true, 50, NOW()),
  ('prod_ipo',         'IPO',          'IPOs',          '{}', true, 60, NOW()),
  ('prod_pms',         'PMS',          'PMS',           '{}', true, 70, NOW()),
  ('prod_aif',         'AIF',          'AIF',           '{}', true, 80, NOW()),
  ('prod_insurance',   'INSURANCE',    'Insurance',     '{}', true, 90, NOW()),
  ('prod_bonds',       'BONDS',        'Bonds',         '{}', true, 100, NOW()),
  ('prod_nri',         'NRI',          'NRI investing', '{}', true, 110, NOW()),
  ('prod_algo',        'ALGO',         'Algo trading',  '{}', true, 120, NOW());

-- 3. Convert the columns in place --------------------------------------------

ALTER TABLE "lead"
    ALTER COLUMN "source" TYPE VARCHAR(40) USING "source"::TEXT;

ALTER TABLE "lead"
    ALTER COLUMN "productInterest" TYPE VARCHAR(40)[] USING "productInterest"::TEXT[]::VARCHAR(40)[];

ALTER TABLE "customer"
    ALTER COLUMN "productInterest" TYPE VARCHAR(40)[] USING "productInterest"::TEXT[]::VARCHAR(40)[];

ALTER TABLE "customer_product"
    ALTER COLUMN "product" TYPE VARCHAR(40) USING "product"::TEXT;

-- 4. The foreign key ---------------------------------------------------------
--
-- RESTRICT, not CASCADE: deleting a source must fail loudly while leads still
-- point at it, rather than deleting the leads.

ALTER TABLE "lead"
    ADD CONSTRAINT "lead_source_fkey"
    FOREIGN KEY ("source") REFERENCES "lead_source"("code")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5. The enums are now unreferenced -------------------------------------------

DROP TYPE "LeadSource";
DROP TYPE "ProductInterest";
