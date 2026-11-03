-- pgTAP tests for Milestone 7: Reviews
BEGIN;
SELECT plan(8);

-- 1. Table structure tests
SELECT has_table('public', 'reviews', 'Table reviews exists');

SELECT has_column('public', 'reviews', 'id', 'reviews has id');
SELECT has_column('public', 'reviews', 'agreement_id', 'reviews has agreement_id');
SELECT has_column('public', 'reviews', 'reviewer_id', 'reviews has reviewer_id');
SELECT has_column('public', 'reviews', 'reviewee_id', 'reviews has reviewee_id');
SELECT has_column('public', 'reviews', 'rating', 'reviews has rating');
SELECT has_column('public', 'reviews', 'comment', 'reviews has comment');

-- 2. Verify submit_review function exists
SELECT has_function('public', 'submit_review', ARRAY['uuid', 'integer', 'text'], 'Function submit_review exists');

SELECT * FROM finish();
ROLLBACK;
