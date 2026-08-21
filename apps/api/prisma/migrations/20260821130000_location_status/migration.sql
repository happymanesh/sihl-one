-- Whether a check-in's location counts as evidence.
--
-- Paired with making latitude, longitude and accuracy optional on check-in. The
-- previous rule rejected a check-in whose fix was imprecise, which meant a rep
-- in a basement with no signal could not record a visit they had actually made.
-- No record is worse data than one marked unverified, so nothing is refused now
-- and the quality is reported instead.

ALTER TABLE "visit" ADD COLUMN IF NOT EXISTS "locationStatus" VARCHAR(20);
ALTER TABLE "visit" ADD COLUMN IF NOT EXISTS "locationReason" VARCHAR(20);

-- Existing check-ins passed the old accuracy gate, so they were verified by the
-- rule in force at the time. Backfilled rather than left null, so the reported
-- rate is not skewed by history having no opinion.
UPDATE "visit"
   SET "locationStatus" = 'VERIFIED'
 WHERE "checkInAt" IS NOT NULL
   AND "checkInLatitude" IS NOT NULL
   AND "locationStatus" IS NULL;

CREATE INDEX IF NOT EXISTS "visit_locationStatus_idx" ON "visit"("locationStatus");
