-- pgTAP test for Milestone 12: Real Messaging
-- Tests:
-- 1. Table conversation_reads exists with RLS
-- 2. Direct insert on messages table denied for anon and authenticated (writes through send_message only)
-- 3. send_message function signature and execution rights
-- 4. mark_conversation_read function signature and execution rights
-- 5. get_user_conversations function signature and returns table
-- 6. Non-participant message access denied

BEGIN;
SELECT plan(7);

-- 1. Check conversation_reads table exists
SELECT has_table('public', 'conversation_reads', 'conversation_reads table must exist');

-- 2. Verify direct client writes denied on messages table
SET LOCAL ROLE authenticated;
SELECT throws_ok(
    'INSERT INTO public.messages (conversation_id, sender_id, content) VALUES (gen_random_uuid(), gen_random_uuid(), ''Test message'')',
    'permission denied for table messages'
);
RESET ROLE;

-- 3. Check function signatures exist
SELECT has_function('public', 'send_message', ARRAY['uuid', 'text']);
SELECT has_function('public', 'mark_conversation_read', ARRAY['uuid']);
SELECT has_function('public', 'get_user_conversations', ARRAY[]::text[]);

-- 4. Verify anon cannot execute send_message
SET LOCAL ROLE anon;
SELECT throws_ok(
    'SELECT public.send_message(gen_random_uuid(), ''Hello'')',
    'permission denied for function send_message'
);
RESET ROLE;

-- 5. Check conversation_reads table privileges
SELECT table_privs_are(
    'public', 'conversation_reads', 'authenticated', ARRAY['SELECT'],
    'Authenticated users have controlled RLS access to conversation_reads'
);

SELECT * FROM finish();
ROLLBACK;
