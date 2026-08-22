-- The client profile a rep builds up over time.
--
-- Occupation, income, what the client already holds, and who is in the
-- household. Everything is nullable: a lead starts as a name and a number from
-- a phone call, and the rest arrives over weeks or never. A schema that
-- demanded any of it would be satisfied with guesses.
--
-- A separate table rather than fifteen nullable columns on `lead`. The lead row
-- is read on every list, every board and every export; this is read when
-- somebody opens one record. Keeping them apart means the common query does not
-- carry a payload of income and family details it never displays — which is
-- also the safer arrangement for data this sensitive.
--
-- ADR-0002 still applies. This is what a client told a salesperson, not
-- verified financials: the back office and the KYC system hold anything that
-- has to be true.
--
-- Every step is guarded. Prisma does not wrap a multi-statement SQL migration
-- in one transaction, so a failure part-way leaves earlier statements applied.

-- 1. The profile -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "lead_profile" (
    "id"                  TEXT NOT NULL,
    "leadId"              TEXT NOT NULL,

    "occupation"          VARCHAR(120),
    "companyName"         VARCHAR(160),
    "designation"         VARCHAR(120),

    "riskCategory"        VARCHAR(10),

    -- Decimal, never float: these are rupee figures and they get totalled and
    -- banded in reports.
    "monthlyIncome"       DECIMAL(18,2),
    "annualIncomeBand"    VARCHAR(24),
    "monthlySip"          DECIMAL(18,2),
    "monthlyEmi"          DECIMAL(18,2),

    "investmentGoal"      VARCHAR(400),

    -- Codes, matching how productInterest is already stored on `lead`.
    "existingInvestments" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "insuranceCover"      DECIMAL(18,2),
    "mediclaimBand"       VARCHAR(24),
    "otherInvestments"    VARCHAR(300),

    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "lead_profile_pkey" PRIMARY KEY ("id")
);

-- One profile per lead.
CREATE UNIQUE INDEX IF NOT EXISTS "lead_profile_leadId_key" ON "lead_profile"("leadId");

-- Cascade: a profile has no meaning without its lead, and a lead is soft
-- deleted rather than removed, so this fires only on a genuine hard delete.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_profile_leadId_fkey') THEN
        ALTER TABLE "lead_profile"
            ADD CONSTRAINT "lead_profile_leadId_fkey"
            FOREIGN KEY ("leadId") REFERENCES "lead"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Note the table name: the Prisma model `User` maps to "app_user".
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_profile_updatedById_fkey') THEN
        ALTER TABLE "lead_profile"
            ADD CONSTRAINT "lead_profile_updatedById_fkey"
            FOREIGN KEY ("updatedById") REFERENCES "app_user"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- Segmentation is the point of banding income at all: "qualified leads earning
-- 25L and above" has to be a query rather than a scan.
CREATE INDEX IF NOT EXISTS "lead_profile_annualIncomeBand_idx"
    ON "lead_profile"("annualIncomeBand");
CREATE INDEX IF NOT EXISTS "lead_profile_riskCategory_idx"
    ON "lead_profile"("riskCategory");

-- Negative money is not a thing anyone meant to type.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_profile_amounts_not_negative') THEN
        ALTER TABLE "lead_profile"
            ADD CONSTRAINT "lead_profile_amounts_not_negative"
            CHECK (
                COALESCE("monthlyIncome", 0)  >= 0 AND
                COALESCE("monthlySip", 0)     >= 0 AND
                COALESCE("monthlyEmi", 0)     >= 0 AND
                COALESCE("insuranceCover", 0) >= 0
            );
    END IF;
END $$;

-- 2. The household -----------------------------------------------------------
-- Its own table because a client has any number of relatives, and because
-- "leads with school-age children" is a question somebody will eventually ask.
CREATE TABLE IF NOT EXISTS "lead_family_member" (
    "id"            TEXT NOT NULL,
    "leadId"        TEXT NOT NULL,
    "relation"      VARCHAR(16) NOT NULL,
    "name"          VARCHAR(80),
    "occupation"    VARCHAR(80),
    "location"      VARCHAR(80),
    "maritalStatus" VARCHAR(12),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lead_family_member_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_family_member_leadId_fkey') THEN
        ALTER TABLE "lead_family_member"
            ADD CONSTRAINT "lead_family_member_leadId_fkey"
            FOREIGN KEY ("leadId") REFERENCES "lead"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "lead_family_member_leadId_idx" ON "lead_family_member"("leadId");
