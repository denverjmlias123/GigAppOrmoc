const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('M28 audit trail is append-only, enriched, and admin guarded', () => {
  const migration = read('supabase/migrations/20261013070000_m28_admin_log_trail.sql');
  const tests = read('supabase/tests/database/25_admin_log_trail.test.sql');
  for (const column of ['actor_email', 'actor_role', 'status', 'ip', 'device']) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`));
  }
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_log_trail\(/);
  assert.match(migration, /IF auth\.uid\(\) IS NULL OR NOT public\.is_admin\(\) THEN RAISE EXCEPTION 'admin_required'/);
  assert.match(migration, /audit_events_append_only/);
  assert.match(migration, /ON TABLE public\.audit_events FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /on_auth_user_created_audit/);
  assert.match(migration, /on_auth_user_password_changed_audit/);
  assert.match(migration, /messages_audit_after_insert/);
  assert.match(migration, /jsonb_build_object\('conversation_id', NEW\.conversation_id\)/);
  assert.doesNotMatch(migration, /jsonb_build_object\([^\n]*NEW\.content/);
  assert.match(tests, /non-admin cannot call log trail/);
  assert.match(tests, /append-only trigger rejects owner updates/);
  assert.match(tests, /viewing the log writes one audit event/);
});

test('M28 admin screen uses database filters, pagination, details, and CSV export', () => {
  const service = read('services/admin.ts');
  const screen = read('app/admin/log-trail.tsx');
  const strings = read('constants/strings.ts');
  assert.match(service, /supabase\.rpc\('get_log_trail'/);
  assert.match(service, /exportLogTrail/);
  assert.match(screen, /adminService\.getLogTrail/);
  assert.match(screen, /adminService\.exportLogTrail/);
  assert.match(screen, /anchor\.download/);
  assert.match(screen, /Sharing\.shareAsync/);
  assert.match(screen, /new File\(Paths\.cache/);
  assert.match(screen, /logAccessDenied/);
  assert.match(strings, /logExport:/);
  assert.match(strings, /logPage:/);
});
