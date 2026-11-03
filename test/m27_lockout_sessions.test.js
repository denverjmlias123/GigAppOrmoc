const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('M27 lockout and sessions are wired through Supabase server controls', () => {
  const migration = read('supabase/migrations/20261013060000_m27_lockout_and_sessions.sql');
  const edge = read('supabase/functions/login-guard/index.ts');
  const auth = read('services/auth.ts');
  const sessions = read('services/sessions.ts');
  const sqlTests = read('supabase/tests/database/24_login_lockout_sessions.test.sql');

  for (const table of ['login_attempts', 'login_ip_attempts', 'user_sessions']) {
    assert.match(migration, new RegExp(`CREATE TABLE public\\.${table}`));
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
  }
  for (const rpc of ['start_session', 'heartbeat_session', 'end_session', 'list_my_sessions', 'end_other_sessions']) {
    assert.match(migration, new RegExp(`FUNCTION public\\.${rpc}\\(`));
  }
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /ON CONFLICT \(user_id, request_id\) DO NOTHING/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.login_guard_success\(text, uuid, text\) FROM PUBLIC, anon, authenticated/);
  assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(edge, /login_guard_check/);
  assert.match(edge, /login_guard_failure/);
  assert.match(edge, /service\.auth\.getUser\(jwt\)/);
  assert.doesNotMatch(edge, /account_exists|email_exists|ACCOUNT_NOT_FOUND/);
  assert.doesNotMatch(edge, /dev_recovery_otp/);
  assert.doesNotMatch(auth, /requestDevRecoveryOtp/);
  assert.match(auth, /callLoginGuard\('check'/);
  assert.match(auth, /callLoginGuard\('failure'/);
  assert.match(auth, /sessionService\.startSession\(\)/);
  assert.match(sessions, /heartbeat_session/);
  assert.match(sessions, /session_not_found[\s\S]*?return false/);
  assert.match(sessions, /AsyncStorage\.multiRemove\(\[SESSION_STORAGE_KEY, LAST_ACTIVITY_KEY\]\)/);
  assert.match(sqlTests, /ten failed requests from an IP trigger an IP lock/);
  assert.match(sqlTests, /different user cannot end another user session/);
});

test('M27 session screen exposes live database sessions and end-other action', () => {
  const screen = read('app/settings/sessions.tsx');
  const profile = read('app/(tabs)/profile.tsx');
  assert.match(screen, /sessionService\.listMySessions\(\)/);
  assert.match(screen, /sessionService\.endOtherSessions\(\)/);
  assert.match(screen, /confirmDialog\(/);
  assert.match(screen, /ErrorState/);
  assert.match(profile, /router\.push\('\/settings\/sessions'\)/);
});
