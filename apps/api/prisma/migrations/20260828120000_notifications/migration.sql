-- Notification centre.
--
-- Every statement is guarded. Prisma applies a migration file as multiple
-- statements without wrapping them in a transaction, so a failure halfway
-- through leaves the earlier statements applied — and the retry must then be
-- able to run over its own partial work.

CREATE TABLE IF NOT EXISTS "notification" (
  "id"            TEXT         NOT NULL,
  "userId"        TEXT         NOT NULL,
  "type"          VARCHAR(40)  NOT NULL,
  "title"         VARCHAR(200) NOT NULL,
  "body"          VARCHAR(500),
  "entityType"    VARCHAR(24),
  "entityId"      VARCHAR(64),
  "actorId"       TEXT,
  "sourceEventId" VARCHAR(64)  NOT NULL,
  "readAt"        TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- Idempotency for the outbox relay: it retries up to eight times, so the same
-- event must not be able to notify the same person twice.
CREATE UNIQUE INDEX IF NOT EXISTS "notification_userId_sourceEventId_type_key"
  ON "notification" ("userId", "sourceEventId", "type");

-- The only query the bell makes: this person's unread, newest first.
CREATE INDEX IF NOT EXISTS "notification_userId_readAt_createdAt_idx"
  ON "notification" ("userId", "readAt", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_userId_fkey'
  ) THEN
    ALTER TABLE "notification"
      ADD CONSTRAINT "notification_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "app_user"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_actorId_fkey'
  ) THEN
    ALTER TABLE "notification"
      ADD CONSTRAINT "notification_actorId_fkey"
      FOREIGN KEY ("actorId") REFERENCES "app_user"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
