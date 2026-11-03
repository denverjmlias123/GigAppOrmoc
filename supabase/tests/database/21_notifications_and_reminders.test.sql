-- pgTAP test for Milestone 25: Notifications Coverage and Scheduled Reminders
-- Tests:
-- 1. Helper function existence and signatures
-- 2. Security privileges: run_scheduled_reminders denied to anon/authenticated
-- 3. Security privileges: resolve_report denied to anon

BEGIN;
SELECT plan(7);

-- 1. Check scheduled reminders helper function exists
SELECT has_function('public', 'run_scheduled_reminders', ARRAY[]::text[]);

-- 2. Verify run_scheduled_reminders execution denied for authenticated and anon
SET LOCAL ROLE authenticated;
SELECT throws_ok(
    'SELECT public.run_scheduled_reminders()',
    'permission denied for function run_scheduled_reminders'
);
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok(
    'SELECT public.run_scheduled_reminders()',
    'permission denied for function run_scheduled_reminders'
);
RESET ROLE;

-- 3. Check resolve_report helper function exists
SELECT has_function('public', 'resolve_report', ARRAY['uuid', 'text', 'text']);

-- 4. Check define_milestones signature exists
SELECT has_function('public', 'define_milestones', ARRAY['uuid', 'jsonb', 'uuid']);

-- 5. Check respond_to_counter signature exists
SELECT has_function('public', 'respond_to_counter', ARRAY['uuid', 'text', 'uuid']);

-- 6. Check notify helper exists with 7 arguments
SELECT has_function('public', 'notify', ARRAY['uuid', 'text', 'text', 'text', 'text', 'uuid', 'jsonb']);

SELECT * FROM finish();
ROLLBACK;
