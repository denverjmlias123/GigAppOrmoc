const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

function readFile(relPath) {
  return fs.readFileSync(path.join(rootDir, relPath), 'utf8');
}

test('Milestone 18: SQL migration defines pg_trgm, get_or_create_category, suggest_categories_for_gig, find_similar_categories, get_browse_categories, create_draft_gig, and admin_merge_categories', () => {
  const sql = readFile('supabase/migrations/20261011000018_post_gig_category_unlocked.sql');

  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS pg_trgm/i);
  assert.match(sql, /ADD COLUMN source text NOT NULL DEFAULT 'admin' CHECK \(source IN \('admin', 'user'\)\)/i);
  assert.match(sql, /ADD COLUMN created_by uuid REFERENCES public\.profiles\(id\)/i);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_lower_name/i);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_categories_trgm_name/i);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON public\.categories FROM anon, authenticated, PUBLIC/i);

  // Functions
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_or_create_category/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.suggest_categories_for_gig/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.find_similar_categories/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_browse_categories/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.create_draft_gig/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.admin_merge_categories/i);

  // Dedupe & Quotas in get_or_create_category
  assert.match(sql, /similarity\(/i);
  assert.match(sql, /v_recent_24h >= 3/);
  assert.match(sql, /v_total_user_cats >= 10/);

  // Popularity guard in get_browse_categories (>= 2 distinct posters for user categories)
  assert.match(sql, /count\(DISTINCT g\.client_id\)/i);
  assert.match(sql, />= 2/);
});

test('Milestone 18: Edge Function ai-assist supports suggest_gig_category restricted to active DB categories + optional 1 proposed_new_category', () => {
  const edgeFn = readFile('supabase/functions/ai-assist/index.ts');

  assert.match(edgeFn, /'suggest_gig_category'/);
  assert.match(edgeFn, /from\('categories'\)/);
  assert.match(edgeFn, /\.eq\('is_active',\s*true\)/);
  assert.match(edgeFn, /activeCategoriesMap\.get\(catId\)/);
  assert.match(edgeFn, /proposed_new_category/);
});

test('Milestone 18: services/gigs.ts implements create_draft_gig RPC, suggestCategoriesWithAiFallback, findSimilarCategories, and getBrowseCategories', () => {
  const gigsSvc = readFile('services/gigs.ts');

  assert.match(gigsSvc, /rpc\('create_draft_gig'/);
  assert.match(gigsSvc, /p_category_id:\s*params\.category_id\s*\|\|\s*null/);
  assert.match(gigsSvc, /p_category_name:\s*params\.category_name\s*\|\|\s*null/);
  assert.match(gigsSvc, /rpc\('get_or_create_category'/);
  assert.match(gigsSvc, /rpc\('suggest_categories_for_gig'/);
  assert.match(gigsSvc, /rpc\('find_similar_categories'/);
  assert.match(gigsSvc, /rpc\('get_browse_categories'/);
  assert.match(gigsSvc, /suggestCategoriesWithAiFallback/);
  assert.match(gigsSvc, /usedFallback:\s*true/);
});

test('Milestone 18: Post Gig UI removes No Categories Available lock and implements Suggest-First, Create-Last picker', () => {
  const postScreen = readFile('app/gigs/post.tsx');
  const gigsScreen = readFile('app/(tabs)/gigs.tsx');

  // Must NOT lock the screen with noCategoriesTitle or disabled={loading || categories.length === 0}
  assert.ok(
    !postScreen.includes('noCategoriesTitle'),
    'app/gigs/post.tsx must not render the locked noCategoriesTitle block'
  );
  assert.ok(
    !postScreen.includes('categories.length === 0'),
    'app/gigs/post.tsx must not disable publishing when categories.length === 0'
  );

  // Must include suggested categories, Did-you-mean similar categories, and explicit confirmation to create a new category
  assert.match(postScreen, /suggestCategoriesForGig/);
  assert.match(postScreen, /suggestCategoriesWithAiFallback/);
  assert.match(postScreen, /findSimilarCategories/);
  assert.match(postScreen, /didYouMeanLabel/);
  assert.match(postScreen, /confirmCreateNewCategoryPrefix/);

  // Browse screen uses getBrowseCategories() popularity guard
  assert.match(gigsScreen, /getBrowseCategories/);
});

test('Milestone 18: pgTAP test file has CREATE EXTENSION IF NOT EXISTS pgtap and matching plan count', () => {
  const pgTapSql = readFile('supabase/tests/database/18_post_gig_category_unlocked.test.sql');

  assert.match(pgTapSql, /CREATE EXTENSION IF NOT EXISTS pgtap;/);
  const planMatch = pgTapSql.match(/SELECT plan\((\d+)\);/);
  assert.ok(planMatch, 'Must include SELECT plan(N);');
  const planned = Number(planMatch[1]);

  const assertions = pgTapSql.match(/SELECT\s+(is|ok|throws_ok|lives_ok)\s*\(/g) || [];
  assert.equal(
    assertions.length,
    planned,
    `pgTAP assertion count (${assertions.length}) must match SELECT plan(${planned})`
  );
});
