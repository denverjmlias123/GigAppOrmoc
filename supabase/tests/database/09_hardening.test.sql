-- pgTAP tests for Milestone 9 & V3 Hardening
BEGIN;
SELECT plan(10);

-- 1. Table structure tests
SELECT has_table('public', 'agreements', 'Table agreements exists');
SELECT has_table('public', 'reviews', 'Table reviews exists');

SELECT has_column('public', 'agreements', 'completed_at', 'agreements has completed_at');
SELECT has_column('public', 'reviews', 'reviewee_role', 'reviews has reviewee_role');
SELECT has_column('public', 'reviews', 'hidden', 'reviews has hidden');
SELECT has_column('public', 'reviews', 'hidden_at', 'reviews has hidden_at');
SELECT has_column('public', 'reviews', 'hidden_by', 'reviews has hidden_by');

-- 2. Verify admin_hide_review function exists
SELECT has_function('public', 'admin_hide_review', ARRAY['uuid', 'text'], 'Function admin_hide_review exists');

-- 3. Verify submit_review function exists
SELECT has_function('public', 'submit_review', ARRAY['uuid', 'integer', 'text'], 'Function submit_review exists');

-- 4. Verify get_mode_switch_status function exists
SELECT has_function('public', 'get_mode_switch_status', ARRAY[]::text[], 'Function get_mode_switch_status exists');

SELECT * FROM finish();
ROLLBACK;
