-- Service accounts: machine identities for systems that read from SIHL ONE.
--
-- Guarded throughout. Prisma runs a multi-statement migration outside a
-- transaction, so a failure halfway leaves the earlier statements applied and
-- the migration marked failed; on the retry, every statement must be safe to
-- meet its own work already done.

CREATE TABLE IF NOT EXISTS "service_account" (
    "id"               TEXT         NOT NULL,
    "name"             VARCHAR(60)  NOT NULL,
    "description"      VARCHAR(300),
    "keyPrefix"        VARCHAR(32)  NOT NULL,
    "keyHash"          TEXT         NOT NULL,
    "permissions"      TEXT[],
    "dataScope"        VARCHAR(16)  NOT NULL,
    "isActive"         BOOLEAN      NOT NULL DEFAULT true,
    "expiresAt"        TIMESTAMP(3) NOT NULL,
    "revokedAt"        TIMESTAMP(3),
    "lastUsedAt"       TIMESTAMP(3),
    "createdByLabel"   VARCHAR(160) NOT NULL,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_account_pkey" PRIMARY KEY ("id")
);

-- The prefix is the lookup key on every authenticated request: a presented key
-- is split, the prefix is found, and only then is the expensive Argon2 verify
-- run against the one candidate row. Without the index that becomes a sequential
-- scan on every call.
CREATE UNIQUE INDEX IF NOT EXISTS "service_account_name_key"      ON "service_account"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "service_account_keyPrefix_key" ON "service_account"("keyPrefix");
