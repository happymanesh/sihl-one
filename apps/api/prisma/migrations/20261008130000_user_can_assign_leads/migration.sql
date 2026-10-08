-- Whether a person may hand a lead to somebody else.
--
-- Defaults to true so nobody loses a capability the moment this column exists:
-- every user keeps exactly what their role already gave them, and the switch
-- only ever takes it away afterwards, deliberately, one person at a time.
ALTER TABLE "app_user"
  ADD COLUMN IF NOT EXISTS "canAssignLeads" BOOLEAN NOT NULL DEFAULT true;
