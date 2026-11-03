-- pgTAP tests for Milestone 8: Reports and Messages
BEGIN;
SELECT plan(10);

-- 1. Table structure tests
SELECT has_table('public', 'conversations', 'Table conversations exists');
SELECT has_table('public', 'messages', 'Table messages exists');
SELECT has_table('public', 'reports', 'Table reports exists');

SELECT has_column('public', 'conversations', 'id', 'conversations has id');
SELECT has_column('public', 'conversations', 'application_id', 'conversations has application_id');
SELECT has_column('public', 'messages', 'content', 'messages has content');
SELECT has_column('public', 'reports', 'reason_category', 'reports has reason_category');

-- 2. Verify functions exist
SELECT has_function('public', 'get_or_create_conversation', ARRAY['uuid', 'uuid'], 'Function get_or_create_conversation exists');
SELECT has_function('public', 'send_message', ARRAY['uuid', 'text'], 'Function send_message exists');
SELECT has_function('public', 'cancel_agreement', ARRAY['uuid', 'text'], 'Function cancel_agreement exists');

SELECT * FROM finish();
ROLLBACK;
