-- Migration: 20261011000021_fix_submissions_columns.sql
-- Fixes submissions and audit_events columns compatibility for loop RPCs

ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.submissions ALTER COLUMN submission_number DROP NOT NULL;
ALTER TABLE public.submissions ALTER COLUMN message DROP NOT NULL;

-- Support both (action, entity_type, entity_id) and (event_type, target_table, target_id) on audit_events
ALTER TABLE public.audit_events ADD COLUMN IF NOT EXISTS event_type TEXT;
ALTER TABLE public.audit_events ADD COLUMN IF NOT EXISTS target_id UUID;
ALTER TABLE public.audit_events ADD COLUMN IF NOT EXISTS target_table TEXT;
ALTER TABLE public.audit_events ALTER COLUMN action DROP NOT NULL;
ALTER TABLE public.audit_events ALTER COLUMN entity_type DROP NOT NULL;
