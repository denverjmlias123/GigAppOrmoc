const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (name) => fs.readFileSync(path.join(process.cwd(), name), 'utf8');

test('M31: migration is additive and deletion is an authenticated, idempotent, audited RPC', () => {
  const sql = read('supabase/migrations/20261013110000_m31_delete_gig.sql');
  for (const column of ['deleted_at', 'deleted_by', 'delete_reason', 'status_reason', 'gig_title_snapshot', 'closed_at', 'closed_reason', 'is_system']) {
    assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
  }
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.delete_gig\(/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /gig_has_agreement/);
  assert.match(sql, /status_reason = 'gig_deleted'/);
  assert.match(sql, /dedupe_key/);
  assert.match(sql, /'gig_deleted'/);
  assert.match(sql, /closed_reason = 'gig_deleted'/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.delete_gig\(uuid, text, uuid\) FROM PUBLIC, anon/);
});

test('M31: database behavior tests cover notification, retained history, denial and apply-after-delete', () => {
  const sql = read('supabase/tests/database/28_delete_gig.test.sql');
  for (const evidence of ['wrong user is denied', 'pending applicant is notified', 'second deletion is idempotent', 'hired gig deletion is blocked', 'completed gig deletion is blocked', 'application after deletion is rejected', 'direct gig deletion remains revoked', 'applicant can still read the proposal snapshot']) {
    assert.ok(sql.includes(evidence), `missing pgTAP evidence: ${evidence}`);
  }
});

test('M31: owner flow confirms and reports the notified applicant count', () => {
  const detail = read('app/gigs/[id].tsx');
  const service = read('services/gigs.ts');
  assert.match(detail, /confirmDialog\(\{[\s\S]*?strings\.gigs\.deleteGigTitle/);
  assert.match(detail, /gigsService\.deleteGig\(gig\.id/);
  assert.match(read('constants/strings.ts'), /gigDeletedApplicants/);
  assert.match(service, /rpc\('delete_gig'/);
  assert.match(read('components/ui/GigCard.tsx'), /onDelete\?: \(\) => void/);
  assert.match(read('app/(tabs)/gigs.tsx'), /onDelete=\{/);
});

test('M31: deleted proposal history remains visible without action controls', () => {
  const service = read('services/applications.ts');
  const activity = read('app/(tabs)/activity.tsx');
  assert.match(service, /gig_title_snapshot/);
  assert.match(activity, /status_reason === 'gig_deleted'/);
  assert.match(activity, /app\.gig_title_snapshot/);
  assert.match(activity, /strings\.gigs\.deletedGigProposalDesc/);
});

test('M31: closed gig detail explains unavailability and keeps participant agreement history reachable', () => {
  const detail = read('app/gigs/[id].tsx');
  const strings = read('constants/strings.ts');
  assert.match(detail, /if \(!data\)[\s\S]*?getMyAgreements\(\)[\s\S]*?setGigAgreement\(matchingAgr\)/);
  assert.match(detail, /strings\.gigs\.gigUnavailableTitle/);
  assert.match(detail, /strings\.gigs\.unavailableAgreementDesc/);
  assert.match(detail, /pathname: '\/agreements\/\[id\]'/);
  assert.match(strings, /gigUnavailable: 'This gig is no longer open to new proposals/);
  assert.match(strings, /unavailableAgreementDesc: 'You have an agreement for this gig/);
});

test('M31: deleted application conversations retain history but disable sending', () => {
  const chatService = read('services/chat.ts');
  const screen = read('app/chat/[conversationId].tsx');
  assert.match(chatService, /closed_at/);
  assert.match(chatService, /is_system/);
  assert.match(screen, /conversation\?\.closed_at/);
  assert.match(screen, /strings\.errors\.deletedConversationReadOnly/);
  assert.match(read('constants/strings.ts'), /This conversation is read-only because the gig was deleted/);
  assert.match(chatService, /subscribeToConversationChanges/);
  assert.match(read('supabase/migrations/20261013120000_m31_deleted_state_realtime.sql'), /reject_lifecycle_change_after_gig_delete/);
});
