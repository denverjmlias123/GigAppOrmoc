const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('M34: Main Tabs - Accepted proposal navigation routes to matching agreement', () => {
  const home = read('app/(tabs)/index.tsx');
  assert.match(home, /const matchingAgr = myAgreements\.find/);
  assert.match(home, /router\.push\(\{\s*pathname:\s*\'\/agreements\/\[id\]\'/);
  assert.match(home, /a\.status === \'applied\' \|\| a\.status === \'countered\'/);
});

test('M34: Main Tabs - Activity passes client human name to chat and avoids gig title', () => {
  const activity = read('app/(tabs)/activity.tsx');
  assert.match(activity, /handleOpenApplicationChat\(app\.id,\s*app\.gig\?\.client\?\.display_name\s*\|\|\s*\'Client\'\)/);
});

test('M34: Main Tabs - Gigs screen clear filters does not launch duplicate fetch', () => {
  const gigs = read('app/(tabs)/gigs.tsx');
  assert.doesNotMatch(gigs, /const handleClearFilters = useCallback\(\(\) =>\s*\{[\s\S]*?void \(async/);
});

test('M34: Main Tabs - Profile tab refreshes on screen focus', () => {
  const profile = read('app/(tabs)/profile.tsx');
  assert.match(profile, /useFocusEffect/);
  assert.match(profile, /void loadCompleteness\(\)/);
  assert.match(profile, /void refreshProfile\(\)/);
});

test('M34: Main Tabs - Supabase Realtime socket reconnects on mobile OS deep sleep return', () => {
  const supabaseLib = read('lib/supabase.ts');
  const layout = read('app/_layout.tsx');
  assert.match(supabaseLib, /export function ensureRealtimeConnected\(\)/);
  assert.match(supabaseLib, /realtime\.connect\(\)/);
  assert.match(layout, /ensureRealtimeConnected\(\)/);
  assert.match(layout, /if \(state === 'active'\)\s*\{\s*ensureRealtimeConnected\(\)/);
});

test('M34: Main Tabs - Degraded network fast-path serves cache without blocking 6s timeout', () => {
  const sync = read('services/offlineSync.ts');
  assert.match(sync, /if \(isKnownOffline\)/);
  assert.match(sync, /return \{ data: cached, isFromCache: true \}/);
});
