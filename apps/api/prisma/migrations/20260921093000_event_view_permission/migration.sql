-- Give the existing roles the new `event:view` permission.
--
-- Permissions are read from the `role` rows at runtime, not from the contracts
-- matrix, so adding a permission in code changes nothing until the rows carry
-- it. The events list and detail routes now require `event:view`; without this
-- backfill the first deploy would take those screens away from super admins,
-- management and marketing — a permission change nobody asked for, arriving as
-- a silent 403 on a screen that worked yesterday.
--
-- Scoped to roles that already hold `campaign:read`, which is exactly the set
-- that could reach those routes before. Nobody gains anything they did not
-- already have.
--
-- Idempotent: the guard clause means a second run appends nothing.

UPDATE "role"
SET "permissions" = array_append("permissions", 'event:view')
WHERE 'campaign:read' = ANY ("permissions")
  AND NOT ('event:view' = ANY ("permissions"));
