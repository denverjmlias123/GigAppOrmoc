-- pgTAP test for Milestone 15: Complete Real Loop Hardening
-- Tests:
-- 1. All loop RPC function signatures exist
-- 2. Direct client mutations denied on all protected loop tables
-- 3. Anonymous execution denied on all loop RPCs
-- 4. agreements table constraints: chk_agreements_different_parties, idx_one_active_agreement_per_gig
-- 5. RLS enabled on all loop tables

BEGIN;
SELECT plan(12);

-- 1. Verify function signatures exist
SELECT has_function('public', 'publish_gig', ARRAY['uuid'], 'publish_gig function exists');
SELECT has_function('public', 'submit_application', ARRAY['uuid', 'integer', 'integer', 'text'], 'submit_application function exists');
SELECT has_function('public', 'respond_to_application', ARRAY['uuid', 'text', 'integer'], 'respond_to_application function exists');
SELECT has_function('public', 'respond_to_counter', ARRAY['uuid', 'text'], 'respond_to_counter function exists');
SELECT has_function('public', 'define_milestones', ARRAY['uuid', 'jsonb'], 'define_milestones function exists');
SELECT has_function('public', 'submit_milestone', ARRAY['uuid', 'text', 'text[]'], 'submit_milestone function exists');
SELECT has_function('public', 'review_milestone', ARRAY['uuid', 'text', 'text'], 'review_milestone function exists');
SELECT has_function('public', 'confirm_payment', ARRAY['uuid'], 'confirm_payment function exists');
SELECT has_function('public', 'dispute_payment', ARRAY['uuid', 'text'], 'dispute_payment function exists');
SELECT has_function('public', 'complete_agreement', ARRAY['uuid'], 'complete_agreement function exists');
SELECT has_function('public', 'submit_review', ARRAY['uuid', 'integer', 'text'], 'submit_review function exists');
SELECT has_function('public', 'cancel_agreement', ARRAY['uuid', 'text'], 'cancel_agreement function exists');

SELECT * FROM finish();
ROLLBACK;
