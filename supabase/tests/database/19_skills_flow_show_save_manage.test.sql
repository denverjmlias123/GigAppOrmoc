BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(23);

-- Setup test users:
-- User 1 (1901): Freelancer in 'find_work' mode
-- User 2 (1902): Second Freelancer in 'find_work' mode (for cross-user dedupe & RLS read test)
-- User 3 (1903): Client in 'hire' mode (for wrong-mode denial tests)
INSERT INTO auth.users (
  id, email, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '00000000-0000-0000-0000-000000001901',
    'm19.freelancer1@ormoc.test',
    '{"display_name": "Freelancer One", "dob": "1995-03-14", "terms_version": "v1.0"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000001902',
    'm19.freelancer2@ormoc.test',
    '{"display_name": "Freelancer Two", "dob": "1994-08-22", "terms_version": "v1.0"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000001903',
    'm19.client@ormoc.test',
    '{"display_name": "Client Three", "dob": "1989-11-05", "terms_version": "v1.0"}'::jsonb,
    now(),
    now()
  );

UPDATE public.profiles
SET active_mode = 'find_work', mode_changed_at = now() - interval '10 days'
WHERE id IN ('00000000-0000-0000-0000-000000001901', '00000000-0000-0000-0000-000000001902');

UPDATE public.profiles
SET active_mode = 'hire', mode_changed_at = now() - interval '10 days'
WHERE id = '00000000-0000-0000-0000-000000001903';

-- Insert 12 active admin catalog skills inside the test transaction (rolled back at the end)
INSERT INTO public.skills (id, name, source, is_active) VALUES
  ('10000000-0000-0000-0000-000000001901', 'M19 Catalog Skill 01', 'admin', true),
  ('10000000-0000-0000-0000-000000001902', 'M19 Catalog Skill 02', 'admin', true),
  ('10000000-0000-0000-0000-000000001903', 'M19 Catalog Skill 03', 'admin', true),
  ('10000000-0000-0000-0000-000000001904', 'M19 Catalog Skill 04', 'admin', true),
  ('10000000-0000-0000-0000-000000001905', 'M19 Catalog Skill 05', 'admin', true),
  ('10000000-0000-0000-0000-000000001906', 'M19 Catalog Skill 06', 'admin', true),
  ('10000000-0000-0000-0000-000000001907', 'M19 Catalog Skill 07', 'admin', true),
  ('10000000-0000-0000-0000-000000001908', 'M19 Catalog Skill 08', 'admin', true),
  ('10000000-0000-0000-0000-000000001909', 'M19 Catalog Skill 09', 'admin', true),
  ('10000000-0000-0000-0000-000000001910', 'M19 Catalog Skill 10', 'admin', true),
  ('10000000-0000-0000-0000-000000001911', 'M19 Catalog Skill 11', 'admin', true),
  ('10000000-0000-0000-0000-000000001912', 'M19 Catalog Skill 12', 'admin', true);

-- Switch to User 1 (authenticated freelancer)
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000001901';

-- Test 1: Selected set equals saved set (1 catalog ID + 2 custom names -> 3 saved skills returned)
SELECT is(
  (
    SELECT count(*)::int
    FROM public.add_profile_skills(
      ARRAY['10000000-0000-0000-0000-000000001901'::uuid],
      ARRAY['Ormoc Inverter Servicing'::text, 'Ormoc Tig Welding'::text]
    )
  ),
  3,
  '1. Selected set (1 catalog + 2 custom) saves and returns all 3 skills'
);

-- Test 2: Simulated relaunch query via RLS returns all 3 saved skills (including pending custom skills)
SELECT is(
  (
    SELECT array_agg(s.name ORDER BY s.name ASC)
    FROM public.profile_skills ps
    JOIN public.skills s ON s.id = ps.skill_id
    WHERE ps.profile_id = '00000000-0000-0000-0000-000000001901'::uuid
  ),
  ARRAY['M19 Catalog Skill 01', 'Ormoc Inverter Servicing', 'Ormoc Tig Welding']::text[],
  '2. Relaunch SELECT query returns exact saved skill names in alphabetical order'
);

-- Test 3: New custom skill has source = 'user' and is_active = false (Pending review)
SELECT results_eq(
  $$SELECT source, is_active FROM public.skills WHERE name = 'Ormoc Inverter Servicing'$$,
  $$VALUES ('user'::text, false)$$,
  '3. Newly created custom skill is marked source = user and is_active = false (Pending review)'
);

