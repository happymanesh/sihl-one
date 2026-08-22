-- Whether anyone has actually reached the person behind a lead's number.
--
-- Requested by management: reps were suspected of entering numbers that go
-- nowhere. An OTP at capture was rejected as a design — it puts friction on a
-- prospect who has not agreed to anything yet — so this records what a rep
-- says they did, and who said it, which is what makes it reportable per person.
--
-- Nullable throughout and no default: every lead that already exists is
-- unverified, which is the truthful position. Backfilling any of them to
-- verified would invent evidence.
--
-- Every step is guarded. Prisma does not wrap a multi-statement SQL migration
-- in one transaction, so a failure part-way leaves the earlier statements
-- applied and an unguarded retry then fails on "already exists".

-- 1. The columns --------------------------------------------------------------
ALTER TABLE "lead" ADD COLUMN IF NOT EXISTS "mobileVerifiedAt"         TIMESTAMP(3);
ALTER TABLE "lead" ADD COLUMN IF NOT EXISTS "mobileVerificationMethod" VARCHAR(20);
ALTER TABLE "lead" ADD COLUMN IF NOT EXISTS "mobileVerificationNote"   VARCHAR(200);
ALTER TABLE "lead" ADD COLUMN IF NOT EXISTS "mobileVerifiedById"       TEXT;

-- 2. Who did it ---------------------------------------------------------------
-- SET NULL on delete rather than RESTRICT: a person leaving must not block
-- their record being closed, and the timestamp still shows the check happened.
-- Note the table name — the Prisma model `User` maps to "app_user".
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'lead_mobileVerifiedById_fkey'
    ) THEN
        ALTER TABLE "lead"
            ADD CONSTRAINT "lead_mobileVerifiedById_fkey"
            FOREIGN KEY ("mobileVerifiedById") REFERENCES "app_user"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- 3. The query this exists to serve -------------------------------------------
-- "Show me the unverified leads", scoped to a team. Partial on NULL because
-- that is the side being hunted for, and it keeps the index small as the
-- verified pile grows.
CREATE INDEX IF NOT EXISTS "lead_unverified_idx"
    ON "lead" ("ownerId", "createdAt")
    WHERE "mobileVerifiedAt" IS NULL AND "deletedAt" IS NULL;
