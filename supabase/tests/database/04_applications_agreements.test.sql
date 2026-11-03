BEGIN;
SELECT plan(6);

-- Verify applications and agreements tables exist
SELECT has_table('public', 'applications', 'public.applications table should exist');
SELECT has_table('public', 'agreements', 'public.agreements table should exist');

-- Verify RLS is active on applications and agreements
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.applications'::regclass), 'RLS should be enabled on public.applications');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.agreements'::regclass), 'RLS should be enabled on public.agreements');

-- Verify unique constraints exist
SELECT col_is_pk('public', 'agreements', 'id', 'agreements should have primary key on id');
SELECT col_is_pk('public', 'applications', 'id', 'applications should have primary key on id');

SELECT * FROM finish();
ROLLBACK;
