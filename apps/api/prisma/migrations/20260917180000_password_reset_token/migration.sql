-- Self-service password reset.
--
-- Until now the only way back in was an administrator resetting the account by
-- hand, which does not work at eight in the evening before a client meeting.
--
-- Only the digest of the emailed token is stored. This table is readable by
-- anyone who can read the database, and a plaintext reset token is a working
-- key to somebody's account — so it is hashed for the same reason the password
-- beside it is. The digest is unique, so a token lifted from a backup cannot be
-- replayed against a second row.
--
-- Purely additive: one new table, no existing row read or written. Every
-- statement is idempotent, because Prisma does not wrap a multi-statement
-- migration in a transaction.

CREATE TABLE IF NOT EXISTS "password_reset_token" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "tokenHash"   VARCHAR(64) NOT NULL,
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  "usedAt"      TIMESTAMP(3),
  "requestedIp" VARCHAR(45),
  "requestedUa" VARCHAR(400),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "password_reset_token_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_token_tokenHash_key"
  ON "password_reset_token" ("tokenHash");

-- "How many resets has this account asked for lately" is the throttle question
-- and the abuse question, and both are asked per user, newest first.
CREATE INDEX IF NOT EXISTS "password_reset_token_userId_createdAt_idx"
  ON "password_reset_token" ("userId", "createdAt");

-- Lets expired rows be swept without a sequential scan once retention exists.
CREATE INDEX IF NOT EXISTS "password_reset_token_expiresAt_idx"
  ON "password_reset_token" ("expiresAt");

DO $$
BEGIN
  ALTER TABLE "password_reset_token"
    ADD CONSTRAINT "password_reset_token_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
