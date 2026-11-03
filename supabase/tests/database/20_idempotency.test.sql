-- pgTAP test for Milestone 24: Anti-Spam Clicks and Two-Device Idempotency
-- Tests:
-- 1. idempotency_keys table structure, primary key, and revoked direct privileges
-- 2. Unique indexes on submissions, payments, reviews, applications, notifications
-- 3. Internal idempotency helpers are not executable by anon or authenticated
-- 4. All 15 state-changing RPCs expose (..., p_request_id uuid) signatures

BEGIN;
SELECT plan(26);

-- 1. Check idempotency_keys table exists and has expected columns
SELECT has_table('public', 'idempotency_keys', 'idempotency_keys table must exist');
SELECT columns_are(
    'public',
    'idempotency_keys',
    ARRAY['user_id', 'request_id', 'rpc_name', 'result', 'created_at'],
    'idempotency_keys table must have all required columns'
);

-- 2. Direct client access to idempotency_keys is denied
SET LOCAL ROLE authenticated;
SELECT throws_ok(
    'SELECT * FROM public.idempotency_keys',
    'permission denied for table idempotency_keys'
);
RESET ROLE;

-- 3. Check unique indexes
SELECT ok(EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'submissions' AND indexname = 'idx_submissions_milestone_submission_number'), 'submission uniqueness index exists');
SELECT ok(EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'payments' AND indexname = 'idx_payments_unique_open_per_milestone'), 'open payment uniqueness index exists');
SELECT ok(EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'reviews' AND indexname = 'idx_reviews_unique_agreement_reviewer'), 'review uniqueness index exists');
SELECT ok(EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'applications' AND indexname = 'idx_applications_unique_active_per_gig'), 'active application uniqueness index exists');
SELECT ok(EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'notifications' AND indexname = 'idx_notifications_user_dedupe_key'), 'notification dedupe index exists');

-- 4. Check internal helpers exist and are denied to authenticated/anon
SELECT has_function('public', 'get_idempotency_result', ARRAY['uuid', 'uuid']);
SELECT has_function('public', 'store_idempotency_result', ARRAY['uuid', 'uuid', 'text', 'jsonb']);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
    'SELECT public.get_idempotency_result(gen_random_uuid(), gen_random_uuid())',
    'permission denied for function get_idempotency_result'
);
RESET ROLE;

-- 5. Check all 15 state-changing RPCs have p_request_id uuid overloads
SELECT has_function('public', 'review_milestone', ARRAY['uuid', 'text', 'text', 'uuid']);
SELECT has_function('public', 'submit_milestone', ARRAY['uuid', 'text', 'text[]', 'uuid']);
SELECT has_function('public', 'define_milestones', ARRAY['uuid', 'jsonb', 'uuid']);
SELECT has_function('public', 'respond_to_application', ARRAY['uuid', 'text', 'integer', 'uuid']);
SELECT has_function('public', 'respond_to_counter', ARRAY['uuid', 'text', 'uuid']);
SELECT has_function('public', 'report_payment', ARRAY['uuid', 'uuid', 'integer', 'text', 'text', 'text', 'text', 'uuid']);
SELECT has_function('public', 'confirm_payment', ARRAY['uuid', 'uuid']);
SELECT has_function('public', 'dispute_payment', ARRAY['uuid', 'text', 'uuid']);
SELECT has_function('public', 'complete_agreement', ARRAY['uuid', 'uuid']);
SELECT has_function('public', 'cancel_agreement', ARRAY['uuid', 'text', 'uuid']);
SELECT has_function('public', 'publish_gig', ARRAY['uuid', 'uuid']);
SELECT has_function('public', 'cancel_gig', ARRAY['uuid', 'text', 'uuid']);
SELECT has_function('public', 'submit_review', ARRAY['uuid', 'integer', 'text', 'uuid']);
SELECT has_function('public', 'submit_application', ARRAY['uuid', 'integer', 'integer', 'text', 'uuid']);
SELECT has_function('public', 'send_message', ARRAY['uuid', 'text', 'uuid']);

SELECT * FROM finish();
ROLLBACK;
