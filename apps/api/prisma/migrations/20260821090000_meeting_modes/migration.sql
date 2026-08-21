-- How an interaction happened, and evidence for the modes that leave no trace.
--
-- Every step is guarded. Prisma does not wrap a multi-statement SQL migration in
-- one transaction, so a failure part-way leaves earlier statements applied and
-- the retry fails on "already exists" — twice now on this project.
--
-- Table names are the mapped ones: the User model maps to app_user, not user.

-- 1. The mode master ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS "meeting_mode" (
    "id"               TEXT NOT NULL,
    "code"             VARCHAR(40) NOT NULL,
    "label"            VARCHAR(80) NOT NULL,
    "meaning"          VARCHAR(200),
    "requiresPhoto"    BOOLEAN NOT NULL DEFAULT false,
    "requiresGeo"      BOOLEAN NOT NULL DEFAULT false,
    "createsVisit"     BOOLEAN NOT NULL DEFAULT false,
    "requiresLink"     BOOLEAN NOT NULL DEFAULT false,
    "allowsScreenshot" BOOLEAN NOT NULL DEFAULT false,
    "isActive"         BOOLEAN NOT NULL DEFAULT true,
    "isSystem"         BOOLEAN NOT NULL DEFAULT false,
    "sortOrder"        INTEGER NOT NULL DEFAULT 100,
    "createdById"      TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,
    CONSTRAINT "meeting_mode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "meeting_mode_code_key" ON "meeting_mode"("code");
CREATE INDEX IF NOT EXISTS "meeting_mode_isActive_sortOrder_idx"
    ON "meeting_mode"("isActive", "sortOrder");

-- 2. Seed the system modes ---------------------------------------------------
-- The flags carry the behaviour. Only a client-site visit asks for a photograph;
-- only online modes ask for a link; only the modes that leave no independent
-- trace accept a screenshot.
INSERT INTO "meeting_mode"
  ("id", "code", "label", "meaning", "requiresPhoto", "requiresGeo", "createsVisit", "requiresLink", "allowsScreenshot", "isSystem", "sortOrder", "updatedAt")
VALUES
  ('mm_client_site', 'CLIENT_SITE', 'At client location', 'Met the client at their premises.',        true,  true,  true,  false, false, true, 10, CURRENT_TIMESTAMP),
  ('mm_office',      'OFFICE',      'At our office',      'Client came to a SIHL office.',            false, false, false, false, false, true, 20, CURRENT_TIMESTAMP),
  ('mm_online',      'ONLINE',      'Online meeting',     'Video call.',                              false, false, false, true,  true,  true, 30, CURRENT_TIMESTAMP),
  ('mm_call',        'CALL',        'Phone call',         'Voice call, no video.',                    false, false, false, false, false, true, 40, CURRENT_TIMESTAMP),
  ('mm_chat',        'CHAT',        'Chat',               'WhatsApp or other messaging.',             false, false, false, false, true,  true, 50, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- 3. Mode and link on the interaction ----------------------------------------
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "meetingMode" VARCHAR(40);
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "meetingLink" VARCHAR(500);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activity_meetingMode_fkey') THEN
        ALTER TABLE "activity"
            ADD CONSTRAINT "activity_meetingMode_fkey"
            FOREIGN KEY ("meetingMode") REFERENCES "meeting_mode"("code")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- 4. Evidence hangs off the interaction it evidences -------------------------
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "activityId" TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_activityId_fkey') THEN
        ALTER TABLE "document"
            ADD CONSTRAINT "document_activityId_fkey"
            FOREIGN KEY ("activityId") REFERENCES "activity"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "document_activityId_idx" ON "document"("activityId");
