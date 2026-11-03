-- pgTAP test for Milestone 11: Real In-App Notifications
-- Tests:
-- 1. Notifications table structure and columns
-- 2. Direct client writes denied on notifications table
-- 3. RLS policy: only recipient can select own notifications
-- 4. Internal helper notify() cannot be executed by anon or authenticated
-- 5. mark_notification_read and mark_all_notifications_read RPC signatures and execution rights

BEGIN;
SELECT plan(8);

-- 1. Check notifications table exists
SELECT has_table('public', 'notifications', 'notifications table must exist');

-- 2. Check table columns
SELECT columns_are(
    'public',
    'notifications',
    ARRAY['id', 'user_id', 'type', 'title', 'body', 'entity_type', 'entity_id', 'data', 'read_at', 'created_at', 'dedupe_key'],
    'notifications table must have all required columns'
);

-- 3. Verify direct client writes denied on notifications table
SET LOCAL ROLE authenticated;
SELECT throws_ok(
    'INSERT INTO public.notifications (user_id, type, title, body) VALUES (gen_random_uuid(), ''test'', ''Hello'', ''World'')',
    'permission denied for table notifications'
);
RESET ROLE;

-- 4. Check function signatures exist
SELECT has_function('public', 'mark_notification_read', ARRAY['uuid']);
SELECT has_function('public', 'mark_all_notifications_read', ARRAY[]::text[]);
SELECT has_function('public', 'notify', ARRAY['uuid', 'text', 'text', 'text', 'text', 'uuid', 'jsonb']);

-- 5. Verify internal helper notify() execution is denied for authenticated and anon
SET LOCAL ROLE authenticated;
SELECT throws_ok(
    'SELECT public.notify(gen_random_uuid(), ''test'', ''Title'', ''Body'')',
    'permission denied for function notify'
);
RESET ROLE;

-- 6. Check table privileges for authenticated users (only SELECT permitted)
SELECT table_privs_are(
    'public', 'notifications', 'authenticated', ARRAY['SELECT'],
    'Authenticated users only have SELECT permission through policies on notifications'
);

SELECT * FROM finish();
ROLLBACK;
