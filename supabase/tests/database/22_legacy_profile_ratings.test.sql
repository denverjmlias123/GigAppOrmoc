BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(6);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'rating_avg'
  ),
  'profiles has no combined rating_avg column'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'rating_count'
  ),
  'profiles has no combined rating_count column'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'completed_gigs'
  ),
  'profiles has no combined completed_gigs column'
);
SELECT ok(
  (SELECT count(*) = 4
   FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'profiles'
     AND column_name IN (
       'freelancer_rating_avg', 'freelancer_rating_count',
       'client_rating_avg', 'client_rating_count'
     )),
  'profiles retains all four role-specific rating columns'
);
SELECT ok(
  (SELECT prosrc !~* '(NEW|OLD)\.(rating_avg|rating_count|completed_gigs)'
   FROM pg_proc
   WHERE oid = 'public.check_profile_update_integrity()'::regprocedure),
  'profile integrity trigger no longer references combined rating columns'
);

INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000002201',
  'm22.profile-guard@ormoc.test',
  '{"display_name":"Profile Guard","dob":"1992-05-10","terms_version":"v1.0"}'::jsonb,
  now(),
  now()
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000002201';
SELECT throws_ok(
  $$UPDATE public.profiles SET active_mode = 'hire' WHERE id = '00000000-0000-0000-0000-000000002201'$$,
  'permission denied for table profiles',
  'direct client update cannot change active_mode or other database-controlled columns'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