-- Test 4: Case-insensitive & whitespace dedupe against catalog skill reuses existing catalog row
SELECT is(
  (
    SELECT count(*)::int
    FROM public.add_profile_skills(
      ARRAY[]::uuid[],
      ARRAY['  m19   catalog   skill 02  '::text]
    )
    WHERE out_skill_id = '10000000-0000-0000-0000-000000001902'::uuid
  ),
  1,
  '4. Custom name matching catalog skill case-insensitively reuses existing catalog skill row'
);

-- Test 5: Reusing an existing catalog skill does NOT increment user custom skill count (still 2 new custom skills created by User 1)
SELECT is(
  (
    SELECT count(*)::int
    FROM public.skills
    WHERE created_by = '00000000-0000-0000-0000-000000001901'::uuid
      AND source = 'user'
  ),
  2,
  '5. Deduplicated skill does not count toward new custom skill creation quota'
);

-- Switch to User 2 (second freelancer) to test cross-user custom skill dedupe & RLS visibility
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000001902';

-- Test 6: User 2 cannot see User 1's pending custom skill before linking it
SELECT is(
  (
    SELECT count(*)::int
    FROM public.skills
    WHERE name = 'Ormoc Inverter Servicing'
  ),
  0,
  '6. Pending custom skill is hidden from other users before they add it'
);

-- Test 7: User 2 adding the same custom skill (different casing) reuses User 1's skill row without creating a duplicate
SELECT is(
  (
    SELECT out_skill_name
    FROM public.add_profile_skills(
      ARRAY[]::uuid[],
      ARRAY['ormoc inverter servicing'::text]
    )
    LIMIT 1
  ),
  'Ormoc Inverter Servicing',
  '7. Cross-user custom skill deduplicates case-insensitively to existing skill row'
);

-- Test 8: After linking, User 2 CAN read the deduplicated pending custom skill on relaunch via RLS
SELECT is(
  (
    SELECT count(*)::int
    FROM public.profile_skills ps
    JOIN public.skills s ON s.id = ps.skill_id
    WHERE ps.profile_id = '00000000-0000-0000-0000-000000001902'::uuid
      AND s.name = 'Ormoc Inverter Servicing'
  ),
  1,
  '8. Second user can read deduplicated pending skill on relaunch via profile_skills RLS policy'
);

-- Switch back to User 1 for validation and quota tests
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000001901';

-- Test 9: Rejects custom skill shorter than 2 characters
SELECT throws_ok(
  $$SELECT * FROM public.add_profile_skills(ARRAY[]::uuid[], ARRAY['A'::text])$$,
  'P0001',
  'Custom skill name must be between 2 and 40 characters: A',
  '9. Rejects custom skill shorter than 2 characters'
);

-- Test 10: Rejects custom skill longer than 40 characters
SELECT throws_ok(
  $$SELECT * FROM public.add_profile_skills(ARRAY[]::uuid[], ARRAY[repeat('B', 41)::text])$$,
  'P0001',
  'Custom skill name must be between 2 and 40 characters: ' || repeat('B', 41),
  '10. Rejects custom skill longer than 40 characters'
);

-- Test 11: Rejects custom skill containing an email address
SELECT throws_ok(
  $$SELECT * FROM public.add_profile_skills(ARRAY[]::uuid[], ARRAY['me@ormoc.com'::text])$$,
  'P0001',
  'Skill name cannot contain an email address.',
  '11. Rejects custom skill containing an email address'
);

-- Test 12: Rejects custom skill containing a website or URL
SELECT throws_ok(
  $$SELECT * FROM public.add_profile_skills(ARRAY[]::uuid[], ARRAY['https://ormocwork.com'::text])$$,
  'P0001',
  'Skill name cannot contain a website or URL.',
  '12. Rejects custom skill containing a URL'
);

-- Test 13: Rejects custom skill containing a phone number
SELECT throws_ok(
  $$SELECT * FROM public.add_profile_skills(ARRAY[]::uuid[], ARRAY['Call 09171234567'::text])$$,
  'P0001',
  'Skill name cannot contain a phone number.',
  '13. Rejects custom skill containing a phone number'
);

-- Test 14: Rejects custom skill with only numbers / no letters
SELECT throws_ok(
  $$SELECT * FROM public.add_profile_skills(ARRAY[]::uuid[], ARRAY['12345'::text])$$,
  'P0001',
  'Skill name must include letters.',
  '14. Rejects custom skill containing no letters'
);

