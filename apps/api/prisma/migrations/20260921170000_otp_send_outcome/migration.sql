-- What the SMS provider said about each code.
--
-- Added after the first live code went missing. The gateway had accepted it and
-- the row gave no hint either way, so answering "was it sent?" meant probing the
-- provider from a production shell. That is not a diagnostic anyone should need
-- twice, and not one available to whoever is standing at the stall.
--
-- Safe to run twice; Prisma migrations are not transactional.

ALTER TABLE "mobile_otp"
  ADD COLUMN IF NOT EXISTS "sent" BOOLEAN NOT NULL DEFAULT false;

-- The provider's reference on success, or its refusal on failure. Never the
-- request: that carries the account password in its query string.
ALTER TABLE "mobile_otp"
  ADD COLUMN IF NOT EXISTS "providerResponse" VARCHAR(200);
