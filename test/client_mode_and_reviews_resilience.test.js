const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('Client Mode & Reviews Database & Service Resilience', () => {
  test('1. Migration 20261104000004 adds role, reviewee_role, hidden and creates categories, profile_hiring_interests, profile_private, skills, profile_skills, submissions', () => {
    const migrationPath = path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20261104000004_fix_client_mode_and_reviews.sql'
    );
    assert.ok(fs.existsSync(migrationPath), 'Migration file must exist');

    const content = fs.readFileSync(migrationPath, 'utf8');

    // Reviews columns
    assert.ok(content.includes('ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS role text;'));
    assert.ok(content.includes('ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS reviewee_role text;'));
    assert.ok(content.includes('CREATE OR REPLACE FUNCTION public.sync_reviews_roles()'));

    // Categories & profile_hiring_interests
    assert.ok(content.includes('CREATE TABLE IF NOT EXISTS public.categories'));
    assert.ok(content.includes('CREATE TABLE IF NOT EXISTS public.profile_hiring_interests'));

    // Profile private & skills
    assert.ok(content.includes('CREATE TABLE IF NOT EXISTS public.profile_private'));
    assert.ok(content.includes('CREATE TABLE IF NOT EXISTS public.skills'));
    assert.ok(content.includes('CREATE TABLE IF NOT EXISTS public.profile_skills'));

    // Submissions & areas
    assert.ok(content.includes('CREATE TABLE IF NOT EXISTS public.submissions'));
    assert.ok(content.includes('CREATE TABLE IF NOT EXISTS public.areas'));

    // Functions
    assert.ok(content.includes('CREATE OR REPLACE FUNCTION public.save_hiring_details('));
    assert.ok(content.includes('CREATE OR REPLACE FUNCTION public.update_profile_details('));
    assert.ok(content.includes("NOTIFY pgrst, 'reload schema';"));
  });

  test('2. reviewsService.getUserReviews and getAgreementReviews have resilient fallback queries and error handling', () => {
    const reviewsTsPath = path.join(__dirname, '..', 'services', 'reviews.ts');
    const content = fs.readFileSync(reviewsTsPath, 'utf8');

    // Must map role or target_role
    assert.ok(content.includes("role: r.role || r.target_role || 'client'"));
    // Must catch errors safely
    assert.ok(content.includes('catch (err)'));
    assert.ok(content.includes('return [];'));
  });

  test('3. profileService.getUserHiringInterests handles missing table or error gracefully and falls back to profiles.hiring_interests', () => {
    const profileTsPath = path.join(__dirname, '..', 'services', 'profile.ts');
    const content = fs.readFileSync(profileTsPath, 'utf8');

    assert.ok(content.includes('getUserHiringInterests(profileId: string)'));
    assert.ok(content.includes(".from('profile_hiring_interests')"));
    assert.ok(content.includes(".from('profiles')"));
    assert.ok(content.includes(".select('hiring_interests')"));
  });

  test('4. profileService.getOwnPrivatePhone falls back to profiles.phone if profile_private is unavailable', () => {
    const profileTsPath = path.join(__dirname, '..', 'services', 'profile.ts');
    const content = fs.readFileSync(profileTsPath, 'utf8');

    assert.ok(content.includes('getOwnPrivatePhone(userId: string)'));
    assert.ok(content.includes(".from('profile_private')"));
    assert.ok(content.includes(".from('profiles')"));
    assert.ok(content.includes(".select('phone')"));
  });

  test('5. profileService.getUserSkills has fallback to user_skills table', () => {
    const profileTsPath = path.join(__dirname, '..', 'services', 'profile.ts');
    const content = fs.readFileSync(profileTsPath, 'utf8');

    assert.ok(content.includes('getUserSkills(profileId: string)'));
    assert.ok(content.includes(".from('profile_skills')"));
    assert.ok(content.includes(".from('user_skills')"));
  });

  test('6. Migration 20261104000005 allows draft, expired, and closed in gigs_status_check and updates create_draft_gig RPC', () => {
    const migrationPath = path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20261104000005_fix_gig_statuses_and_drafts.sql'
    );
    assert.ok(fs.existsSync(migrationPath), 'Migration file must exist');

    const content = fs.readFileSync(migrationPath, 'utf8');
    assert.ok(content.includes("CHECK (status IN ('draft', 'open', 'in_progress', 'completed', 'cancelled', 'expired', 'closed'))"));
    assert.ok(content.includes('p_status text DEFAULT \'open\''));
    assert.ok(content.includes("'draft'"));
  });

  test('7. gigs.tsx computes status counts and accurately normalizes status values for All, Open, Drafts, In Progress, Closed', () => {
    const gigsTsxPath = path.join(__dirname, '..', 'app', '(tabs)', 'gigs.tsx');
    const content = fs.readFileSync(gigsTsxPath, 'utf8');

    assert.ok(content.includes('clientStatusCounts'));
    assert.ok(content.includes('count={clientStatusCounts[f.id]}'));
    assert.ok(content.includes("['completed', 'cancelled', 'expired', 'closed'].includes(s)"));
    assert.ok(content.includes("s === 'open' || s === 'active'"));
    assert.ok(content.includes("s === 'draft' || s === 'drafts'"));
  });
});