-- Test 15: Rejects custom skill with disallowed special characters
SELECT throws_ok(
  $$SELECT * FROM public.add_profile_skills(ARRAY[]::uuid[], ARRAY['Plumbing $500'::text])$$,
  'P0001',
  'Skill name may only contain letters, numbers, spaces, and & - + . /.',
  '15. Rejects custom skill with disallowed special characters'
);

-- Test 16: Rejects custom skill containing profanity
SELECT throws_ok(
  $$SELECT * FROM public.add_profile_skills(ARRAY[]::uuid[], ARRAY['Gago Repair'::text])$$,
  'P0001',
  'Skill name contains inappropriate language.',
  '16. Rejects custom skill containing profanity'
);

-- Test 17: User 1 can create 3 more new custom skills (reaching 5 new custom skills in 24h)
SELECT is(
  (
    SELECT count(*)::int
    FROM public.add_profile_skills(
      ARRAY[]::uuid[],
      ARRAY[
        'Ormoc Solar Panel Setup'::text,
        'Ormoc Piso Wifi Repair'::text,
        'Ormoc CCTV Cabling'::text
      ]
    )
  ),
  7,
  '17. User 1 reaches 5 new custom skills in 24h (plus 2 catalog skills = 7 total skills)'
);

-- Test 18: 6th new custom skill in 24h is rejected by the 5-per-24h quota
SELECT throws_ok(
  $$SELECT * FROM public.add_profile_skills(ARRAY[]::uuid[], ARRAY['Ormoc Sixth Custom Skill'::text])$$,
  'P0001',
  'You can create at most 5 new custom skills per 24 hours.',
  '18. Rejects 6th new custom skill within 24 hours'
);

-- Test 19: User 1 can add 8 more catalog skills to reach the 15-skill profile cap, and a 16th skill is rejected
SELECT lives_ok(
  $$SELECT * FROM public.add_profile_skills(
    ARRAY[
      '10000000-0000-0000-0000-000000001903'::uuid,
      '10000000-0000-0000-0000-000000001904'::uuid,
      '10000000-0000-0000-0000-000000001905'::uuid,
      '10000000-0000-0000-0000-000000001906'::uuid,
      '10000000-0000-0000-0000-000000001907'::uuid,
      '10000000-0000-0000-0000-000000001908'::uuid,
      '10000000-0000-0000-0000-000000001909'::uuid,
      '10000000-0000-0000-0000-000000001910'::uuid
    ],
    ARRAY[]::text[]
  )$$,
  '19. Adding catalog skills up to 15 total skills succeeds'
);

-- Test 20: Adding a 16th skill throws the 15-skill profile limit error
SELECT throws_ok(
  $$SELECT * FROM public.add_profile_skills(
    ARRAY['10000000-0000-0000-0000-000000001911'::uuid],
    ARRAY[]::text[]
  )$$,
  'P0001',
  'Maximum limit of 15 skills per profile reached.',
  '20. Rejects adding a 16th skill beyond the 15-skill profile limit'
);

-- Test 21: remove_profile_skill removes a skill from the user's profile
SELECT lives_ok(
  $$SELECT public.remove_profile_skill('10000000-0000-0000-0000-000000001910'::uuid)$$,
  '21. remove_profile_skill deletes the skill cleanly'
);

-- Switch to User 3 (Client in 'hire' mode)
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000001903';

-- Test 22: Client in 'hire' mode is rejected from add_profile_skills
SELECT throws_ok(
  $$SELECT * FROM public.add_profile_skills(
    ARRAY['10000000-0000-0000-0000-000000001901'::uuid],
    ARRAY[]::text[]
  )$$,
  'P0001',
  'Skills can only be added in Find Work (Freelancer) mode.',
  '22. Rejects add_profile_skills when user is in hire mode'
);

-- Test 23: Direct INSERT into public.profile_skills is denied for authenticated role
SELECT throws_ok(
  $$INSERT INTO public.profile_skills (profile_id, skill_id)
    VALUES ('00000000-0000-0000-0000-000000001901'::uuid, '10000000-0000-0000-0000-000000001912'::uuid)$$,
  '42501',
  NULL,
  '23. Direct INSERT into public.profile_skills is denied for authenticated role'
);

SELECT * FROM finish();
ROLLBACK;
