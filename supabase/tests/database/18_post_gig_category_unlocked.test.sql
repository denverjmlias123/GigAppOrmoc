BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(22);

-- Setup test users:
-- User 1 (1801): Client in 'hire' mode
-- User 2 (1802): Second Client in 'hire' mode
-- User 3 (1803): Platform Admin
INSERT INTO auth.users (
  id, email, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '00000000-0000-0000-0000-000000001801',
    'm18.client1@ormoc.test',
    '{"display_name": "Client One", "dob": "1990-04-10", "terms_version": "v1.0"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000001802',
    'm18.client2@ormoc.test',
    '{"display_name": "Client Two", "dob": "1992-07-19", "terms_version": "v1.0"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000001803',
    'm18.admin@ormoc.test',
    '{"display_name": "Platform Admin", "dob": "1988-01-15", "terms_version": "v1.0"}'::jsonb,
    now(),
    now()
  );

UPDATE public.profiles
SET active_mode = 'hire', mode_changed_at = now() - interval '10 days'
WHERE id IN ('00000000-0000-0000-0000-000000001801', '00000000-0000-0000-0000-000000001802');

INSERT INTO public.platform_admins (user_id)
VALUES ('00000000-0000-0000-0000-000000001803')
ON CONFLICT (user_id) DO NOTHING;

-- Switch to User 1 (authenticated client)
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000001801';

-- Test 1: Case & whitespace normalization dedupe returns the exact same category ID
SELECT is(
  public.get_or_create_category('Ormoc Appliance Care'::text),
  public.get_or_create_category('   ormoc   appliance   care  '::text),
  '1. Case and extra whitespace dedupe returns existing category ID'
);

-- Test 2: Singular/plural stem dedupe returns the existing category ID
SELECT is(
  public.get_or_create_category('Ormoc Appliance Cares'::text),
  public.get_or_create_category('Ormoc Appliance Care'::text),
  '2. Singular/plural variant returns existing category ID'
);

-- Test 3: Typo / near-duplicate trigram similarity returns the existing category ID
SELECT is(
  public.get_or_create_category('Ormoc Applianse Care'::text),
  public.get_or_create_category('Ormoc Appliance Care'::text),
  '3. Near-duplicate typo returns existing category ID via pg_trgm similarity'
);

-- Test 4: Rejects too short (< 3 chars)
SELECT throws_ok(
  $$SELECT public.get_or_create_category('AB'::text)$$,
  'P0001',
  'Category name must be between 3 and 40 characters.',
  '4. Rejects category name shorter than 3 characters'
);

-- Test 5: Rejects too long (> 40 chars)
SELECT throws_ok(
  $$SELECT public.get_or_create_category(repeat('A', 41)::text)$$,
  'P0001',
  'Category name must be between 3 and 40 characters.',
  '5. Rejects category name longer than 40 characters'
);

-- Test 6: Rejects URLs
SELECT throws_ok(
  $$SELECT public.get_or_create_category('https://ormocservice.com'::text)$$,
  'P0001',
  'Category name cannot contain a website or URL.',
  '6. Rejects category name containing a URL'
);

-- Test 7: Rejects emails
SELECT throws_ok(
  $$SELECT public.get_or_create_category('hire@ormoc.com'::text)$$,
  'P0001',
  'Category name cannot contain an email address.',
  '7. Rejects category name containing an email address'
);

-- Test 8: Rejects phone numbers
SELECT throws_ok(
  $$SELECT public.get_or_create_category('Call 09171234567'::text)$$,
  'P0001',
  'Category name cannot contain a phone number.',
  '8. Rejects category name containing a phone number'
);

-- Test 9: Rejects numbers-only category names
SELECT throws_ok(
  $$SELECT public.get_or_create_category('12345'::text)$$,
  'P0001',
  'Category name must include letters and cannot be just a number.',
  '9. Rejects category name with only numbers'
);

-- Test 10: Rejects all-caps shouting
SELECT throws_ok(
  $$SELECT public.get_or_create_category('PLUMBING SERVICES'::text)$$,
  'P0001',
  'Please use normal capitalization instead of all caps.',
  '10. Rejects all-caps shouting category name'
);

-- Test 11: Rejects profanity / abusive terms
SELECT throws_ok(
  $$SELECT public.get_or_create_category('Scam Services'::text)$$,
  'P0001',
  'Category name contains inappropriate language.',
  '11. Rejects category name containing profanity/scam keywords'
);

-- Test 12: Direct INSERT into public.categories by authenticated user is denied
SELECT throws_ok(
  $$INSERT INTO public.categories (name, slug, is_active) VALUES ('Direct Insert Cat', 'direct-insert-cat', true)$$,
  '42501',
  NULL,
  '12. Direct INSERT on public.categories is denied for authenticated role'
);

-- Test 13: Anon role is denied execute on get_or_create_category
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT public.get_or_create_category('Valid Category'::text)$$,
  '42501',
  NULL,
  '13. Anon role cannot call get_or_create_category'
);

-- Switch back to User 1
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000001801';

