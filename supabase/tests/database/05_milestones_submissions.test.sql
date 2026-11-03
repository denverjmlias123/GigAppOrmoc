-- pgTAP tests for Milestone 5: Milestones and Submissions
BEGIN;
SELECT plan(12);

-- 1. Table structure tests
SELECT has_table('public', 'milestones', 'Table milestones exists');
SELECT has_table('public', 'submissions', 'Table submissions exists');

SELECT has_column('public', 'milestones', 'id', 'milestones has id');
SELECT has_column('public', 'milestones', 'agreement_id', 'milestones has agreement_id');
SELECT has_column('public', 'milestones', 'seq', 'milestones has seq');
SELECT has_column('public', 'milestones', 'amount', 'milestones has amount');
SELECT has_column('public', 'milestones', 'status', 'milestones has status');
SELECT has_column('public', 'milestones', 'revision_count', 'milestones has revision_count');

SELECT has_column('public', 'submissions', 'milestone_id', 'submissions has milestone_id');
SELECT has_column('public', 'submissions', 'submission_number', 'submissions has submission_number');
SELECT has_column('public', 'submissions', 'file_paths', 'submissions has file_paths');

-- 2. Verify functions exist
SELECT has_function('public', 'define_milestones', ARRAY['uuid', 'jsonb'], 'Function define_milestones exists');

SELECT * FROM finish();
ROLLBACK;
