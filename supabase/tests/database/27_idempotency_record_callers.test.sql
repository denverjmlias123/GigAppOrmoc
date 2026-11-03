-- Regression coverage for RPCs that read the idempotency helper's OUT record.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(11);

INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-000000003101', 'm27.client@ormoc.test', '{"display_name":"M27 Client","dob":"1990-04-10","terms_version":"v1.0"}', now(), now(), now()),
  ('00000000-0000-0000-0000-000000003102', 'm27.freelancer@ormoc.test', '{"display_name":"M27 Freelancer","dob":"1992-07-19","terms_version":"v1.0"}', now(), now(), now());

UPDATE public.profiles SET active_mode = 'hire'
WHERE id = '00000000-0000-0000-0000-000000003101';
UPDATE public.profiles SET active_mode = 'find_work'
WHERE id = '00000000-0000-0000-0000-000000003102';

INSERT INTO public.categories (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000003103', 'M27 Temporary Category', 'm27-temporary-category');
INSERT INTO public.gigs (
  id, client_id, title, description, category_id, price_min, price_max,
  work_type, application_deadline, deadline
) VALUES (
  '00000000-0000-0000-0000-000000003104',
  '00000000-0000-0000-0000-000000003101',
  'M27 Temporary Gig', 'Temporary fixture for a rollback-scoped database test.',
  '00000000-0000-0000-0000-000000003103', 125000, 125000,
  'remote', now() + interval '1 day', now() + interval '2 days'
);
INSERT INTO public.agreements (
  id, gig_id, client_id, freelancer_id, agreed_price, deadline, status
) VALUES (
  '00000000-0000-0000-0000-000000003105',
  '00000000-0000-0000-0000-000000003104',
  '00000000-0000-0000-0000-000000003101',
  '00000000-0000-0000-0000-000000003102',
  125000, now() + interval '2 days', 'active'
);

SELECT has_function('public', 'define_milestones', ARRAY['uuid', 'jsonb', 'uuid']);
SELECT ok(has_function_privilege('authenticated', 'public.define_milestones(uuid,jsonb,uuid)', 'EXECUTE'), 'authenticated can call the guarded milestone RPC');
SELECT ok(NOT has_function_privilege('anon', 'public.define_milestones(uuid,jsonb,uuid)', 'EXECUTE'), 'anon cannot call the milestone RPC');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000003102';
SELECT throws_ok(
  $q$SELECT public.define_milestones('00000000-0000-0000-0000-000000003105', '[{"title":"Milestone 1","amount":125000}]'::jsonb, '00000000-0000-0000-0000-000000003106')$q$,
  'P0001', 'Only the client can define milestones.', 'wrong participant is rejected'
);

SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000003101';
SELECT throws_matching(
  $q$SELECT public.define_milestones('00000000-0000-0000-0000-000000003105', '[{"title":"Milestone 1","amount":124999}]'::jsonb, '00000000-0000-0000-0000-000000003107')$q$,
  'Milestone sum.*must exactly equal agreed price',
  'amount boundary mismatch is rejected before writing'
);

SELECT lives_ok(
  $q$SELECT public.define_milestones('00000000-0000-0000-0000-000000003105', '[{"title":"Milestone 1","description":"Deliver the agreed work","amount":125000}]'::jsonb, '00000000-0000-0000-0000-000000003108')$q$,
  'valid request ID and milestone payload are accepted'
);
SELECT is((SELECT count(*)::integer FROM public.milestones WHERE agreement_id = '00000000-0000-0000-0000-000000003105'), 1, 'valid request creates one milestone');

SELECT lives_ok(
  $q$SELECT public.define_milestones('00000000-0000-0000-0000-000000003105', '[{"title":"Changed duplicate payload","amount":125000}]'::jsonb, '00000000-0000-0000-0000-000000003108')$q$,
  'duplicate request ID returns successfully without repeating the write'
);
SELECT is((SELECT title FROM public.milestones WHERE agreement_id = '00000000-0000-0000-0000-000000003105' AND seq = 1), 'Milestone 1', 'duplicate request leaves the original milestone unchanged');

RESET ROLE;
UPDATE public.agreements SET status = 'completed'
WHERE id = '00000000-0000-0000-0000-000000003105';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000003101';
SELECT throws_ok(
  $q$SELECT public.define_milestones('00000000-0000-0000-0000-000000003105', '[{"title":"Milestone 1","amount":125000}]'::jsonb, '00000000-0000-0000-0000-000000003109')$q$,
  'P0001', 'Milestones can only be set for active agreements.', 'wrong agreement state is rejected'
);
SELECT throws_ok(
  $q$INSERT INTO public.milestones (agreement_id, seq, title, amount) VALUES ('00000000-0000-0000-0000-000000003105', 2, 'Direct write', 1)$q$,
  'permission denied for table milestones', 'clients cannot bypass the RPC with a direct insert'
);

SELECT * FROM finish();
ROLLBACK;
