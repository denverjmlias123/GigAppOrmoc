const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('M35: Portfolio screen guards against client role access', () => {
  const file = fs.readFileSync(path.join(__dirname, '../app/profile/portfolio.tsx'), 'utf8');
  assert.match(file, /const isHire = profile\?\.active_mode === 'hire'/);
  assert.match(file, /if \(isHire\)/);
  assert.match(file, /Freelancer Mode Only/);
  assert.match(file, /Edit Client Hiring Details/);
});

test('M35: Report screen blocks submission without valid targetId and targetType', () => {
  const file = fs.readFileSync(path.join(__dirname, '../app/reports/new.tsx'), 'utf8');
  assert.match(file, /if \(!targetId \|\| !targetType\)/);
  assert.match(file, /Missing Target/);
});

test('M35: Public profile strictly matches chat conversations by partner ID', () => {
  const file = fs.readFileSync(path.join(__dirname, '../app/profile/[id].tsx'), 'utf8');
  assert.match(file, /existingConv = convList\.find\(\(c\) => c\.partner_id === id\)/);
  assert.doesNotMatch(file, /c\.partner_name === data\?\.profile\.display_name/);
});

test('M35: Mode settings provides retry action on network errors', () => {
  const file = fs.readFileSync(path.join(__dirname, '../app/settings/mode.tsx'), 'utf8');
  assert.match(file, /strings\.common\.retry/);
  assert.match(file, /onPress=\{fetchStatus\}/);
});

test('M35: Sessions screen surfaces revocation error without wiping session cards', () => {
  const file = fs.readFileSync(path.join(__dirname, '../app/settings/sessions.tsx'), 'utf8');
  assert.match(file, /showToast\(err\?\.message \|\| 'Could not log out other sessions\.', 'error'\)/);
});

test('M35: Chat screen applies optimistic message updates with temporary ID reconciliation', () => {
  const file = fs.readFileSync(path.join(__dirname, '../app/chat/[conversationId].tsx'), 'utf8');
  assert.match(file, /const tempId = `temp-\${Date\.now\(\)}`/);
  assert.match(file, /m\.id\.startsWith\('temp-'\)/);
  assert.match(file, /Conversation not found or access denied\./);
});
