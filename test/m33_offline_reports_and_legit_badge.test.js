const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('M33: Offline-First Sync & Anti-Restart setup', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.scripts['dev:lan'], 'Must provide dev:lan script for Wi-Fi hotspot connection');
  assert.ok(pkg.scripts['dev:offline'], 'Must provide dev:offline script for zero signal');

  const supabaseLib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'supabase.ts'), 'utf8');
  assert.ok(supabaseLib.includes('REQUEST_TIMEOUT_MS = 6000'), 'Timeout must be capped to 6000ms to fail fast into offline cache');

  const authHook = fs.readFileSync(path.join(__dirname, '..', 'hooks', 'useAuth.tsx'), 'utf8');
  assert.ok(authHook.includes('offlineSyncService'), 'useAuth must integrate offlineSyncService');
  assert.ok(authHook.includes('isOffline'), 'useAuth must expose isOffline state');
});

test('M33: Client and Freelancer Applicant Reporting logic', () => {
  const reportsServiceSource = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'applicantReports.ts'),
    'utf8'
  );
  assert.ok(reportsServiceSource.includes('getClientReport'), 'Must export getClientReport');
  assert.ok(reportsServiceSource.includes('getFreelancerReport'), 'Must export getFreelancerReport');
  assert.ok(reportsServiceSource.includes(".in('gig_id'"), 'Must query all gig applicants in a single batch query');
  assert.ok(reportsServiceSource.includes('acceptanceRate'), 'Client report must calculate acceptance rate');
  assert.ok(reportsServiceSource.includes('successRate'), 'Freelancer report must calculate success rate');

  const activityScreen = fs.readFileSync(
    path.join(__dirname, '..', 'app', '(tabs)', 'activity.tsx'),
    'utf8'
  );
  assert.ok(activityScreen.includes('ClientApplicantReport'), 'Activity screen must integrate ClientApplicantReport');
  assert.ok(activityScreen.includes('FreelancerApplicationReport'), 'Activity screen must integrate FreelancerApplicationReport');
  assert.ok(activityScreen.includes("setActiveTab('reports')"), 'Activity screen must feature Reports tab');
});

test('M33: AI Legitimacy Screening and Human-in-the-Loop Super Admin Verification', () => {
  const aiLegitSource = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'aiLegitimacy.ts'),
    'utf8'
  );
  assert.ok(aiLegitSource.includes('evaluateAccount'), 'Must export evaluateAccount');
  assert.ok(aiLegitSource.includes('submitForReview'), 'Must export submitForReview');
  assert.ok(aiLegitSource.includes('meetsCriteria'), 'Must calculate meetsCriteria');

  const adminServiceSource = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'admin.ts'),
    'utf8'
  );
  assert.ok(adminServiceSource.includes('listVerificationQueue'), 'Must export listVerificationQueue');
  assert.ok(adminServiceSource.includes('approveLegitimacyBadge'), 'Must export approveLegitimacyBadge');
  assert.ok(adminServiceSource.includes('rejectLegitimacyBadge'), 'Must export rejectLegitimacyBadge');

  const adminScreen = fs.readFileSync(
    path.join(__dirname, '..', 'app', 'admin', 'verification.tsx'),
    'utf8'
  );
  assert.ok(adminScreen.includes('AI Screening & Legitimacy Queue'), 'Verification screen must have title');
  assert.ok(adminScreen.includes('Approve Legit Badge'), 'Verification screen must feature human approval action');

  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20261026000000_legit_verification_and_reports.sql'),
    'utf8'
  );
  assert.ok(migration.includes('is_legit_verified'), 'Migration must add is_legit_verified column');
  assert.ok(migration.includes('admin_decide_verification'), 'Migration must create admin_decide_verification RPC');
});

test('M33: AI Assistant supports seamless offline fallback and resilient matching', () => {
  const aiServiceSource = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'ai.ts'),
    'utf8'
  );
  assert.ok(aiServiceSource.includes('resolveOfflineCategories'), 'aiService must implement resolveOfflineCategories for offline matching');
  assert.ok(aiServiceSource.includes('resolveOfflineSkills'), 'aiService must implement resolveOfflineSkills for offline matching');
  assert.ok(aiServiceSource.includes('Web & Mobile Development'), 'aiService must include coding/web development semantic domain');
  assert.ok(aiServiceSource.includes('SEMANTIC_DOMAINS'), 'aiService must define offline semantic domains');
});

