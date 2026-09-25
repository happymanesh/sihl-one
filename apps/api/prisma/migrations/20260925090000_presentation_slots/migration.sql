-- Talks at an event, and the seats visitors book at them.
--
-- Two new tables, two foreign keys, three indexes. Nothing existing is altered,
-- renamed or rewritten, so this cannot touch a lead, a user or an event that is
-- already there.

CREATE TABLE IF NOT EXISTS "presentation_slot" (
  "id"              TEXT         NOT NULL,
  "eventId"         TEXT         NOT NULL,
  -- One instant, not a date plus a clock time. Splitting them lets the two
  -- disagree, which is how a talk ends up at midnight on the wrong day.
  "startsAt"        TIMESTAMP(3) NOT NULL,
  "durationMinutes" INTEGER      NOT NULL,
  "topic"           VARCHAR(160) NOT NULL,
  "presenterName"   VARCHAR(120),
  -- Seats, when somebody decides to cap a talk. Nothing enforces it yet; the
  -- column exists so the rule can be added later without a migration against a
  -- table that already holds bookings.
  "capacity"        INTEGER,
  -- Cancelled talks are switched off, never deleted, so the bookings survive
  -- and whoever has to ring those visitors still has the list.
  "isActive"        BOOLEAN      NOT NULL DEFAULT true,
  "createdById"     TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "presentation_slot_pkey" PRIMARY KEY ("id"),
  -- A talk cannot outlive its event.
  CONSTRAINT "presentation_slot_eventId_fkey" FOREIGN KEY ("eventId")
    REFERENCES "event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- A zero or negative talk is not a talk, and a day-long one is a typo.
  CONSTRAINT "presentation_slot_duration_sane"
    CHECK ("durationMinutes" > 0 AND "durationMinutes" <= 600)
);

CREATE INDEX IF NOT EXISTS "presentation_slot_eventId_startsAt_idx"
  ON "presentation_slot" ("eventId", "startsAt");

CREATE TABLE IF NOT EXISTS "presentation_booking" (
  "id"        TEXT         NOT NULL,
  "slotId"    TEXT         NOT NULL,
  -- The lead, not a phone number: the registration already created one, and it
  -- is what the rep follows up.
  "leadId"    TEXT         NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "presentation_booking_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "presentation_booking_slotId_fkey" FOREIGN KEY ("slotId")
    REFERENCES "presentation_slot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "presentation_booking_leadId_fkey" FOREIGN KEY ("leadId")
    REFERENCES "lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- One seat per person per talk, enforced in the database rather than by the
-- endpoint. A double-tap on a phone at a stall is the ordinary case, not the
-- exceptional one, and two requests can be in flight before either has written.
CREATE UNIQUE INDEX IF NOT EXISTS "presentation_booking_slotId_leadId_key"
  ON "presentation_booking" ("slotId", "leadId");

CREATE INDEX IF NOT EXISTS "presentation_booking_leadId_idx"
  ON "presentation_booking" ("leadId");
