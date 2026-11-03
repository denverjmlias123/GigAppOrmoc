const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('M36: Admin Dashboard refreshes on screen focus', () => {
  const file = fs.readFileSync(path.join(__dirname, '../app/admin/dashboard.tsx'), 'utf8');
  assert.match(file, /useFocusEffect/);
  assert.match(file, /void load\(\)/);
});

test('M36: User directory decouples input and search execution without forbidden timers', () => {
  const file = fs.readFileSync(path.join(__dirname, '../app/admin/users.tsx'), 'utf8');
  assert.match(file, /const \[searchInput, setSearchInput\] = useState/);
  assert.match(file, /const \[appliedSearch, setAppliedSearch\] = useState/);
  assert.match(file, /returnKeyType="search"/);
  assert.doesNotMatch(file, /setTimeout/);
});

test('M36: Create User validates email format and enforces Super Admin authorization', () => {
  const file = fs.readFileSync(path.join(__dirname, '../app/admin/users/create.tsx'), 'utf8');
  assert.match(file, /\.test\(trimmedEmail\)/);
  assert.match(file, /Only Super Admin can provision administrative accounts/);
});

test('M36: User detail blocks self-demotion for Super Admin accounts', () => {
  const file = fs.readFileSync(path.join(__dirname, '../app/admin/users/[id].tsx'), 'utf8');
  assert.match(file, /String\(id\) === currentUser\?\.id/);
  assert.match(file, /Self-demotion blocked/);
});

test('M36: Legitimacy verification queue strictly enforces Super Admin role gate', () => {
  const file = fs.readFileSync(path.join(__dirname, '../app/admin/verification.tsx'), 'utf8');
  assert.match(file, /const isSuper = await adminService\.isSuperAdmin\(\)/);
  assert.match(file, /isSuperAdminUser === false/);
  assert.match(file, /Super Admin Access Required/);
  assert.match(file, /if \(!isSuperAdminUser\) return/);
});

test('M36: Log trail clears expanded card selection across page transitions', () => {
  const file = fs.readFileSync(path.join(__dirname, '../app/admin/log-trail.tsx'), 'utf8');
  assert.match(file, /setExpandedId\(null\)/);
});

test('M36: Admin layout re-verifies credentials on foreground return to prevent unattended token abuse', () => {
  const file = fs.readFileSync(path.join(__dirname, '../app/admin/_layout.tsx'), 'utf8');
  assert.match(file, /AppState\.addEventListener\('change'/);
  assert.match(file, /if \(nextState === 'active'\) void check\(\)/);
  assert.match(file, /adminService\.isSuperAdmin\(\)/);
});

test('M36: Single-tier Super Admin role model and account suspension confirmation', () => {
  const createSrc = fs.readFileSync(path.join(__dirname, '../app/admin/users/create.tsx'), 'utf8');
  assert.match(createSrc, /useState<'user' \| 'super_admin'>\('user'\)/);

  const detailSrc = fs.readFileSync(path.join(__dirname, '../app/admin/users/[id].tsx'), 'utf8');
  assert.match(detailSrc, /\(\['user', 'super_admin'\] as const\)/);
  assert.match(detailSrc, /Confirm Account Suspension/);
});

test('M36: Login screen provides error handling and appeal submission for suspended accounts', () => {
  const loginSrc = fs.readFileSync(path.join(__dirname, '../app/(auth)/login.tsx'), 'utf8');
  assert.match(loginSrc, /Appeal Suspension \/ Report Issue/);
  assert.match(loginSrc, /handleSendAppeal/);
  assert.match(loginSrc, /authService\.submitAccountAppeal/);

  const authSrc = fs.readFileSync(path.join(__dirname, '../services/auth.ts'), 'utf8');
  assert.match(authSrc, /submitAccountAppeal/);

  const guardSrc = fs.readFileSync(path.join(__dirname, '../supabase/functions/login-guard/index.ts'), 'utf8');
  assert.match(guardSrc, /action === 'appeal'/);
  assert.match(guardSrc, /account_appeal/);
});
