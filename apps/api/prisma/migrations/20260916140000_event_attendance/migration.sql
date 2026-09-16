-- Who we met at an event, as distinct from who the event produced.
--
-- A client who already banks with us and registers at the stall was invisible:
-- the capture attached the enquiry to their existing lead and nothing recorded
-- that they had turned up, so the event's own list showed only first-timers and
-- the rep could not reach them from the event at all.
--
-- The obvious shortcut — setting `lead.eventId` on the returning lead — was
-- rejected. That field means "the event that produced this lead", and reusing
-- it would credit this event with acquiring somebody it did not, or overwrite
-- the earlier event that genuinely did. Two questions, two places.
--
-- Purely additive: one new table, no existing row read or written.

CREATE TABLE IF NOT EXISTS "event_attendance" (
  "id"        TEXT NOT NULL,
  "eventId"   TEXT NOT NULL,
  "leadId"    TEXT NOT NULL,
  "returning" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "event_attendance_pkey" PRIMARY KEY ("id")
);

-- One attendance per person per event: scanning the QR twice at the same stall
-- is one visit, and the capture relies on this to stay idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS "event_attendance_eventId_leadId_key"
  ON "event_attendance" ("eventId", "leadId");

CREATE INDEX IF NOT EXISTS "event_attendance_leadId_idx"
  ON "event_attendance" ("leadId");

DO $$
BEGIN
  ALTER TABLE "event_attendance"
    ADD CONSTRAINT "event_attendance_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "event_attendance"
    ADD CONSTRAINT "event_attendance_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
