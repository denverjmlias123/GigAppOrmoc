import test, { describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

describe('Create Account & Complete Onboarding Flow', () => {
  const root = process.cwd();

  test('1. Migration 20261104000008 defines sync_profile_compat_fields, add_profile_skills and complete_onboarding', () => {
    const migrationPath = path.join(
      root,
      'supabase',
      'migrations',
      '20261104000008_fix_onboarding_and_create_account_flow.sql'
    );
    assert.ok(fs.existsSync(migrationPath), 'Migration 8 must exist');
    const content = fs.readFileSync(migrationPath, 'utf8');

    assert.ok(
      content.includes('FUNCTION public.sync_profile_compat_fields()'),
      'Must define sync_profile_compat_fields trigger function'
    );
    assert.ok(
      content.includes('FUNCTION public.add_profile_skills('),
      'Must define add_profile_skills function'
    );
    assert.ok(
      content.includes('p_skill_ids uuid[]'),
      'add_profile_skills must accept p_skill_ids uuid[]'
    );
    assert.ok(
      content.includes('p_custom_names text[]'),
      'add_profile_skills must accept p_custom_names text[]'
    );
    assert.ok(
      content.includes('FUNCTION public.complete_onboarding('),
      'Must define complete_onboarding function'
    );
    assert.ok(
      content.includes('p_mode text'),
      'complete_onboarding must accept p_mode text parameter'
    );
    assert.ok(
      content.includes('onboarding_complete = true') && content.includes('onboarding_completed = true'),
      'complete_onboarding must set both onboarding_complete and onboarding_completed'
    );
  });

  test('2. services/auth.ts normalizeProfile uses logical OR for boolean flags and field fallbacks', () => {
    const authPath = path.join(root, 'services', 'auth.ts');
    const content = fs.readFileSync(authPath, 'utf8');

    assert.ok(
      content.includes('onboarding_complete: Boolean(row.onboarding_complete || row.onboarding_completed)'),
      'onboarding_complete must evaluate row.onboarding_complete || row.onboarding_completed'
    );
    assert.ok(
      content.includes('onboarding_completed: Boolean(row.onboarding_completed || row.onboarding_complete)'),
      'onboarding_completed must evaluate row.onboarding_completed || row.onboarding_complete'
    );
    assert.ok(
      content.includes('avatar_path: row.avatar_path || row.avatar_url || null'),
      'avatar_path must normalize to row.avatar_path or row.avatar_url'
    );
    assert.ok(
      content.includes('area: row.area || row.area_barangay || null'),
      'area must normalize to row.area or row.area_barangay'
    );
  });

  test('3. services/auth.ts updateProfile updates both onboarding and avatar fields without deleting them', () => {
    const authPath = path.join(root, 'services', 'auth.ts');
    const content = fs.readFileSync(authPath, 'utf8');

    assert.ok(
      content.includes('payload.onboarding_complete = val;') &&
      content.includes('payload.onboarding_completed = val;'),
      'updateProfile must maintain both onboarding_complete and onboarding_completed in payload'
    );
    assert.ok(
      content.includes('payload.avatar_path = val;') &&
      content.includes('payload.avatar_url = val;'),
      'updateProfile must maintain both avatar_path and avatar_url in payload'
    );
  });

  test('4. services/auth.ts completeOnboarding forwards mode parameter and supports fallback', () => {
    const authPath = path.join(root, 'services', 'auth.ts');
    const content = fs.readFileSync(authPath, 'utf8');

    assert.ok(
      content.includes('completeOnboarding(mode?: string)'),
      'completeOnboarding must accept optional mode string'
    );
    assert.ok(
      content.includes('p_mode: mode || null'),
      'completeOnboarding must pass p_mode to rpc'
    );
  });

  test('5. app/(auth)/signup-step2.tsx calls createSignupOtp with normalizedEmail', () => {
    const step2Path = path.join(root, 'app', '(auth)', 'signup-step2.tsx');
    const content = fs.readFileSync(step2Path, 'utf8');

    assert.ok(
      content.includes('authService.createSignupOtp(res.user.id, normalizedEmail)'),
      'signup-step2.tsx must pass both user ID and normalizedEmail to createSignupOtp'
    );
  });

  test('6. app/(onboarding)/step1-mode.tsx provides seamless fallback when switching initial mode', () => {
    const step1Path = path.join(root, 'app', '(onboarding)', 'step1-mode.tsx');
    const content = fs.readFileSync(step1Path, 'utf8');

    assert.ok(
      content.includes('await authService.chooseInitialMode(selectedMode)'),
      'step1-mode.tsx must use chooseInitialMode'
    );
    assert.ok(
      content.includes('await authService.updateProfile(user.id, { active_mode: selectedMode } as any)'),
      'step1-mode.tsx must have direct fallback to updateProfile'
    );
  });

  test('7. app/(onboarding)/step3-profile.tsx completes onboarding with active mode', () => {
    const step3Path = path.join(root, 'app', '(onboarding)', 'step3-profile.tsx');
    const content = fs.readFileSync(step3Path, 'utf8');

    assert.ok(
      content.includes('await authService.completeOnboarding('),
      'step3-profile.tsx must invoke completeOnboarding'
    );
  });
});