-- Test 14: 24-hour quota (max 3 new categories per 24h per user)
-- User 1 already created 1 ('Ormoc Appliance Care'). Create #2 and #3 via create_draft_gig and get_or_create_category:
SELECT lives_ok(
  $$SELECT public.create_draft_gig(
    'Grade 10 Math Tutor Needed'::text,
    'Looking for a patient tutor in Ormoc City to help with Grade 10 algebra and geometry.'::text,
    'Must be available on weekends'::text,
    50000::integer,
    80000::integer,
    'face_to_face'::text,
    'Cogon'::text,
    (now() + interval '5 days')::timestamptz,
    (now() + interval '12 days')::timestamptz,
    NULL::uuid,
    'Ormoc Geometry Coaching'::text
  )$$,
  '14. create_draft_gig with p_category_name creates category #2 and draft gig in one transaction'
);

SELECT lives_ok(
  $$SELECT public.get_or_create_category('Ormoc Fiesta Catering'::text)$$,
  '15. User 1 creates category #3 within 24 hours'
);

SELECT throws_ok(
  $$SELECT public.get_or_create_category('Ormoc Drone Surveying'::text)$$,
  'P0001',
  'You can create at most 3 new categories per 24 hours. Please pick an existing category.',
  '16. User 1 is blocked from creating a 4th new category within 24 hours'
);

-- Test 17: Total 10 custom categories per user quota
RESET ROLE;
UPDATE public.categories
SET created_at = now() - interval '5 days'
WHERE created_by = '00000000-0000-0000-0000-000000001801';

INSERT INTO public.categories (name, slug, is_active, source, created_by, created_at)
VALUES
  ('Custom Carpentry M18', 'custom-carpentry-m18', true, 'user', '00000000-0000-0000-0000-000000001801', now() - interval '5 days'),
  ('Welding & Metalwork M18', 'welding-metalwork-m18', true, 'user', '00000000-0000-0000-0000-000000001801', now() - interval '5 days'),
  ('Specialty Pastry M18', 'specialty-pastry-m18', true, 'user', '00000000-0000-0000-0000-000000001801', now() - interval '5 days'),
  ('Canine Grooming M18', 'canine-grooming-m18', true, 'user', '00000000-0000-0000-0000-000000001801', now() - interval '5 days'),
  ('Garment Ironing M18', 'garment-ironing-m18', true, 'user', '00000000-0000-0000-0000-000000001801', now() - interval '5 days'),
  ('Gutter Waterproofing M18', 'gutter-waterproofing-m18', true, 'user', '00000000-0000-0000-0000-000000001801', now() - interval '5 days'),
  ('Solar Panel Setup M18', 'solar-panel-setup-m18', true, 'user', '00000000-0000-0000-0000-000000001801', now() - interval '5 days');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000001801';

SELECT throws_ok(
  $$SELECT public.get_or_create_category('Marine Boat Charter'::text)$$,
  'P0001',
  'You have reached the maximum of 10 custom categories per account. Please pick an existing category.',
  '17. Rejects 11th custom category when user already has 10 total custom categories'
);

-- Test 18: suggest_categories_for_gig and find_similar_categories return relevant active categories
SELECT is(
  (SELECT count(*) > 0 FROM public.suggest_categories_for_gig('Need Ormoc Appliance Care in Cogon'::text, 'Appliance care and maintenance'::text)),
  true,
  '18. suggest_categories_for_gig returns matching existing categories'
);

SELECT is(
  (SELECT count(*) > 0 FROM public.find_similar_categories('Appliance Care'::text)),
  true,
  '19. find_similar_categories returns matching existing categories for Did-You-Mean prompt'
);

-- Test 20 & 21: Popularity guard on get_browse_categories()
-- Right now, user-created category 'Ormoc Geometry Coaching' only has a gig from User 1 (and it is draft).
-- Publish User 1's gig first:
RESET ROLE;
UPDATE public.gigs
SET status = 'open'
WHERE client_id = '00000000-0000-0000-0000-000000001801';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000001802';

SELECT is(
  EXISTS (
    SELECT 1 FROM public.get_browse_categories()
    WHERE lower(trim(name)) = 'ormoc geometry coaching'
  ),
  false,
  '20. get_browse_categories hides user-created category used by only 1 poster'
);

-- Now User 2 also posts & opens a gig in 'Ormoc Geometry Coaching' (2 distinct posters!)
SELECT public.create_draft_gig(
  'High School Geometry & Math Coach'::text,
  'Need a coach for 2 hours every Saturday in Ormoc City proper.'::text,
  ''::text,
  40000::integer,
  60000::integer,
  'face_to_face'::text,
  'District 1'::text,
  (now() + interval '5 days')::timestamptz,
  (now() + interval '10 days')::timestamptz,
  NULL::uuid,
  'Ormoc Geometry Coaching'::text
);

RESET ROLE;
UPDATE public.gigs
SET status = 'open'
WHERE client_id = '00000000-0000-0000-0000-000000001802';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000001802';

SELECT is(
  EXISTS (
    SELECT 1 FROM public.get_browse_categories()
    WHERE lower(trim(name)) = 'ormoc geometry coaching'
  ),
  true,
  '21. get_browse_categories includes user-created category once used by >= 2 distinct posters'
);

-- Test 22: admin_merge_categories moves gigs and deactivates source category
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000001803';

SELECT is(
  (
    SELECT (
      public.admin_merge_categories(
        (SELECT id FROM public.categories WHERE lower(trim(name)) = 'ormoc geometry coaching' LIMIT 1),
        (SELECT id FROM public.categories WHERE lower(trim(name)) = 'ormoc appliance care' LIMIT 1)
      )->>'moved_gigs_count'
    )::integer
  ),
  2,
  '22. admin_merge_categories moves all gigs from source to target category and deactivates source'
);

SELECT * FROM finish();
ROLLBACK;
