const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

describe('Onboarding Role Choice (Freelancer vs Hire)', () => {
  it('1. step1-mode.tsx always uses authService.chooseInitialMode during onboarding', () => {
    const step1Source = fs.readFileSync(path.join(ROOT, 'app', '(onboarding)', 'step1-mode.tsx'), 'utf8');

    assert.ok(
      step1Source.includes('isOnboarding'),
      'step1-mode.tsx must define isOnboarding check'
    );
    assert.ok(
      step1Source.includes('if (isOnboarding || !currentActive)'),
      'step1-mode.tsx must prioritize chooseInitialMode when in onboarding'
    );
    assert.ok(
      step1Source.includes('await authService.chooseInitialMode(selectedMode)'),
      'step1-mode.tsx must call chooseInitialMode with selectedMode'
    );
  });

  it('2. Active Role info box in step1-mode only displays after onboarding is completed', () => {
    const step1Source = fs.readFileSync(path.join(ROOT, 'app', '(onboarding)', 'step1-mode.tsx'), 'utf8');

    assert.ok(
      step1Source.includes('profile?.onboarding_completed && normalizeMode(profile?.active_mode)'),
      'step1-mode must guard Active Role box so new users are not shown premature mode defaults'
    );
  });

  it('3. authService.chooseInitialMode handles find_work and hire with direct fallback', () => {
    const authSource = fs.readFileSync(path.join(ROOT, 'services', 'auth.ts'), 'utf8');

    assert.ok(
      authSource.includes('chooseInitialMode(targetMode: \'find_work\' | \'hire\')'),
      'authService must accept find_work and hire'
    );
    assert.ok(
      authSource.includes('choose_initial_mode'),
      'authService must invoke choose_initial_mode RPC'
    );
    assert.ok(
      authSource.includes('.from(\'profiles\')') && authSource.includes('.update({'),
      'authService must have resilient fallback to profiles update'
    );
  });

  it('4. applicationsService.switchMode handles missing columns (42703) gracefully', () => {
    const appsSource = fs.readFileSync(path.join(ROOT, 'services', 'applications.ts'), 'utf8');

    assert.ok(
      appsSource.includes('42703'),
      'switchMode must handle 42703 column missing errors without crashing'
    );
    assert.ok(
      appsSource.includes('last_mode_switch_at'),
      'switchMode fallback updates last_mode_switch_at'
    );
  });

  it('5. step2-skills branches cleanly between Freelancer Skills and Client Hiring Details', () => {
    const step2Source = fs.readFileSync(path.join(ROOT, 'app', '(onboarding)', 'step2-skills.tsx'), 'utf8');

    assert.ok(
      step2Source.includes("const isHire = profile?.active_mode === 'hire';"),
      'step2-skills detects hire role correctly'
    );
    assert.ok(
      step2Source.includes('<ClientHiringDetailsCard'),
      'step2-skills provides ClientHiringDetailsCard for hire role'
    );
    assert.ok(
      step2Source.includes('<FreelancerSkillSections'),
      'step2-skills provides FreelancerSkillSections for find_work role'
    );
  });

  it('6. step3-profile adapts headline and placeholders for client vs freelancer', () => {
    const step3Source = fs.readFileSync(path.join(ROOT, 'app', '(onboarding)', 'step3-profile.tsx'), 'utf8');

    assert.ok(
      step3Source.includes("const isHire = profile?.active_mode === 'hire';"),
      'step3-profile detects hire role correctly'
    );
    assert.ok(
      step3Source.includes("isHire ? 'Client Profile' : 'Freelancer Profile'"),
      'step3-profile displays role pill according to selected mode'
    );
  });

  it('7. ProfileCompletenessCard and profileService are resilient to undefined missing_items and client mode fields', () => {
    const completenessComp = fs.readFileSync(path.join(ROOT, 'components', 'ui', 'ProfileCompleteness.tsx'), 'utf8');
    const profileServiceSrc = fs.readFileSync(path.join(ROOT, 'services', 'profile.ts'), 'utf8');

    assert.ok(
      completenessComp.includes('Array.isArray(completeness.missing_items)'),
      'ProfileCompletenessCard must guard against undefined missing_items'
    );
    assert.ok(
      profileServiceSrc.includes('getProfileCompleteness'),
      'profileService provides getProfileCompleteness'
    );
    assert.ok(
      profileServiceSrc.includes('client_type') && profileServiceSrc.includes('isHire'),
      'profileService computes client completeness with client_type check'
    );
  });
});
