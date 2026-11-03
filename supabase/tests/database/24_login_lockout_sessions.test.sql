BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(48);

SELECT has_table('public', 'login_attempts', 'private email lockout table exists');
SELECT has_table('public', 'login_ip_attempts', 'private IP lockout table exists');
SELECT has_table('public', 'user_sessions', 'tracked sessions table exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.login_attempts'::regclass), 'email lockout RLS is enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.login_ip_attempts'::regclass), 'IP lockout RLS is enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_sessions'::regclass), 'session RLS is enabled');
SELECT ok(NOT has_function_privilege('anon', 'public.login_guard_check(text,text)', 'EXECUTE'), 'anon cannot call login guard');
SELECT ok(NOT has_function_privilege('authenticated', 'public.login_guard_check(text,text)', 'EXECUTE'), 'authenticated cannot call internal login guard');
SELECT ok(has_function_privilege('service_role', 'public.login_guard_check(text,text)', 'EXECUTE'), 'service role can call login guard');

INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000002701', 'm27.user1@ormoc.test', '{"display_name":"M27 User One","dob":"1995-04-12","terms_version":"v1.0"}', now(), now(), now()),
  ('00000000-0000-0000-0000-000000002702', 'm27.user2@ormoc.test', '{"display_name":"M27 User Two","dob":"1996-07-16","terms_version":"v1.0"}', now(), now(), now()),
  ('00000000-0000-0000-0000-000000002703', 'm27.admin@ormoc.test', '{"display_name":"M27 Admin","dob":"1988-02-05","terms_version":"v1.0"}', now(), now(), now());
INSERT INTO public.platform_admins(user_id) VALUES ('00000000-0000-0000-0000-000000002703');
CREATE TEMP TABLE m27_session_ids(user_one uuid, user_two uuid, initial_session uuid);
GRANT SELECT, INSERT, UPDATE ON m27_session_ids TO authenticated, service_role;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000002701","role":"authenticated"}';
SELECT throws_ok('SELECT * FROM public.login_attempts', 'permission denied for table login_attempts', 'clients cannot read email lockout rows');
SELECT throws_ok('INSERT INTO public.login_attempts(email_normalized) VALUES (''direct@ormoc.test'')', 'permission denied for table login_attempts', 'clients cannot insert email lockout rows');
SELECT throws_ok('SELECT * FROM public.login_ip_attempts', 'permission denied for table login_ip_attempts', 'clients cannot read IP lockout rows');
SELECT throws_ok('SELECT * FROM public.user_sessions', 'permission denied for table user_sessions', 'clients cannot directly read session rows');
SELECT throws_ok('INSERT INTO public.user_sessions(user_id, request_id) VALUES (auth.uid(), gen_random_uuid())', 'permission denied for table user_sessions', 'clients cannot directly create session rows');
SELECT throws_ok('UPDATE public.user_sessions SET device_label = ''forged''', 'permission denied for table user_sessions', 'clients cannot directly edit session rows');
SELECT throws_ok('SELECT public.login_guard_check(''m27.user1@ormoc.test'')', 'permission denied for function login_guard_check', 'authenticated clients cannot invoke internal guard');
RESET ROLE;

SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claims" = '{"role":"service_role"}';
SELECT is(public.login_guard_check('  M27.USER1@ORMOC.TEST  ')->>'locked', 'false', 'lockout lookup normalizes email and begins unlocked');
SELECT is((public.login_guard_failure('m27.user1@ormoc.test', '192.0.2.27')->>'attempts_left')::int, 2, 'first failure leaves two attempts');
SELECT is((public.login_guard_failure('m27.user1@ormoc.test', '192.0.2.27')->>'attempts_left')::int, 1, 'second failure leaves one attempt');
SELECT is(public.login_guard_failure('m27.user1@ormoc.test', '192.0.2.27')->>'locked', 'true', 'third failure locks the account');
SELECT is((SELECT lock_level FROM public.login_attempts WHERE email_normalized = 'm27.user1@ormoc.test'), 1, 'first lock uses level one');
SELECT ok((public.login_guard_check('m27.user1@ormoc.test', '192.0.2.27')->>'seconds_left')::int BETWEEN 1 AND 60, 'first lock lasts at most one minute');
UPDATE public.login_attempts SET locked_until = now() - interval '1 second' WHERE email_normalized = 'm27.user1@ormoc.test';
SELECT is(public.login_guard_check('m27.user1@ormoc.test')->>'locked', 'false', 'expired first lock allows another round');
SELECT public.login_guard_failure('m27.user1@ormoc.test', NULL);
SELECT public.login_guard_failure('m27.user1@ormoc.test', NULL);
SELECT public.login_guard_failure('m27.user1@ormoc.test', NULL);
SELECT is((SELECT lock_level FROM public.login_attempts WHERE email_normalized = 'm27.user1@ormoc.test'), 2, 'second lock escalates to level two');
SELECT ok((public.login_guard_check('m27.user1@ormoc.test')->>'seconds_left')::int BETWEEN 1 AND 300, 'second lock lasts at most five minutes');
UPDATE public.login_attempts SET last_failed_at = now() - interval '25 hours', locked_until = NULL WHERE email_normalized = 'm27.user1@ormoc.test';
SELECT is(public.login_guard_check('m27.user1@ormoc.test')->>'locked', 'false', '24 hour idle window resets lockout');
SELECT is((SELECT lock_level FROM public.login_attempts WHERE email_normalized = 'm27.user1@ormoc.test'), 0, '24 hour reset clears escalation level');
SELECT public.login_guard_failure('m27.user1@ormoc.test', NULL);
SELECT public.login_guard_success('m27.user1@ormoc.test', '00000000-0000-0000-0000-000000002701', NULL);
SELECT is((public.login_guard_check('m27.user1@ormoc.test')->>'attempts_left')::int, 3, 'successful login resets the failure counter');
SELECT throws_ok(
  $$SELECT public.login_guard_success('m27.user1@ormoc.test', '00000000-0000-0000-0000-000000002702', NULL)$$,
  'authenticated_user_email_mismatch', 'guard cannot reset a different user account'
);
SELECT public.login_guard_failure('unknown.m27@ormoc.test', NULL);
SELECT public.login_guard_failure('unknown.m27@ormoc.test', NULL);
SELECT public.login_guard_failure('unknown.m27@ormoc.test', NULL);
SELECT is(public.login_guard_check('unknown.m27@ormoc.test')->>'locked', 'true', 'unknown email follows the same three-failure lockout');

