const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('Milestone 19: SQL migration enforces Section 4 skills flow, dedupe, validation, 5/24h quota, and 15/profile limit', () => {
  const migrationPath = path.join(
    ROOT,
    'supabase',
    'migrations',
    '20261011000019_skills_flow_show_save_manage.sql'
  );
  assert.ok(fs.existsSync(migrationPath), 'M19 migration file must exist');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  // Zero seed skills
  assert.ok(
    !/INSERT\s+INTO\s+public\.skills\s*\(\s*name\s*\)\s*VALUES/i.test(sql),
    'M19 migration must not seed hardcoded skills'
  );

  // RLS on public.skills allows active catalog skills, own created skills, or skills linked via profile_skills
  assert.ok(
    sql.includes('is_active = true') &&
      sql.includes('created_by = auth.uid()') &&
      sql.includes('FROM public.profile_skills ps'),
    'public.skills SELECT RLS must allow active skills, own created skills, or skills linked to auth.uid() in profile_skills'
  );

  // Mode check
  assert.ok(
    sql.includes("IF COALESCE(v_profile.active_mode, '') <> 'find_work' THEN"),
    'add_profile_skills and remove_profile_skill must enforce find_work mode'
  );

  // Max 15 skills per profile
  assert.ok(
    sql.includes('Maximum limit of 15 skills per profile reached.'),
    'Must enforce max 15 skills per profile'
  );

  // Max 5 new custom skills per 24h per user
  assert.ok(
    sql.includes('You can create at most 5 new custom skills per 24 hours.'),
    'Must enforce max 5 new custom skills per 24h per user'
  );

  // Validation checks (2-40 chars, email checked before URL, phone, letters, allowed chars, profanity)
  const emailIdx = sql.indexOf("position('@' in v_trimmed) > 0");
  const urlIdx = sql.indexOf('Skill name cannot contain a website or URL.');
  assert.ok(emailIdx > 0 && urlIdx > emailIdx, 'Email check must run before URL domain regex check');
  assert.ok(sql.includes('Skill name cannot contain a phone number.'));
  assert.ok(sql.includes('Skill name must include letters.'));
  assert.ok(sql.includes('Skill name may only contain letters, numbers, spaces, and & - + . /.'));
  assert.ok(sql.includes('Skill name contains inappropriate language.'));

  // Case-insensitive dedupe
  assert.ok(
    sql.includes('WHERE lower(trim(s.name)) = lower(v_trimmed)'),
    'Must deduplicate custom skills case-insensitively against existing skills'
  );
});

test('Milestone 19: profileService.validateSkillName enforces Section 4 custom skill rules', () => {
  const profileServiceCode = fs.readFileSync(
    path.join(ROOT, 'services', 'profile.ts'),
    'utf8'
  );
  assert.ok(
    profileServiceCode.includes('validateSkillName(rawName: string)'),
    'profileService must provide validateSkillName helper'
  );
  assert.ok(
    profileServiceCode.includes(".eq('is_active', true)"),
    'getSkills() must filter catalog skills to is_active = true'
  );
  assert.ok(
    profileServiceCode.includes('Skill name may only contain letters, numbers, spaces, and & - + . /.'),
    'validateSkillName must enforce allowed characters'
  );
});

test('Milestone 19: Onboarding Step 2 (step2-skills.tsx) shows Your skills (n/15) tray, Pending review badge, and Save Skills button', () => {
  const step2Code = fs.readFileSync(
    path.join(ROOT, 'app', '(onboarding)', 'step2-skills.tsx'),
    'utf8'
  );

  assert.ok(
    step2Code.includes('strings.onboarding.yourSkillsTrayLabel') &&
      step2Code.includes('selectedSkillTray.length'),
    'Onboarding Step 2 must render "Your skills (n/15)" tray at the top'
  );
  assert.ok(
    step2Code.includes('strings.onboarding.yourSkillsEmptyHint'),
    'Onboarding Step 2 must show honest hint when 0 skills are selected'
  );
  assert.ok(
    step2Code.includes('strings.onboarding.pendingReviewBadge'),
    'Onboarding Step 2 must show "Pending review" badge on user custom skills'
  );
  assert.ok(
    step2Code.includes('handleSaveSkills') &&
      step2Code.includes('profileService.getUserSkills(profile.id)'),
    'Onboarding Step 2 must save skills via addProfileSkills and re-fetch from the database'
  );
  assert.ok(
    step2Code.includes('strings.onboarding.zeroSkillsWarning'),
    'Onboarding Step 2 must display zero-skills warning if removing leaves 0 skills'
  );
});

test('Milestone 19: Manage Skills screen (app/profile/skills.tsx) loads saved skills, shows Pending review badge, and warns when 0 skills remain', () => {
  const manageSkillsCode = fs.readFileSync(
    path.join(ROOT, 'app', 'profile', 'skills.tsx'),
    'utf8'
  );

  assert.ok(
    manageSkillsCode.includes('profileService.getUserSkills(user.id)'),
    'Manage Skills must load saved skills from the database'
  );
  assert.ok(
    manageSkillsCode.includes('strings.onboarding.yourSkillsTrayLabel'),
    'Manage Skills must display "Your skills (n/15)" tray'
  );
  assert.ok(
    manageSkillsCode.includes('strings.onboarding.pendingReviewBadge') &&
      manageSkillsCode.includes("skill.source === 'user' && skill.is_active === false"),
    'Manage Skills must show "Pending review" label on pending user skills'
  );
  assert.ok(
    manageSkillsCode.includes('strings.onboarding.zeroSkillsWarning'),
    'Manage Skills must show "You need at least 1 skill to apply for gigs" when 0 skills remain'
  );
});

test('Milestone 19: pgTAP test file has CREATE EXTENSION pgtap, explicit casts, and matching plan count', () => {
  const testSqlPath = path.join(
    ROOT,
    'supabase',
    'tests',
    'database',
    '19_skills_flow_show_save_manage.test.sql'
  );
  assert.ok(fs.existsSync(testSqlPath), '19_skills_flow_show_save_manage.test.sql must exist');
  const sql = fs.readFileSync(testSqlPath, 'utf8');

  assert.ok(
    sql.includes('CREATE EXTENSION IF NOT EXISTS pgtap;'),
    'pgTAP test must include CREATE EXTENSION IF NOT EXISTS pgtap;'
  );

  const planMatch = sql.match(/SELECT\s+plan\((\d+)\);/i);
  assert.ok(planMatch, 'pgTAP test must declare SELECT plan(N);');
  const planned = Number(planMatch[1]);

  const assertions =
    (sql.match(/SELECT\s+(is|throws_ok|lives_ok|results_eq|ok)\s*\(/gi) || []).length;
  assert.equal(
    assertions,
    planned,
    `pgTAP assertion count (${assertions}) must match SELECT plan(${planned})`
  );
});
