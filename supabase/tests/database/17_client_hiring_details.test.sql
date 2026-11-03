BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(15);

-- Setup test users:
-- User 1: Starts in 'hire' (Client) mode
-- User 2: Starts in 'find_work' (Freelancer) mode
INSERT INTO auth.users (
  id, email, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '00000000-0000-0000-0000-000000001701',
    'm17.client@ormoc.test',
    '{"display_name": "Client Maria", "dob": "1991-03-14", "terms_version": "v1.0"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000001702',
    'm17.freelancer@ormoc.test',
    '{"display_name": "FreelancerCarlo", "dob": "1994-08-22", "terms_version": "v1.0"}'::jsonb,
    now(),
    now()
  );

UPDATE public.profiles
SET active_mode = 'hire', mode_changed_at = now() - interval '10 days'
WHERE id = '00000000-0000-0000-0000-000000001701';

UPDATE public.profiles
SET active_mode = 'find_work', mode_changed_at = now() - interval '10 days'
WHERE id = '00000000-0000-0000-0000-000000001702';

-- 1. Client (hire mode) cannot call add_profile_skills
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000001701';

SELECT throws_ok(
  $$SELECT * FROM public.add_profile_skills(ARRAY[]::uuid[], ARRAY['Aircon Repair'])$$ ,
  'P0001',
  'Skills can only be added in Find Work (Freelancer) mode.',
  'Client in hire mode cannot add skills via add_profile_skills'
);

-- 2. Client cannot call remove_profile_skill
SELECT throws_ok(
  $$SELECT public.remove_profile_skill('00000000-0000-0000-0000-000000000001'::uuid)$$ ,
  'P0001',
  'Skills can only be modified in Find Work (Freelancer) mode.',
  'Client in hire mode cannot remove skills via remove_profile_skill'
);

-- 3. Client can save hiring details (including 'other' client_type and custom categories)
SELECT is(
  (public.save_hiring_details(
    'other'::text,
    'Ormoc Events Co'::text,
    'We hire local event helpers and graphic designers.'::text,
    ARRAY[]::uuid[],
    ARRAY['Event Staffing', 'Graphic Design', 'Errands & Delivery']::text[]
  )->>'client_type'),
  'other',
  'Client can save client_type = other and custom hiring interest categories'
);

SELECT is(
  (SELECT count(*)::integer FROM public.profile_hiring_interests WHERE profile_id = '00000000-0000-0000-0000-000000001701'),
  3,
  '3 hiring interests saved in profile_hiring_interests'
);

-- 4. Business name validation (2-60 chars if non-empty)
SELECT throws_ok(
  $$SELECT public.save_hiring_details('business'::text, 'A'::text, 'Valid about note'::text, NULL::uuid[], NULL::text[])$$,
  'P0001',
  'Business or organization name must be between 2 and 60 characters.',
  'Rejects 1-character business_name'
);

SELECT throws_ok(
  $$SELECT public.save_hiring_details('business'::text, repeat('B', 61)::text, 'Valid about note'::text, NULL::uuid[], NULL::text[])$$,
  'P0001',
  'Business or organization name must be between 2 and 60 characters.',
  'Rejects >60-character business_name'
);

-- 5. About hiring validation (<= 300 chars)
SELECT throws_ok(
  $$SELECT public.save_hiring_details('business'::text, 'Valid Shop'::text, repeat('X', 301)::text, NULL::uuid[], NULL::text[])$$,
  'P0001',
  'About hiring note must be 300 characters or fewer.',
  'Rejects >300-character about_hiring'
);

-- 6. Hiring interests limited to max 8 categories
SELECT throws_ok(
  $$SELECT public.save_hiring_details(
    'business'::text,
    'Valid Shop'::text,
    'Need help'::text,
    ARRAY[]::uuid[],
    ARRAY['Cat 1', 'Cat 2', 'Cat 3', 'Cat 4', 'Cat 5', 'Cat 6', 'Cat 7', 'Cat 8', 'Cat 9']::text[]
  )$$,
  'P0001',
  'You can select at most 8 hiring interests.',
  'Rejects more than 8 hiring interest categories'
);

-- 7. Freelancer (find_work mode) cannot call save_hiring_details
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000001702';

SELECT throws_ok(
  $$SELECT public.save_hiring_details('individual'::text, ''::text, 'Looking for work'::text, ARRAY[]::uuid[], ARRAY['Tutoring']::text[])$$,
  'P0001',
  'Hiring details can only be saved in Hire Someone (Client) mode.',
  'Freelancer in find_work mode cannot call save_hiring_details'
);

-- 8. Freelancer can add skills, then switch mode to 'hire', add hiring interests, and both skills & interests persist across mode switches
SELECT is(
  (SELECT count(*)::integer FROM public.add_profile_skills(ARRAY[]::uuid[], ARRAY['Plumbing Repair', 'Electrical Wiring']::text[])),
  2,
  'Freelancer adds 2 skills in find_work mode'
);

-- Switch User 2 from find_work to hire
SELECT lives_ok(
  $$SELECT public.switch_mode('hire', true)$$,
  'Freelancer switches to hire mode'
);

-- Skills remain intact in profile_skills after switching to hire mode
SELECT is(
  (SELECT count(*)::integer FROM public.profile_skills WHERE profile_id = '00000000-0000-0000-0000-000000001702'),
  2,
  'Skills persist in profile_skills when user switches from find_work to hire'
);

-- Now in hire mode, User 2 saves 2 hiring interests
SELECT lives_ok(
  $$SELECT public.save_hiring_details('individual'::text, ''::text, 'Need home repair help'::text, ARRAY[]::uuid[], ARRAY['Home Repair', 'Cleaning']::text[])$$,
  'User 2 saves hiring interests while in hire mode'
);

-- Fast-forward cooldown and switch User 2 back to find_work
RESET ROLE;
UPDATE public.profiles
SET mode_changed_at = now() - interval '8 days'
WHERE id = '00000000-0000-0000-0000-000000001702';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000001702';

SELECT lives_ok(
  $$SELECT public.switch_mode('find_work', true)$$,
  'User 2 switches back to find_work mode'
);

-- Both hiring interests and skills remain preserved in database
SELECT is(
  (
    SELECT (
      (SELECT count(*) FROM public.profile_skills WHERE profile_id = '00000000-0000-0000-0000-000000001702') = 2
      AND
      (SELECT count(*) FROM public.profile_hiring_interests WHERE profile_id = '00000000-0000-0000-0000-000000001702') = 2
    )
  ),
  true,
  'Both profile_skills and profile_hiring_interests persist across mode switches'
);

SELECT * FROM finish();
ROLLBACK;