SELECT public.login_guard_failure('m27.ip1@ormoc.test', '198.51.100.27');
SELECT public.login_guard_failure('m27.ip2@ormoc.test', '198.51.100.27');
SELECT public.login_guard_failure('m27.ip3@ormoc.test', '198.51.100.27');
SELECT public.login_guard_failure('m27.ip4@ormoc.test', '198.51.100.27');
SELECT public.login_guard_failure('m27.ip5@ormoc.test', '198.51.100.27');
SELECT public.login_guard_failure('m27.ip6@ormoc.test', '198.51.100.27');
SELECT public.login_guard_failure('m27.ip7@ormoc.test', '198.51.100.27');
SELECT public.login_guard_failure('m27.ip8@ormoc.test', '198.51.100.27');
SELECT public.login_guard_failure('m27.ip9@ormoc.test', '198.51.100.27');
SELECT public.login_guard_failure('m27.ip10@ormoc.test', '198.51.100.27');
SELECT ok((SELECT locked_until > now() FROM public.login_ip_attempts WHERE ip_normalized = '198.51.100.27'), 'ten failed requests from an IP trigger an IP lock');
SELECT is(public.login_guard_check('a-different-email@ormoc.test', '198.51.100.27')->>'locked', 'true', 'IP lock applies across email addresses');

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000002701","role":"authenticated"}';
INSERT INTO m27_session_ids(user_one, initial_session) VALUES (
  (public.start_session('Web browser', 'web', '00000000-0000-0000-0000-000000002710'::uuid)->>'session_id')::uuid,
  (public.start_session('Web browser', 'web', '00000000-0000-0000-0000-000000002710'::uuid)->>'session_id')::uuid
);
SELECT ok((SELECT user_one IS NOT NULL FROM m27_session_ids), 'valid user can start a tracked session');
SELECT is(public.start_session('Ignored duplicate', 'web', '00000000-0000-0000-0000-000000002710'::uuid)->>'already_done', 'true', 'replaying a session request ID is idempotent');
SELECT throws_ok('SELECT public.start_session(repeat(''x'', 81), ''web'', gen_random_uuid())', 'invalid_device_label', 'device label boundary is enforced');
SELECT throws_ok('SELECT public.start_session(''Test device'', ''desktop'', gen_random_uuid())', 'invalid_platform', 'unsupported platform is rejected');

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000002702","role":"authenticated"}';
SELECT throws_ok(
  'SELECT public.end_session((SELECT user_one FROM m27_session_ids))',
  'session_not_found', 'a different user cannot end another user session'
);
SELECT throws_ok(
  'SELECT public.heartbeat_session((SELECT user_one FROM m27_session_ids))',
  'session_not_found', 'a different user cannot heartbeat another user session'
);
UPDATE m27_session_ids SET user_two = (public.start_session('Android device', 'android', '00000000-0000-0000-0000-000000002720'::uuid)->>'session_id')::uuid;
SELECT ok((SELECT user_two IS NOT NULL FROM m27_session_ids), 'second account can create its own session');
SELECT is((SELECT count(*)::int FROM public.list_my_sessions()), 1, 'session listing returns only the caller own sessions');

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000002701","role":"authenticated"}';
SELECT is(public.end_session((SELECT user_one FROM m27_session_ids))->>'already_done', 'false', 'owner can end own active session');
SELECT is(public.end_session((SELECT user_one FROM m27_session_ids))->>'already_done', 'true', 'ending a session twice is idempotent');
SELECT is(public.heartbeat_session((SELECT user_one FROM m27_session_ids))->>'active', 'false', 'ended session cannot heartbeat');
SELECT throws_ok(
  'SELECT public.end_other_sessions((SELECT user_two FROM m27_session_ids))',
  'session_not_found', 'end-other rejects a current session owned by another user'
);
UPDATE m27_session_ids
  SET user_one = (public.start_session('Current tablet', 'android', '00000000-0000-0000-0000-000000002730'::uuid)->>'session_id')::uuid,
      user_two = (public.start_session('Other tablet', 'android', '00000000-0000-0000-0000-000000002731'::uuid)->>'session_id')::uuid;
SELECT is((public.end_other_sessions((SELECT user_one FROM m27_session_ids))->>'ended_count')::int, 1, 'owner can revoke other active sessions');
SELECT is((public.end_other_sessions((SELECT user_one FROM m27_session_ids))->>'already_done'), 'true', 'revoking other sessions is idempotent');
RESET ROLE;

SET LOCAL ROLE postgres;
SELECT is((SELECT count(*)::int FROM public.audit_events WHERE action = 'login_locked' AND metadata->>'scope' = 'ip'), 1, 'IP lockout transition writes one failure audit event');
SELECT is((SELECT count(*)::int FROM public.audit_events WHERE actor_id = '00000000-0000-0000-0000-000000002701' AND action = 'session_started' AND entity_id = (SELECT initial_session FROM m27_session_ids)), 1, 'duplicate session start writes one audit row');

SELECT * FROM finish();
ROLLBACK;
