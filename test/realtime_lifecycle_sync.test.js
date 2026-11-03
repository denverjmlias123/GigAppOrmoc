const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('Activity only lists open gigs for applicants and reloads from live notifications', () => {
  const activity = read('app/(tabs)/activity.tsx');
  assert.match(activity, /const openGigs = myGigs\.filter\(\(gig\) => gig\.status === 'open'\)/);
  assert.match(activity, /openGigs\.map\(\(gig\)/);
  assert.match(activity, /useFocusEffect\(/);
  assert.match(activity, /notificationsService\.subscribeToNotifications\(user\.id, \(\) =>\s*\{\s*void loadData\(\)/);
});

test('Notification list and unread badge reconcile INSERT and UPDATE events from the database', () => {
  const service = read('services/notifications.ts');
  const notificationsScreen = read('app/notifications.tsx');
  const home = read('app/(tabs)/index.tsx');
  assert.match(service, /event: '\*'/);
  assert.match(service, /payload\.eventType === 'UPDATE'/);
  assert.match(notificationsScreen, /eventType === 'INSERT'/);
  assert.match(notificationsScreen, /return prev\.map\(\(item\) => item\.id === changedNotification\.id/);
  assert.match(home, /notificationsService\.subscribeToNotifications\(user\.id, \(\) =>\s*\{[\s\S]*?void loadHomeData\(\)/);
});

test('Agreement screen reloads milestone, payment, and review state on relevant notification and focus', () => {
  const agreement = read('app/agreements/[id].tsx');
  assert.match(agreement, /useFocusEffect\(/);
  assert.match(agreement, /notificationsService\.subscribeToNotifications/);
  assert.match(agreement, /notification\.entity_id === id \|\| notification\.data\?\.agreement_id === id/);
  assert.match(agreement, /void loadData\(\)/);
});

test('Gig lists refresh on focus and subscribe to RLS-filtered Realtime changes', () => {
  const gigsScreen = read('app/(tabs)/gigs.tsx');
  const service = read('services/gigs.ts');
  const migration = read('supabase/migrations/20261013100000_enable_gig_realtime.sql');
  assert.match(gigsScreen, /useFocusEffect\(/);
  assert.match(gigsScreen, /subscribeToGigChanges/);
  assert.match(service, /table: 'gigs'/);
  assert.match(migration, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.gigs/);
  assert.match(migration, /RLS still controls every delivered row/);
});
