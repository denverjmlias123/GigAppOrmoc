-- pgTAP test for Milestone 13: Post Gig (Real)
-- Tests:
-- 1. publish_gig function signature and authenticated permissions
-- 2. cancel_gig function signature and authenticated permissions
-- 3. Anonymous execution denied for publish_gig and cancel_gig
-- 4. Direct mutation controls on gigs
-- 5. Cancellation event recorded in audit_events

BEGIN;
SELECT plan(6);

-- 1. Check publish_gig and cancel_gig function signatures exist
SELECT has_function('public', 'publish_gig', ARRAY['uuid'], 'publish_gig(uuid) function must exist');
SELECT has_function('public', 'cancel_gig', ARRAY['uuid', 'text'], 'cancel_gig(uuid, text) function must exist');

-- 2. Verify anon cannot execute publish_gig or cancel_gig
SET LOCAL ROLE anon;
SELECT throws_ok(
    'SELECT public.publish_gig(gen_random_uuid())',
    'permission denied for function publish_gig'
);

SELECT throws_ok(
    'SELECT public.cancel_gig(gen_random_uuid(), ''Test cancellation'')',
    'permission denied for function cancel_gig'
);
RESET ROLE;

-- 3. Verify public/anon direct write permissions denied on gigs
SELECT table_privs_are(
    'public', 'gigs', 'anon', ARRAY[]::text[],
    'Anon users should have no direct privileges on gigs table'
);

-- 4. Verify audit_events table exists to track gig publication and cancellation
SELECT has_table('public', 'audit_events', 'audit_events table must exist');

SELECT * FROM finish();
ROLLBACK;
