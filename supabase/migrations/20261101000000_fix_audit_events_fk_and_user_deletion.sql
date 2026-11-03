-- Migration: Fix audit_events FK to allow user deletion without breaking append-only audit trigger
-- The actor_id foreign key constraint had ON DELETE SET NULL which clashed with the
-- audit_events_append_only trigger. Dropping the FK constraint preserves immutable audit history
-- while allowing users in auth.users to be deleted cleanly.

ALTER TABLE public.audit_events
  DROP CONSTRAINT IF EXISTS audit_events_actor_id_fkey;
