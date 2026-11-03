const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('profile reputation uses role-specific fields only', () => {
  const authService = fs.readFileSync(path.join(ROOT, 'services', 'auth.ts'), 'utf8');
  const profileService = fs.readFileSync(path.join(ROOT, 'services', 'profile.ts'), 'utf8');
  const profileInterface = authService.slice(
    authService.indexOf('export interface Profile'),
    authService.indexOf('const COMMON_EMAIL_DOMAIN_TYPOS')
  );
  const publicProfileQuery = profileService.slice(
    profileService.indexOf('async getPublicProfile'),
    profileService.indexOf('async getPublicProfile') + 1500
  );

  assert.doesNotMatch(profileInterface, /\b(rating_avg|rating_count|completed_gigs)\b/);
  assert.doesNotMatch(publicProfileQuery, /\b(rating_avg|rating_count|completed_gigs)\b/);
});

test('profile rating migration replaces the trigger before dropping legacy columns', () => {
  const migrationFile = fs.readdirSync(path.join(ROOT, 'supabase', 'migrations'))
    .find((file) => file.endsWith('_drop_combined_profile_ratings.sql'));
  assert.ok(migrationFile, 'new forward migration must exist');
  const migration = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', migrationFile), 'utf8');
  const triggerReplacement = migration.indexOf('CREATE OR REPLACE FUNCTION public.check_profile_update_integrity');
  const columnDrop = migration.indexOf('ALTER TABLE public.profiles');

  assert.ok(triggerReplacement >= 0 && columnDrop > triggerReplacement);
  assert.match(migration, /DROP COLUMN IF EXISTS rating_avg/);
  assert.match(migration, /DROP COLUMN IF EXISTS rating_count/);
  assert.match(migration, /DROP COLUMN IF EXISTS completed_gigs/);
});
