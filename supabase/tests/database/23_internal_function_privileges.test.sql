BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(8);

SELECT ok(NOT has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE'),
  'anon cannot call the internal new-user trigger function');
SELECT ok(NOT has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE'),
  'authenticated cannot call the internal new-user trigger function');

SELECT ok(NOT has_function_privilege('anon', 'public.notify(uuid,text,text,text,jsonb)', 'EXECUTE'),
  'anon cannot call the legacy notification helper');
SELECT ok(NOT has_function_privilege('authenticated', 'public.notify(uuid,text,text,text,jsonb)', 'EXECUTE'),
  'authenticated cannot call the legacy notification helper');
SELECT ok(NOT has_function_privilege('anon', 'public.notify(uuid,text,text,text,text,uuid,jsonb)', 'EXECUTE'),
  'anon cannot call the internal notification helper');
SELECT ok(NOT has_function_privilege('authenticated', 'public.notify(uuid,text,text,text,text,uuid,jsonb)', 'EXECUTE'),
  'authenticated cannot call the internal notification helper');

SELECT ok(to_regprocedure('public.rls_auto_enable()') IS NULL
    OR NOT has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE'),
  'anon cannot call the internal RLS event-trigger function');
SELECT ok(to_regprocedure('public.rls_auto_enable()') IS NULL
    OR NOT has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE'),
  'authenticated cannot call the internal RLS event-trigger function');

SELECT * FROM finish();
ROLLBACK;
