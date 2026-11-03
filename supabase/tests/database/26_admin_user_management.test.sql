BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(51);

SELECT has_column('public','platform_admins','role','admin tier is stored in the database allow-list');
SELECT has_column('public','profiles','must_change_password','forced password change is stored in the profile');
SELECT has_function('public','is_admin',ARRAY[]::text[],'is_admin database guard exists');
SELECT has_function('public','is_super_admin',ARRAY[]::text[],'is_super_admin database guard exists');
SELECT ok(NOT has_function_privilege('anon','public.is_admin()','EXECUTE'),'anonymous clients cannot call is_admin');
SELECT ok(NOT has_function_privilege('anon','public.is_super_admin()','EXECUTE'),'anonymous clients cannot call is_super_admin');
SELECT ok(NOT has_function_privilege('anon','public.admin_dashboard_metrics()','EXECUTE'),'anonymous clients cannot call admin metrics');
SELECT ok(has_function_privilege('authenticated','public.admin_dashboard_metrics()','EXECUTE'),'authenticated RPC is gated internally and callable');

INSERT INTO auth.users (id,email,raw_user_meta_data,email_confirmed_at,created_at,updated_at) VALUES
 ('00000000-0000-0000-0000-000000002901','m29.super1@ormoc.test','{"display_name":"M29 Super One","dob":"1988-02-05","terms_version":"v1.0"}',now(),now(),now()),
 ('00000000-0000-0000-0000-000000002902','m29.super2@ormoc.test','{"display_name":"M29 Super Two","dob":"1988-02-05","terms_version":"v1.0"}',now(),now(),now()),
 ('00000000-0000-0000-0000-000000002903','m29.member@ormoc.test','{"display_name":"M29 Member","dob":"1995-04-12","terms_version":"v1.0"}',now(),now(),now());
INSERT INTO public.platform_admins(user_id,role) VALUES
 ('00000000-0000-0000-0000-000000002901','super_admin'),
 ('00000000-0000-0000-0000-000000002902','super_admin');
