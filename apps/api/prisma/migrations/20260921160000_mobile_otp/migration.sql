-- One-time codes for verifying a mobile number at event registration.
--
-- A table rather than an in-memory map: the API runs more than one instance,
-- and a code issued by one that cannot be verified by another is a bug nobody
-- can reproduce locally.
--
-- The code itself is never stored. Only a hash goes in, exactly as a password
-- would — an OTP is a credential for as long as it lives, and a dump of this
-- table should not let anybody verify somebody else's number.
--
-- Column names are camelCase to match every other column in this database.
-- Every statement is safe to run twice; Prisma migrations are not transactional.

CREATE TABLE IF NOT EXISTS "mobile_otp" (
  "id"          TEXT PRIMARY KEY,
  "mobile"      VARCHAR(10) NOT NULL,
  "purpose"     VARCHAR(30) NOT NULL,
  "codeHash"    TEXT NOT NULL,
  "leadId"      TEXT,
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  -- Wrong guesses. A six-digit code is a million possibilities, which is a
  -- short afternoon for a script; the attempt cap is what makes it a credential
  -- rather than a formality.
  "attempts"    INTEGER NOT NULL DEFAULT 0,
  "consumedAt"  TIMESTAMP(3),
  -- Who asked. The capture endpoint is public, so this is the only way to see
  -- one address requesting codes for hundreds of numbers.
  "ipAddress"   VARCHAR(64),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  ALTER TABLE "mobile_otp"
    ADD CONSTRAINT "mobile_otp_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "lead"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Reads are "the live code for this number" and "how many has this number asked
-- for lately", both of which are this index.
CREATE INDEX IF NOT EXISTS "mobile_otp_mobile_createdAt_idx"
  ON "mobile_otp" ("mobile", "createdAt");

-- For the sweep that clears spent and expired rows.
CREATE INDEX IF NOT EXISTS "mobile_otp_expiresAt_idx"
  ON "mobile_otp" ("expiresAt");
