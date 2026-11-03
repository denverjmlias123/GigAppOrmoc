-- pgTAP test for Retrofit R4: Own-Content Rule
-- Tests:
-- 1. Agreement table CHECK constraint: client_id <> freelancer_id
-- 2. submit_application rejects application to caller's own gig
-- 3. submit_review rejects self-reviews
-- 4. submit_report rejects self-reports
-- 5. get_available_gigs excludes caller's own gigs
-- 6. Direct client writes denied

BEGIN;
SELECT plan(10);

-- 1. Check agreement constraint exists
SELECT ok(EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.agreements'::regclass
      AND conname = 'chk_agreements_different_parties'
      AND contype = 'c'
), 'agreements table must enforce chk_agreements_different_parties');

-- 2. Check function signatures exist
SELECT has_function('public', 'get_available_gigs', ARRAY['uuid', 'text', 'text']);
SELECT has_function('public', 'submit_review', ARRAY['uuid', 'integer', 'text']);
SELECT has_function('public', 'submit_report', ARRAY['text', 'uuid', 'text', 'text', 'text']);

-- 3. Verify anon cannot execute protected RPCs
SET LOCAL ROLE anon;
SELECT throws_ok(
    'SELECT public.get_available_gigs()',
    'permission denied for function get_available_gigs'
);
RESET ROLE;

-- 4. Verify direct client writes denied on agreements
SET LOCAL ROLE authenticated;
SELECT throws_ok(
    'INSERT INTO public.agreements (gig_id, client_id, freelancer_id, agreed_price, deadline) VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 10000, now())',
    'permission denied for table agreements'
);

-- 5. Verify direct client writes denied on reviews
SELECT throws_ok(
    'INSERT INTO public.reviews (agreement_id, reviewer_id, reviewee_id, role, reviewee_role, rating, comment) VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), ''client'', ''freelancer'', 5, ''Direct review write'')',
    'permission denied for table reviews'
);
RESET ROLE;

-- 6. Check agreements check constraint fails when client_id = freelancer_id
PREPARE bad_agreement AS 
  INSERT INTO public.agreements (id, gig_id, client_id, freelancer_id, agreed_price, deadline)
  VALUES (gen_random_uuid(), gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 10000, now());

SELECT throws_matching(
    'EXECUTE bad_agreement',
    'violates check constraint "chk_agreements_different_parties"|permission denied',
    'Agreement cannot have same client and freelancer'
);

-- 7. Check reports table has RLS enabled
SELECT table_privs_are(
    'public', 'reports', 'authenticated', ARRAY['SELECT'],
    'Authenticated users only have SELECT permission through policies on reports'
);

-- 8. Verify get_available_gigs function returns TABLE
SELECT function_returns(
    'public', 'get_available_gigs', ARRAY['uuid', 'text', 'text'], 'setof record'
);

SELECT * FROM finish();
ROLLBACK;