INSERT INTO public.categories(id,name,slug) VALUES ('00000000-0000-0000-0000-000000002910','M29 Temporary Category','m29-temporary-category');
INSERT INTO public.gigs(id,client_id,title,description,category_id,price_min,price_max,work_type,application_deadline,deadline)
VALUES ('00000000-0000-0000-0000-000000002911','00000000-0000-0000-0000-000000002903','Temporary agreement gig','This temporary database fixture supports admin deletion behavior testing.','00000000-0000-0000-0000-000000002910',10000,20000,'remote',now()+interval '1 day',now()+interval '2 days');
INSERT INTO public.agreements(id,gig_id,client_id,freelancer_id,agreed_price,deadline,status)
VALUES ('00000000-0000-0000-0000-000000002912','00000000-0000-0000-0000-000000002911','00000000-0000-0000-0000-000000002903','00000000-0000-0000-0000-000000002901',15000,now()+interval '2 days','active');
INSERT INTO public.user_sessions(user_id,request_id,device_label,platform)
VALUES ('00000000-0000-0000-0000-000000002903','00000000-0000-0000-0000-000000002913','M29 test session','web');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims"='{"sub":"00000000-0000-0000-0000-000000002903","role":"authenticated"}';
SELECT is(public.is_admin(),false,'ordinary account is not an admin');
SELECT throws_ok('SELECT public.admin_dashboard_metrics()','admin_required','non-admin cannot read dashboard metrics');
SELECT throws_ok('SELECT public.admin_list_users(NULL,NULL,NULL,1,25)','admin_required','non-admin cannot list users');
SELECT throws_ok('SELECT public.admin_get_user_detail(''00000000-0000-0000-0000-000000002903'')','admin_required','non-admin cannot read user detail');
SELECT throws_ok('SELECT public.admin_update_user(''00000000-0000-0000-0000-000000002903'',''New Name'','''',''active'')','admin_required','non-admin cannot update users');
SELECT throws_ok('SELECT public.admin_set_admin_role(''00000000-0000-0000-0000-000000002903'',''admin'')','super_admin_required','non-admin cannot change roles');
SELECT throws_ok('SELECT public.admin_force_password_change(''00000000-0000-0000-0000-000000002903'')','admin_required','non-admin cannot force password reset');
SELECT throws_ok('SELECT public.admin_finalize_created_user(''00000000-0000-0000-0000-000000002903'')','admin_required','non-admin cannot finalize user creation');
SELECT throws_ok('SELECT public.admin_soft_delete_user(''00000000-0000-0000-0000-000000002903''::uuid,''m29.member@ormoc.test''::text,NULL::uuid)','admin_required','non-admin cannot soft delete accounts');
SELECT throws_ok('SELECT public.admin_end_user_sessions(''00000000-0000-0000-0000-000000002903'')','admin_required','non-admin cannot end sessions');
SELECT throws_ok('SELECT public.admin_unlock_login(''m29.member@ormoc.test'')','admin_required','non-admin cannot unlock accounts');
SELECT throws_ok('UPDATE public.profiles SET must_change_password=true WHERE id=auth.uid()','permission denied for table profiles','direct client write to forced-password flag is denied');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims"='{"sub":"00000000-0000-0000-0000-000000002901","role":"authenticated"}';
SELECT is(public.is_admin(),true,'platform admin allow-list enables guarded admin actions');
SELECT is(public.is_super_admin(),true,'super admin tier is database-derived');
SELECT is(public.admin_finalize_created_user('00000000-0000-0000-0000-000000002903')->>'must_change_password','true','admin creation finalization forces password update');
RESET ROLE;
SELECT is((SELECT must_change_password FROM public.profiles WHERE id='00000000-0000-0000-0000-000000002903'),true,'created account is flagged for password change');

CREATE TEMP TABLE m29_results(value jsonb);
GRANT SELECT,INSERT ON m29_results TO authenticated;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims"='{"sub":"00000000-0000-0000-0000-000000002901","role":"authenticated"}';
INSERT INTO m29_results VALUES (public.admin_dashboard_metrics());
SELECT ok((SELECT value ?& ARRAY['total_users','new_users_7_days','active_gigs','agreements_in_progress','completed_agreements','open_reports','locked_accounts','today_log_events','latest_activity'] FROM m29_results),'dashboard returns all live database metrics');
INSERT INTO m29_results VALUES (public.admin_list_users('m29.member@ormoc.test',NULL,NULL,1,25));
SELECT is((SELECT value->>'total_count' FROM m29_results ORDER BY ctid DESC LIMIT 1),'1','user search is database-backed');
INSERT INTO m29_results VALUES (public.admin_get_user_detail('00000000-0000-0000-0000-000000002903'));
SELECT is((SELECT value->>'email' FROM m29_results ORDER BY ctid DESC LIMIT 1),'m29.member@ormoc.test','detail includes the current account email');
SELECT is(public.admin_set_admin_role('00000000-0000-0000-0000-000000002903','admin')->>'role','admin','super admin can grant admin role');
RESET ROLE;
SELECT is((SELECT role FROM public.platform_admins WHERE user_id='00000000-0000-0000-0000-000000002903'),'admin','role grant is persisted');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims"='{"sub":"00000000-0000-0000-0000-000000002903","role":"authenticated"}';
SELECT throws_ok('SELECT public.admin_set_admin_role(''00000000-0000-0000-0000-000000002902'',''admin'')','super_admin_required','admin cannot grant or revoke admin roles');
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims"='{"sub":"00000000-0000-0000-0000-000000002901","role":"authenticated"}';
SELECT is(public.admin_update_user('00000000-0000-0000-0000-000000002903','M29 Updated Member','Ormoc City','suspended')->>'status','suspended','admin can suspend another user');
SELECT throws_ok('SELECT public.admin_update_user(''00000000-0000-0000-0000-000000002901'',''M29 Super One'','''',''suspended'')','cannot_suspend_self','admin cannot suspend self');
SELECT is(public.admin_force_password_change('00000000-0000-0000-0000-000000002903')->>'must_change_password','true','admin can force a password change');
RESET ROLE;
UPDATE auth.users SET encrypted_password='m29-temporary-test-hash' WHERE id='00000000-0000-0000-0000-000000002903';
SELECT is((SELECT must_change_password FROM public.profiles WHERE id='00000000-0000-0000-0000-000000002903'),false,'flag clears only after Auth records an actual password change');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims"='{"sub":"00000000-0000-0000-0000-000000002901","role":"authenticated"}';
SELECT is(public.admin_set_admin_role('00000000-0000-0000-0000-000000002902','user')->>'role','user','super admin can revoke a redundant super admin');
SELECT throws_ok('SELECT public.admin_set_admin_role(''00000000-0000-0000-0000-000000002901'',''admin'')','last_super_admin','last super admin cannot be demoted');
SELECT is(public.admin_set_admin_role('00000000-0000-0000-0000-000000002903','super_admin')->>'role','super_admin','super admin can promote admin');
SELECT is(public.admin_set_admin_role('00000000-0000-0000-0000-000000002903','user')->>'role','user','super admin can remove admin tier before deletion');
SELECT throws_ok('SELECT public.admin_soft_delete_user(''00000000-0000-0000-0000-000000002901''::uuid,''m29.super1@ormoc.test''::text,NULL::uuid)','cannot_delete_self','admin cannot delete self');
SELECT throws_ok('SELECT public.admin_soft_delete_user(''00000000-0000-0000-0000-000000002903''::uuid,''m29.member@ormoc.test''::text,NULL::uuid)','active_agreements_block_delete','active agreement blocks account deletion');
RESET ROLE;
SELECT is((SELECT status FROM public.profiles WHERE id='00000000-0000-0000-0000-000000002903'),'suspended','blocked deletion leaves target state unchanged');
UPDATE public.agreements SET status='completed' WHERE id='00000000-0000-0000-0000-000000002912';
INSERT INTO public.payments(id,agreement_id,payer_id,payee_id,amount,payment_method,status)
VALUES ('00000000-0000-0000-0000-000000002914','00000000-0000-0000-0000-000000002912','00000000-0000-0000-0000-000000002903','00000000-0000-0000-0000-000000002901',15000,'gcash','reported_sent');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims"='{"sub":"00000000-0000-0000-0000-000000002901","role":"authenticated"}';
SELECT throws_ok('SELECT public.admin_soft_delete_user(''00000000-0000-0000-0000-000000002903''::uuid,''m29.member@ormoc.test''::text,NULL::uuid)','pending_payments_block_delete','unconfirmed payment blocks account deletion');
RESET ROLE;
UPDATE public.payments SET status='confirmed_received' WHERE id='00000000-0000-0000-0000-000000002914';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims"='{"sub":"00000000-0000-0000-0000-000000002901","role":"authenticated"}';
SELECT throws_ok('SELECT public.admin_soft_delete_user(''00000000-0000-0000-0000-000000002903''::uuid,''wrong@ormoc.test''::text,NULL::uuid)','confirmation_email_mismatch','soft deletion requires exact email confirmation');
SELECT is(public.admin_soft_delete_user('00000000-0000-0000-0000-000000002903'::uuid,'m29.member@ormoc.test'::text,NULL::uuid)->>'deleted','true','confirmation email allows safe soft deletion when blockers are cleared');
SELECT is(public.admin_soft_delete_user('00000000-0000-0000-0000-000000002903'::uuid,'m29.member@ormoc.test'::text,NULL::uuid)->>'already_done','true','repeated deletion is idempotent after the original email is anonymized');
RESET ROLE;
SELECT is((SELECT status FROM public.profiles WHERE id='00000000-0000-0000-0000-000000002903'),'deleted','soft delete marks the account deleted');
SELECT ok((SELECT email LIKE 'deleted+00000000-0000-0000-0000-000000002903@deleted.invalid' FROM auth.users WHERE id='00000000-0000-0000-0000-000000002903'),'auth email is anonymized to block old-email login');
SELECT is((SELECT count(*)::int FROM public.agreements WHERE id='00000000-0000-0000-0000-000000002912'),1,'soft deletion retains agreement records');
SELECT is((SELECT count(*)::int FROM public.audit_events WHERE action='user_deleted' AND entity_id='00000000-0000-0000-0000-000000002903'),1,'soft deletion writes one retained audit record');
SELECT ok((SELECT ended_at IS NOT NULL AND end_reason='revoked' FROM public.user_sessions WHERE user_id='00000000-0000-0000-0000-000000002903'),'soft deletion revokes active tracked sessions');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims"='{"sub":"00000000-0000-0000-0000-000000002903","role":"authenticated"}';
SELECT throws_ok('SELECT public.start_session(''Blocked device'',''web'',gen_random_uuid())','account_unavailable','deleted account cannot start a new tracked session');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
