BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(23);

INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at) VALUES
 ('00000000-0000-0000-0000-000000003801', 'm31.client@ormoc.test', '{"display_name":"M31 Client","dob":"1990-04-10","terms_version":"v1.0"}', now(), now(), now()),
 ('00000000-0000-0000-0000-000000003802', 'm31.freelancer@ormoc.test', '{"display_name":"M31 Freelancer","dob":"1992-07-19","terms_version":"v1.0"}', now(), now(), now());
UPDATE public.profiles SET active_mode='hire' WHERE id='00000000-0000-0000-0000-000000003801';
UPDATE public.profiles SET active_mode='find_work', avatar_path='m31-test-avatar' WHERE id='00000000-0000-0000-0000-000000003802';
INSERT INTO public.categories(id,name,slug) VALUES ('00000000-0000-0000-0000-000000003803','M31 Temporary Category','m31-temporary-category');
INSERT INTO public.gigs(id,client_id,title,description,category_id,price_min,price_max,work_type,application_deadline,deadline,status) VALUES
 ('00000000-0000-0000-0000-000000003804','00000000-0000-0000-0000-000000003801','M31 Empty Gig','Temporary test row','00000000-0000-0000-0000-000000003803',10000,10000,'remote',now()+interval '1 day',now()+interval '2 days','open'),
 ('00000000-0000-0000-0000-000000003805','00000000-0000-0000-0000-000000003801','M31 Applied Gig','Temporary test row','00000000-0000-0000-0000-000000003803',10000,10000,'remote',now()+interval '1 day',now()+interval '2 days','open'),
 ('00000000-0000-0000-0000-000000003806','00000000-0000-0000-0000-000000003801','M31 Hired Gig','Temporary test row','00000000-0000-0000-0000-000000003803',10000,10000,'remote',now()+interval '1 day',now()+interval '2 days','in_progress'),
 ('00000000-0000-0000-0000-000000003807','00000000-0000-0000-0000-000000003801','M31 Completed Gig','Temporary test row','00000000-0000-0000-0000-000000003803',10000,10000,'remote',now()+interval '1 day',now()+interval '2 days','completed');
INSERT INTO public.applications(id,gig_id,freelancer_id,proposed_price,estimated_days,message,status) VALUES
 ('00000000-0000-0000-0000-000000003808','00000000-0000-0000-0000-000000003805','00000000-0000-0000-0000-000000003802',10000,1,'Please consider my proposal','applied');
INSERT INTO public.conversations(id,application_id,client_id,freelancer_id) VALUES
 ('00000000-0000-0000-0000-000000003809','00000000-0000-0000-0000-000000003808','00000000-0000-0000-0000-000000003801','00000000-0000-0000-0000-000000003802');
INSERT INTO public.agreements(id,gig_id,client_id,freelancer_id,agreed_price,deadline,status) VALUES
 ('00000000-0000-0000-0000-000000003810','00000000-0000-0000-0000-000000003806','00000000-0000-0000-0000-000000003801','00000000-0000-0000-0000-000000003802',10000,now()+interval '2 days','active');

SELECT has_function('public','delete_gig',ARRAY['uuid','text','uuid']);
SELECT ok(has_function_privilege('authenticated','public.delete_gig(uuid,text,uuid)','EXECUTE'),'authenticated can call guarded deletion');
SELECT ok(NOT has_function_privilege('anon','public.delete_gig(uuid,text,uuid)','EXECUTE'),'anon cannot call deletion');
SELECT ok(NOT has_table_privilege('authenticated','public.gigs','DELETE'),'direct gig deletion remains revoked');
SELECT ok(NOT has_table_privilege('authenticated','public.applications','UPDATE'),'direct application updates remain revoked');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub"='00000000-0000-0000-0000-000000003802';
SELECT throws_matching($q$SELECT public.delete_gig('00000000-0000-0000-0000-000000003804',NULL,'00000000-0000-0000-0000-000000003811')$q$,'Only the gig owner','wrong user is denied');
SET LOCAL "request.jwt.claim.sub"='00000000-0000-0000-0000-000000003801';
SELECT is(public.delete_gig('00000000-0000-0000-0000-000000003804',NULL,'00000000-0000-0000-0000-000000003812')->>'applicants_notified','0','gig without applicants deletes with no notifications');
SELECT throws_matching($q$SELECT public.cancel_gig('00000000-0000-0000-0000-000000003804','Stale cancellation after deletion','00000000-0000-0000-0000-000000003818')$q$,'gig_unavailable','stale cancellation cannot reopen/change a deleted gig');
SELECT is(public.delete_gig('00000000-0000-0000-0000-000000003805','Closed by client','00000000-0000-0000-0000-000000003813')->>'applicants_notified','1','pending applicant is notified');
SELECT is(public.delete_gig('00000000-0000-0000-0000-000000003805',NULL,'00000000-0000-0000-0000-000000003814')->>'already_done','true','second deletion is idempotent');
SELECT throws_matching($q$SELECT public.delete_gig('00000000-0000-0000-0000-000000003806',NULL,'00000000-0000-0000-0000-000000003815')$q$,'gig_has_agreement','hired gig deletion is blocked');
SELECT throws_matching($q$SELECT public.delete_gig('00000000-0000-0000-0000-000000003807',NULL,'00000000-0000-0000-0000-000000003816')$q$,'gig_completed','completed gig deletion is blocked');
RESET ROLE;

SELECT is((SELECT status FROM public.applications WHERE id='00000000-0000-0000-0000-000000003808'),'declined','pending proposal is closed');
SELECT is((SELECT status_reason FROM public.applications WHERE id='00000000-0000-0000-0000-000000003808'),'gig_deleted','proposal preserves deletion reason');
SELECT is((SELECT gig_title_snapshot FROM public.applications WHERE id='00000000-0000-0000-0000-000000003808'),'M31 Applied Gig','applicant history preserves gig title');
SELECT is((SELECT count(*)::integer FROM public.notifications WHERE user_id='00000000-0000-0000-0000-000000003802' AND type='gig_deleted' AND entity_id='00000000-0000-0000-0000-000000003808'),1,'one deletion notification is written');
SELECT is((SELECT closed_reason FROM public.conversations WHERE id='00000000-0000-0000-0000-000000003809'),'gig_deleted','application conversation is closed');
SELECT is((SELECT count(*)::integer FROM public.messages WHERE conversation_id='00000000-0000-0000-0000-000000003809' AND is_system),1,'one system message is added');
SELECT is((SELECT count(*)::integer FROM public.audit_events WHERE entity_id='00000000-0000-0000-0000-000000003805' AND action='gig_deleted'),1,'deletion is audited once');
SELECT ok((SELECT deleted_at IS NOT NULL AND deleted_by='00000000-0000-0000-0000-000000003801' FROM public.gigs WHERE id='00000000-0000-0000-0000-000000003805'),'gig is soft-deleted and retained');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub"='00000000-0000-0000-0000-000000003802';
SELECT throws_matching($q$SELECT public.submit_application('00000000-0000-0000-0000-000000003805',10000,1,'Late application','00000000-0000-0000-0000-000000003817')$q$,'gig_unavailable','application after deletion is rejected');
SELECT is((SELECT count(*)::integer FROM public.gigs WHERE id='00000000-0000-0000-0000-000000003805'),0,'deleted gig is absent from freelancer browse under RLS');
SELECT is((SELECT gig_title_snapshot FROM public.applications WHERE id='00000000-0000-0000-0000-000000003808'),'M31 Applied Gig','applicant can still read the proposal snapshot');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
