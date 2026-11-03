const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (name) => fs.readFileSync(path.join(process.cwd(), name), 'utf8');

test('M29: database tier, guarded RPCs, soft deletion and login flag migration are additive', () => {
  const sql = read('supabase/migrations/20261013080000_m29_admin_user_management.sql');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'admin'/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.is_super_admin\(\)/);
  for (const rpc of ['admin_dashboard_metrics', 'admin_list_users', 'admin_get_user_detail', 'admin_update_user', 'admin_set_admin_role', 'admin_force_password_change', 'admin_finalize_created_user', 'admin_soft_delete_user', 'admin_end_user_sessions', 'admin_unlock_login']) {
    assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${rpc}\\(`));
    assert.match(sql, new RegExp(`IF NOT public\\.(?:is_admin|is_super_admin)\\(\\) THEN RAISE EXCEPTION`));
  }
  assert.match(sql, /active_agreements_block_delete/);
  assert.match(sql, /pending_payments_block_delete/);
  assert.match(sql, /last_super_admin/);
  assert.match(sql, /former_email/);
  assert.match(sql, /DELETE FROM public\.platform_admins WHERE user_id = p_user_id/);
  assert.match(sql, /REVOKE UPDATE \(must_change_password\)/);
});

test('M29: Edge Function verifies the caller and keeps the service key server-side', () => {
  const edge = read('supabase/functions/admin-users/index.ts');
  assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(edge, /service\.auth\.getUser\(jwt\)/);
  assert.match(edge, /caller\.rpc\('is_admin'\)/);
  assert.match(edge, /validTemporaryPassword/);
  assert.match(edge, /service\.auth\.admin\.createUser/);
  assert.match(edge, /resetPasswordForEmail/);
});

test('M29: admin route is guarded by the database and profile exposes the route only to admins', () => {
  assert.match(read('app/admin/_layout.tsx'), /adminService\.isAdmin\(\)/);
  assert.match(read('app/(tabs)/profile.tsx'), /adminService\.isAdmin\(\)/);
  assert.match(read('app/(tabs)/profile.tsx'), /strings\.admin\.dashboard/);
});

test('M29: dashboard and user screens read via admin service and write through guarded RPCs', () => {
  const service = read('services/admin.ts');
  assert.match(service, /admin_dashboard_metrics/);
  assert.match(service, /admin_list_users/);
  assert.match(service, /admin_get_user_detail/);
  assert.match(service, /admin_update_user/);
  assert.match(service, /admin_set_admin_role/);
  assert.match(read('app/admin/dashboard.tsx'), /dashboardMetrics/);
  assert.match(read('app/admin/users.tsx'), /listUsers/);
  assert.match(read('app/admin/users/[id].tsx'), /confirmEmail/);
});

test('M29: forced-password account is routed to password update and clears only after Auth changes its password hash', () => {
  assert.match(read('app/_layout.tsx'), /profile\.must_change_password/);
  assert.match(read('supabase/migrations/20261013080000_m29_admin_user_management.sql'), /auth_users_clear_forced_password/);
  assert.match(read('app/settings/password.tsx'), /profile\?\.must_change_password/);
});

test('M29: admin user copy is centralized and no system confirmation dialog was added', () => {
  assert.match(read('constants/strings.ts'), /admin: \{/);
  for (const file of ['app/admin/_layout.tsx', 'app/admin/dashboard.tsx', 'app/admin/users.tsx', 'app/admin/users/create.tsx', 'app/admin/users/[id].tsx']) {
    assert.doesNotMatch(read(file), /\b(?:alert|confirm|prompt)\s*\(/);
  }
});
