-- Whether an event offers seat booking at all.
--
-- Separate from having slots. An event can have a schedule that is not yet
-- open to visitors, and a schedule that has to be closed in a hurry without
-- deleting the talks or the bookings already taken — switching the provision
-- off is one click, deleting a day's schedule is not recoverable.
--
-- Defaults to off, so every event that already exists is unaffected.

ALTER TABLE "event"
  ADD COLUMN IF NOT EXISTS "allowsPresentationBooking" BOOLEAN NOT NULL DEFAULT false;
