BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(32);

SELECT has_column('public', 'audit_events', 'actor_email', 'audit events retain the actor email snapshot');
SELECT has_column('public', 'audit_events', 'actor_role', 'audit events retain the actor role');
SELECT has_column('public', 'audit_events', 'status', 'audit events retain success or failure status');
SELECT has_column('public', 'audit_events', 'ip', 'audit events can retain request IP when available');
SELECT has_column('public', 'audit_events', 'device', 'audit events can retain request device when available');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.audit_events'::regclass), 'audit events keeps RLS enabled');
SELECT ok(NOT has_function_privilege('anon', 'public.get_log_trail(jsonb,integer,integer)', 'EXECUTE'), 'anon cannot call log trail');
SELECT ok(has_function_privilege('authenticated', 'public.get_log_trail(jsonb,integer,integer)', 'EXECUTE'), 'authenticated can call the guarded log RPC');
SELECT ok(NOT has_function_privilege('anon', 'public.is_admin()', 'EXECUTE'), 'anon cannot call admin check');

INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000002801', 'm28.admin@ormoc.test', '{"display_name":"M28 Admin","dob":"1988-02-05","terms_version":"v1.0"}', now(), now(), now()),
  ('00000000-0000-0000-0000-000000002802', 'm28.member@ormoc.test', '{"display_name":"M28 Member","dob":"1995-04-12","terms_version":"v1.0"}', now(), now(), now());
INSERT INTO public.platform_admins(user_id) VALUES ('00000000-0000-0000-0000-000000002801');
INSERT INTO public.audit_events(actor_id, action, entity_type, entity_id)
VALUES ('00000000-0000-0000-0000-000000002801', 'm28_test_admin_action', 'profile', '00000000-0000-0000-0000-000000002801');
CREATE TEMP TABLE m28_log_result(result jsonb);
GRANT SELECT, INSERT ON m28_log_result TO authenticated;

SELECT is((SELECT count(*)::int FROM public.audit_events WHERE actor_id = '00000000-0000-0000-0000-000000002801' AND action = 'sign_up'), 1, 'auth signup is recorded exactly once');
SELECT is((SELECT actor_email FROM public.audit_events WHERE actor_id = '00000000-0000-0000-0000-000000002801' AND action = 'sign_up'), 'm28.admin@ormoc.test', 'signup stores an email snapshot');
SELECT is((SELECT status FROM public.audit_events WHERE actor_id = '00000000-0000-0000-0000-000000002801' AND action = 'sign_up'), 'success', 'signup is marked successful');
SELECT ok((SELECT actor_role IS NULL FROM public.audit_events WHERE actor_id = '00000000-0000-0000-0000-000000002801' AND action = 'sign_up'), 'signup retains role at action time before admin assignment');
SELECT is((SELECT actor_role FROM public.audit_events WHERE actor_id = '00000000-0000-0000-0000-000000002801' AND action = 'm28_test_admin_action'), 'admin', 'admin actor role is captured');
UPDATE auth.users SET encrypted_password = 'test-hash-only' WHERE id = '00000000-0000-0000-0000-000000002802';
SELECT is((SELECT count(*)::int FROM public.audit_events WHERE actor_id = '00000000-0000-0000-0000-000000002802' AND action = 'password_changed'), 1, 'password change is recorded once without storing password material');
SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claims" = '{"role":"service_role"}';
SELECT public.login_guard_failure('m28.missing@ormoc.test', NULL);
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.audit_events WHERE action = 'login_failed' AND actor_id IS NULL), 1, 'failed login is recorded without an actor');

