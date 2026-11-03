-- pgTAP tests for Milestone 16: Duplicate email safety net, profile completeness, update_profile_details, and avatar management
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions, auth;
SELECT plan(18);

-- 1. Create two test users (Freelancer A and Client B)
INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at)
VALUES
  ('00000000-0000-0000-0000-000000001601', 'freelancer16@ormoc.test', '{"display_name": "Ana Freelancer", "dob": "1998-05-10"}'::jsonb, now()),
  ('00000000-0000-0000-0000-000000001602', 'client16@ormoc.test', '{"display_name": "Ben Client", "dob": "1992-08-20"}'::jsonb, now());

-- Test 1: Idempotency of handle_new_user (one auth user can never produce two profiles or two profile_private rows)
SELECT is(
  (SELECT count(*)::int FROM public.profiles WHERE id = '00000000-0000-0000-0000-000000001601'),
  1,
  'Exactly one profile row created for user 1601'
);

SELECT is(
  (SELECT count(*)::int FROM public.profile_private WHERE user_id = '00000000-0000-0000-0000-000000001601'),
  1,
  'Exactly one profile_private row created for user 1601'
);

-- Authenticate as Freelancer A (1601)
SET LOCAL role = authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "00000000-0000-0000-0000-000000001601", "role": "authenticated"}';

SELECT public.choose_initial_mode('find_work');

-- Test 3: Initial freelancer completeness (only display_name is present -> 1 of 7 = 14%)
SELECT is(
  (public.get_profile_completeness('00000000-0000-0000-0000-000000001601')->>'complete')::boolean,
  false,
  'Initial freelancer profile is not complete'
);

SELECT is(
  (public.get_profile_completeness('00000000-0000-0000-0000-000000001601')->>'percent')::int,
  14,
  'Initial freelancer completeness is 14% (1/7 items)'
);

-- Test 5: update_profile_details rejects display_name shorter than 2 chars
SELECT throws_ok(
  $$SELECT public.update_profile_details('A')$$,
  'Display name must be between 2 and 50 characters.',
  'update_profile_details rejects display_name < 2 chars'
);

-- Test 6: update_profile_details rejects non-empty bio shorter than 20 chars
SELECT throws_ok(
  $$SELECT public.update_profile_details('Ana Freelancer', 'Tutor', 'Too short bio')$$,
  'Bio must be between 20 and 500 characters.',
  'update_profile_details rejects bio < 20 chars'
);

-- Test 7: update_profile_details rejects invalid language
SELECT throws_ok(
  $$SELECT public.update_profile_details('Ana Freelancer', 'Tutor', 'Experienced math tutor in Cogon, Ormoc City.', 'Cogon', 'In-app chat', ARRAY['Klingon']) $$,
  'Invalid language selection: Klingon',
  'update_profile_details rejects unsupported language'
);

-- Test 8: update_profile_details saves valid freelancer details and stores phone ONLY in profile_private
SELECT lives_ok(
  $$SELECT public.update_profile_details(
    'Ana Freelancer',
    'Math & Science Tutor in Cogon',
    'Experienced tutor helping high school students in Ormoc City.',
    'Cogon',
    'In-app chat',
    ARRAY['English', 'Bisaya'],
    '09171234567',
    ARRAY['face_to_face', 'remote'],
    'available_now',
    '1_3',
    'Starts at ₱250/hr'
  )$$,
  'update_profile_details succeeds with valid freelancer details'
);

SELECT is(
  (SELECT phone FROM public.profile_private WHERE user_id = '00000000-0000-0000-0000-000000001601'),
  '09171234567',
  'Optional phone is saved in profile_private'
);

-- Add 1 skill for Freelancer A
SELECT public.add_profile_skills(ARRAY[]::uuid[], ARRAY['Algebra Tutoring']);

-- Test 10: set_profile_avatar rejects avatar path belonging to another user's folder
SELECT throws_ok(
  $$SELECT public.set_profile_avatar('00000000-0000-0000-0000-000000001602/avatar-123.jpg')$$,
  'Avatar path must be inside your own user folder.',
  'set_profile_avatar rejects another user folder path'
);

-- Test 11: set_profile_avatar sets own avatar path and triggers 100% completeness + one-time notification
SELECT lives_ok(
  $$SELECT public.set_profile_avatar('https://example.supabase.co/storage/v1/object/public/avatars/00000000-0000-0000-0000-000000001601/avatar-100.jpg')$$,
  'set_profile_avatar succeeds for own folder path'
);

SELECT is(
  (public.get_profile_completeness('00000000-0000-0000-0000-000000001601')->>'complete')::boolean,
  true,
  'Freelancer profile is now 100% complete'
);

-- Test 13: Calling get_profile_completeness again does NOT duplicate profile_complete notification
SELECT public.get_profile_completeness('00000000-0000-0000-0000-000000001601');
SELECT is(
  (SELECT count(*)::int FROM public.notifications WHERE user_id = '00000000-0000-0000-0000-000000001601' AND type = 'profile_complete'),
  1,
  'profile_complete notification is emitted exactly once'
);

-- Test 14: Replacing avatar returns previous_avatar_path
SELECT is(
  (public.set_profile_avatar('https://example.supabase.co/storage/v1/object/public/avatars/00000000-0000-0000-0000-000000001601/avatar-200.jpg')->>'previous_avatar_path'),
  'https://example.supabase.co/storage/v1/object/public/avatars/00000000-0000-0000-0000-000000001601/avatar-100.jpg',
  'set_profile_avatar returns previous_avatar_path for storage cleanup'
);

-- Test 15: Removing avatar clears avatar_path and reduces completeness below 100%
SELECT public.set_profile_avatar(NULL);
SELECT is(
  (public.get_profile_completeness('00000000-0000-0000-0000-000000001601')->>'complete')::boolean,
  false,
  'Removing avatar marks profile incomplete again'
);

-- Test 16-18: Anon cannot execute M16 SECURITY DEFINER functions
SET LOCAL role = anon;
SET LOCAL "request.jwt.claims" = '{}';

SELECT throws_ok(
  $$SELECT public.get_profile_completeness('00000000-0000-0000-0000-000000001601')$$,
  '42501',
  NULL,
  'anon cannot execute get_profile_completeness'
);

SELECT throws_ok(
  $$SELECT public.update_profile_details('Anon')$$,
  '42501',
  NULL,
  'anon cannot execute update_profile_details'
);

SELECT throws_ok(
  $$SELECT public.set_profile_avatar(NULL)$$,
  '42501',
  NULL,
  'anon cannot execute set_profile_avatar'
);

SELECT * FROM finish();
ROLLBACK;
