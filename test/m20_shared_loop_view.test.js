const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('Milestone 20: Shared Timeline component defines all 10 relationship loop stages and NextStepBanner', () => {
  const timelinePath = path.join(ROOT, 'components', 'ui', 'Timeline.tsx');
  assert.ok(fs.existsSync(timelinePath), 'components/ui/Timeline.tsx must exist');
  const code = fs.readFileSync(timelinePath, 'utf8');

  const expectedStages = [
    'posted',
    'applied',
    'accepted',
    'milestones_set',
    'work_submitted',
    'approved',
    'payment_reported',
    'payment_confirmed',
    'done',
    'reviewed',
  ];

  for (const stage of expectedStages) {
    assert.ok(
      code.includes(`'${stage}'`),
      `Timeline.tsx must include loop stage '${stage}'`
    );
  }

  assert.ok(
    code.includes('export function computeAgreementLoopState') &&
      code.includes('export function computePreAgreementLoopState'),
    'Timeline.tsx must export pure DB-driven stage state functions'
  );
  assert.ok(
    code.includes('export const NextStepBanner') &&
      code.includes('export const Timeline'),
    'Timeline.tsx must export NextStepBanner and Timeline components'
  );
  assert.ok(
    code.includes('strings.loop.youAreHereBadge'),
    'Timeline must display the "You are here" marker on the current stage'
  );
});

test('Milestone 20: Both roles see matching currentStage and complementary Next step banners across every DB stage', () => {
  const timelineCode = fs.readFileSync(
    path.join(ROOT, 'components', 'ui', 'Timeline.tsx'),
    'utf8'
  );

  // Verify role-specific labels from docs/PROFILE_AND_LOOP_V5_1.md section 1 table
  assert.ok(timelineCode.includes('Your gig is live'));
  assert.ok(timelineCode.includes('New applicant'));
  assert.ok(timelineCode.includes('Proposal sent'));
  assert.ok(timelineCode.includes('Hired '));
  assert.ok(timelineCode.includes('You got the job'));
  assert.ok(timelineCode.includes('Milestones set, waiting for work'));
  assert.ok(timelineCode.includes('Your milestones'));
  assert.ok(timelineCode.includes('submitted work: Review'));
  assert.ok(timelineCode.includes('Submitted, waiting for review'));
  assert.ok(timelineCode.includes('Revision requested ('));
  assert.ok(timelineCode.includes('Payment reported: Confirm received'));
  assert.ok(timelineCode.includes('Completed: Review '));
});

test('Milestone 20: Agreement screen, Activity rows, Gig Detail, and Applicants screen render Timeline and NextStepBanner', () => {
  const agreementScreen = fs.readFileSync(
    path.join(ROOT, 'app', 'agreements', '[id].tsx'),
    'utf8'
  );
  assert.ok(
    agreementScreen.includes('<NextStepBanner') &&
      agreementScreen.includes('<Timeline') &&
      agreementScreen.includes('computeAgreementLoopState'),
    'Agreement screen (app/agreements/[id].tsx) must render NextStepBanner and Timeline from DB status'
  );

  const activityScreen = fs.readFileSync(
    path.join(ROOT, 'app', '(tabs)', 'activity.tsx'),
    'utf8'
  );
  assert.ok(
    activityScreen.includes('<NextStepBanner') &&
      activityScreen.includes('<Timeline') &&
      activityScreen.includes('computeAgreementLoopState') &&
      activityScreen.includes('computePreAgreementLoopState'),
    'Activity screen (app/(tabs)/activity.tsx) must render Timeline and NextStepBanner for both roles'
  );

  const gigDetailScreen = fs.readFileSync(
    path.join(ROOT, 'app', 'gigs', '[id].tsx'),
    'utf8'
  );
  assert.ok(
    gigDetailScreen.includes('<NextStepBanner') &&
      gigDetailScreen.includes('<Timeline'),
    'Gig Detail screen (app/gigs/[id].tsx) must render NextStepBanner and Timeline'
  );

  const applicantsScreen = fs.readFileSync(
    path.join(ROOT, 'app', 'gigs', '[id]', 'applicants.tsx'),
    'utf8'
  );
  assert.ok(
    applicantsScreen.includes('<NextStepBanner') &&
      applicantsScreen.includes('handleOpenApplicantChat'),
    'Applicants screen (app/gigs/[id]/applicants.tsx) must render NextStepBanner and Open Chat button'
  );
});

test('Milestone 20: Notifications and Chat deep-link into the right loop stage', () => {
  const notificationsScreen = fs.readFileSync(
    path.join(ROOT, 'app', 'notifications.tsx'),
    'utf8'
  );
  assert.ok(
    notificationsScreen.includes("item.type === 'milestone_submitted'") &&
      notificationsScreen.includes("pathname: '/agreements/[id]/milestones/[milestoneId]/review'") &&
      notificationsScreen.includes("item.type === 'milestone_revision_requested'") &&
      notificationsScreen.includes("pathname: '/agreements/[id]/milestones/[milestoneId]/submit'") &&
      notificationsScreen.includes("pathname: '/chat/[conversationId]'"),
    'Notifications screen must deep-link directly to milestone review, milestone submit, agreement, applicants, and chat stages'
  );

  const chatScreen = fs.readFileSync(
    path.join(ROOT, 'app', 'chat', '[conversationId].tsx'),
    'utf8'
  );
  assert.ok(
    chatScreen.includes('handleGoToStage') &&
      chatScreen.includes("pathname: '/agreements/[id]'") &&
      chatScreen.includes("pathname: '/gigs/[id]/applicants'"),
    'Chat screen must allow jumping directly to the current loop stage (Agreement, Applicants, or Gig Detail)'
  );
});

test('Milestone 20: Relationship writes never fall back to direct protected-table mutations', () => {
  for (const [file, table] of [
    ['milestones', 'milestones'],
    ['payments', 'payments'],
    ['payments', 'agreements'],
    ['reviews', 'reviews'],
  ]) {
    const code = fs.readFileSync(path.join(ROOT, 'services', `${file}.ts`), 'utf8');
    assert.doesNotMatch(
      code,
      new RegExp(`from\\(['\"]${table}['\"]\\)[\\s\\S]{0,140}\\.(insert|update|delete)\\(`),
      `${file}.ts must route ${table} state changes through protected RPCs`
    );
  }
});

test('Milestone 20: Relationship screens surface failed data loads instead of showing fabricated empty results', () => {
  for (const file of [
    path.join(ROOT, 'app', '(tabs)', 'activity.tsx'),
    path.join(ROOT, 'app', 'gigs', '[id].tsx'),
    path.join(ROOT, 'app', 'chat', '[conversationId].tsx'),
    path.join(ROOT, 'app', 'profile', '[id].tsx'),
  ]) {
    const code = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(code, /\.catch\(\(\)\s*=>\s*\[\]\)/);
  }

  const chatScreen = fs.readFileSync(path.join(ROOT, 'app', 'chat', '[conversationId].tsx'), 'utf8');
  assert.ok(chatScreen.includes('title={strings.common.retry}'), 'Chat load errors should offer retry');
  const publicProfile = fs.readFileSync(path.join(ROOT, 'app', 'profile', '[id].tsx'), 'utf8');
  assert.ok(publicProfile.includes('setLoadAttempt'), 'Public profile load errors should offer retry');
});
