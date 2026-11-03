BEGIN;
SELECT plan(8);

-- Verify tables exist
SELECT has_table('public', 'categories', 'public.categories table should exist');
SELECT has_table('public', 'skills', 'public.skills table should exist');
SELECT has_table('public', 'profile_skills', 'public.profile_skills table should exist');
SELECT has_table('public', 'portfolio_items', 'public.portfolio_items table should exist');

-- Verify RLS is active on all tables
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.categories'::regclass), 'RLS should be enabled on public.categories');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.skills'::regclass), 'RLS should be enabled on public.skills');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.profile_skills'::regclass), 'RLS should be enabled on public.profile_skills');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.portfolio_items'::regclass), 'RLS should be enabled on public.portfolio_items');

SELECT * FROM finish();
ROLLBACK;
