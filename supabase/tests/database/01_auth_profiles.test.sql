BEGIN;
SELECT plan(6);

-- Verify tables exist
SELECT has_table('public', 'profiles', 'public.profiles table should exist');
SELECT has_table('public', 'profile_private', 'public.profile_private table should exist');
SELECT has_table('public', 'platform_admins', 'public.platform_admins table should exist');

-- Verify RLS is enabled on all tables
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.profiles'::regclass), 'RLS should be enabled on public.profiles');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.profile_private'::regclass), 'RLS should be enabled on public.profile_private');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.platform_admins'::regclass), 'RLS should be enabled on public.platform_admins');

SELECT * FROM finish();
ROLLBACK;