INSERT INTO public.categories(id, name, slug)
VALUES ('00000000-0000-0000-0000-000000002810', 'M28 Test Category', 'm28-test-category');
INSERT INTO public.gigs(id, client_id, title, description, category_id, price_min, price_max, work_type, application_deadline, deadline)
VALUES ('00000000-0000-0000-0000-000000002811', '00000000-0000-0000-0000-000000002801', 'Test gig for audit', 'Temporary database test gig for audit trail coverage.', '00000000-0000-0000-0000-000000002810', 10000, 20000, 'remote', now() + interval '1 day', now() + interval '2 days');
INSERT INTO public.applications(id, gig_id, freelancer_id, proposed_price, estimated_days, message)
VALUES ('00000000-0000-0000-0000-000000002812', '00000000-0000-0000-0000-000000002811', '00000000-0000-0000-0000-000000002802', 15000, 2, 'Temporary application fixture');
INSERT INTO public.conversations(id, application_id, client_id, freelancer_id)
VALUES ('00000000-0000-0000-0000-000000002813', '00000000-0000-0000-0000-000000002812', '00000000-0000-0000-0000-000000002801', '00000000-0000-0000-0000-000000002802');
CREATE TEMP TABLE m28_message_result(message_id uuid);
GRANT INSERT, SELECT ON m28_message_result TO authenticated;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000002802","role":"authenticated"}';
SELECT throws_ok('SELECT * FROM public.audit_events', 'permission denied for table audit_events', 'non-admin cannot read the log table directly');
SELECT throws_ok('SELECT public.get_log_trail(''{}''::jsonb, 1, 25)', 'admin_required', 'non-admin cannot call log trail');
SELECT throws_ok('INSERT INTO public.audit_events(actor_id, action, entity_type) VALUES (auth.uid(), ''forged_event'', ''profile'')', 'permission denied for table audit_events', 'client cannot insert audit events directly');
SELECT throws_ok('UPDATE public.audit_events SET metadata = ''{}''::jsonb', 'permission denied for table audit_events', 'client cannot update audit events');
SELECT throws_ok('DELETE FROM public.audit_events', 'permission denied for table audit_events', 'client cannot delete audit events');
INSERT INTO m28_message_result(message_id)
VALUES (public.send_message('00000000-0000-0000-0000-000000002813', 'private message content', '00000000-0000-0000-0000-000000002814'));
RESET ROLE;

SET LOCAL ROLE postgres;
SELECT is((SELECT count(*)::int FROM public.audit_events WHERE action = 'message_sent' AND entity_id = (SELECT message_id FROM m28_message_result)), 1, 'sending a message records one audit event');
SELECT ok((SELECT metadata::text NOT ILIKE '%private message content%' FROM public.audit_events WHERE action = 'message_sent' AND entity_id = (SELECT message_id FROM m28_message_result)), 'message audit metadata never stores message text');
SELECT throws_ok(
  $$UPDATE public.audit_events SET metadata = '{}'::jsonb WHERE action = 'sign_up' AND actor_id = '00000000-0000-0000-0000-000000002801'$$,
  'audit_events_are_append_only', 'append-only trigger rejects owner updates'
);
SELECT throws_ok(
  $$DELETE FROM public.audit_events WHERE action = 'sign_up' AND actor_id = '00000000-0000-0000-0000-000000002801'$$,
  'audit_events_are_append_only', 'append-only trigger rejects owner deletes'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000002801","role":"authenticated"}';
SELECT is(public.is_admin(), true, 'platform admin allow-list grants admin access');
INSERT INTO m28_log_result(result) VALUES (public.get_log_trail('{"action":"log_trail_viewed"}'::jsonb, 1, 10));
SELECT ok(((SELECT result->>'total_count' FROM m28_log_result)::int) >= 1, 'admin can read paginated logs');
SELECT is((SELECT count(*)::int FROM jsonb_array_elements((SELECT result->'rows' FROM m28_log_result)) AS row WHERE row->>'action' = 'log_trail_viewed'), 1, 'viewing the log writes one audit event');
INSERT INTO m28_log_result(result) VALUES (public.get_log_trail('{"action":"password_changed"}'::jsonb, 1, 10));
SELECT is((SELECT jsonb_array_length(result->'rows') FROM m28_log_result ORDER BY ctid DESC LIMIT 1), 1, 'admin filters return only matching events');
SELECT throws_ok('SELECT public.get_log_trail(''{}''::jsonb, 1, 0)', 'invalid_page_size', 'page size boundary is validated');
SELECT throws_ok('SELECT public.get_log_trail(''{}''::jsonb, 0, 10)', 'invalid_page', 'page boundary is validated');
SELECT throws_ok('SELECT public.get_log_trail(''{"status":"unknown"}''::jsonb, 1, 10)', 'invalid_status_filter', 'status filter is validated');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
