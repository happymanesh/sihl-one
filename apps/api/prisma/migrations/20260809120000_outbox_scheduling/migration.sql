-- ---------------------------------------------------------------------------
-- Outbox relay scheduling.
--
-- Phase 1 wrote events reliably but had no relay. Delivering them needs two
-- things the original table lacked: a time before which an event should not be
-- retried (so a failing consumer is backed off rather than hammered), and a
-- terminal state for events that will never succeed (so the relay's working set
-- does not grow forever behind one poisoned row).
-- ---------------------------------------------------------------------------

ALTER TABLE "outbox_event"
    ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "deadLetteredAt" TIMESTAMP(3);

-- The relay's only hot query: "unpublished, not dead-lettered, due now".
-- A partial index keeps it proportional to the backlog rather than to the
-- entire event history, which is append-only and grows without bound.
CREATE INDEX "outbox_due_idx"
    ON "outbox_event" ("nextAttemptAt")
    WHERE "publishedAt" IS NULL AND "deadLetteredAt" IS NULL;

-- Operators need to find poisoned events quickly during an incident.
CREATE INDEX "outbox_dead_letter_idx"
    ON "outbox_event" ("deadLetteredAt")
    WHERE "deadLetteredAt" IS NOT NULL;
