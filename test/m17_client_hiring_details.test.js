const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

describe('Milestone 17 — Client Hiring Details (Not Skills)', () => {
  test('M17 SQL migration enforces skills mode guard, max 8 hiring interests, and 2-60 char business_name', () => {
    const sqlPath = path.join(
      ROOT,
      'supabase/migrations/20261011000017_client_hiring_details.sql'
    );
    assert.ok(fs.existsSync(sqlPath), '20261011000017_client_hiring_details.sql must exist');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // 1. Client type allows individual, business, organization, other
    assert.match(sql, /'individual',\s*'business',\s*'organization',\s*'other'/);

    // 2. Direct writes on profile_skills are revoked and add_profile_skills rejects non-find_work callers
    assert.match(
      sql,
      /REVOKE INSERT, UPDATE, DELETE ON public\.profile_skills FROM anon, authenticated, PUBLIC/
    );
    assert.match(sql, /Skills can only be added in Find Work \(Freelancer\) mode\./);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.remove_profile_skill/);

    // 3. save_hiring_details RPC requires hire mode, enforces 2-60 char business_name, <=300 about_hiring, and max 8 interests
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.save_hiring_details/);
    assert.match(sql, /Hiring details can only be saved in Hire Someone \(Client\) mode\./);
    assert.match(sql, /Business or organization name must be between 2 and 60 characters\./);
    assert.match(sql, /You can select at most 8 hiring interests\./);

    // 4. Zero seed data (no static literal INSERT INTO public.categories ... VALUES ('...'))
    assert.doesNotMatch(
      sql,
      /INSERT INTO public\.categories\s*\([^)]*\)\s*VALUES\s*\(\s*'/i
    );
  });

  test('Edge function ai-assist and services/ai.ts support suggest_categories task', () => {
    const edgeFn = fs.readFileSync(
      path.join(ROOT, 'supabase/functions/ai-assist/index.ts'),
      'utf8'
    );
    assert.match(edgeFn, /'suggest_categories'/);
    assert.match(edgeFn, /task === 'suggest_categories'/);

    const aiSvc = fs.readFileSync(path.join(ROOT, 'services/ai.ts'), 'utf8');
    assert.match(aiSvc, /suggestCategories\s*\(/);
    assert.match(aiSvc, /task:\s*'suggest_categories'/);
  });

  test('Onboarding step 2 branches by active_mode: Find Work shows Skills, Hire shows Hiring Details', () => {
    const step2 = fs.readFileSync(
      path.join(ROOT, 'app/(onboarding)/step2-skills.tsx'),
      'utf8'
    );
    assert.match(step2, /const isHire = profile\?\.active_mode === 'hire'/);
    assert.match(step2, /strings\.onboarding\.hiringTitle/);
    assert.match(step2, /strings\.onboarding\.skillsTitle/);
    assert.match(step2, /profileService\.saveHiringDetails/);
    assert.match(step2, /aiService\.suggestCategories/);
    assert.match(step2, /MAX_HIRING_INTERESTS = 8/);
  });

  test('Client screens never require or mention skills and Public Profile displays client hiring details', () => {
    const homeScreen = fs.readFileSync(path.join(ROOT, 'app/(tabs)/index.tsx'), 'utf8');
    assert.match(
      homeScreen,
      /Add a profile photo and hiring details to complete your client profile\./
    );

    const skillsScreen = fs.readFileSync(path.join(ROOT, 'app/profile/skills.tsx'), 'utf8');
    assert.match(skillsScreen, /const isHire = profile\?\.active_mode === 'hire'/);
    assert.match(skillsScreen, /Freelancer Mode Only/);
    assert.doesNotMatch(skillsScreen, /\bverified\b/i);

    const editScreen = fs.readFileSync(path.join(ROOT, 'app/profile/edit.tsx'), 'utf8');
    assert.match(editScreen, /Hiring Interests \(\{totalSelectedInterests\}\/\{MAX_HIRING_INTERESTS\}\)/);
    assert.match(editScreen, /profileService\.saveHiringDetails/);

    const pubProfile = fs.readFileSync(path.join(ROOT, 'app/profile/[id].tsx'), 'utf8');
    assert.match(pubProfile, /Hiring Interests/);
    assert.match(pubProfile, /gigs posted/);
    assert.match(pubProfile, /Client type:/);
  });
});
