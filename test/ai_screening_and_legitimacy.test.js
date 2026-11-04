import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('AI Screening & Account Legitimacy Flow', async (t) => {
  const root = process.cwd();

  await t.test('1. Migration 20261104000007 defines columns and submit_profile_verification RPC', () => {
    const migrationPath = path.join(root, 'supabase', 'migrations', '20261104000007_fix_ai_screening_and_legitimacy.sql');
    assert.ok(fs.existsSync(migrationPath), 'Migration file must exist');

    const content = fs.readFileSync(migrationPath, 'utf8');
    assert.match(content, /ADD COLUMN IF NOT EXISTS ai_legitimacy_score/i, 'Must add ai_legitimacy_score column');
    assert.match(content, /ADD COLUMN IF NOT EXISTS ai_legitimacy_report/i, 'Must add ai_legitimacy_report column');
    assert.match(content, /ADD COLUMN IF NOT EXISTS verified_at/i, 'Must add verified_at column');
    assert.match(content, /CREATE OR REPLACE FUNCTION public\.submit_profile_verification/i, 'Must define submit_profile_verification RPC');
  });

  await t.test('2. services/aiLegitimacy.ts checks avatar_url, contact and client hiring details', () => {
    const servicePath = path.join(root, 'services', 'aiLegitimacy.ts');
    const content = fs.readFileSync(servicePath, 'utf8');

    assert.match(content, /profile\.avatar_path \|\| profile\.avatar_url/i, 'Must accept avatar_url as well as avatar_path');
    assert.match(content, /profile\.hiring_interests/i, 'Must give credit for client hiring interests');
    assert.match(content, /submit_profile_verification/i, 'Must call submit_profile_verification RPC');
    assert.match(content, /supabase[\s\S]*?\.from\('profiles'\)[\s\S]*?\.update/i, 'Must have direct profiles update fallback');
  });

  await t.test('3. app/(tabs)/profile.tsx handles In Review status cleanly', () => {
    const profilePath = path.join(root, 'app', '(tabs)', 'profile.tsx');
    const content = fs.readFileSync(profilePath, 'utf8');

    assert.match(content, /profile\?\.verification_status === 'ai_flagged' \|\| profile\?\.verification_status === 'pending'\s*\?\s*'In Review'/i, 'Displays In Review for ai_flagged or pending');
  });
});
