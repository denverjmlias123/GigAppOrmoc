const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (name) => fs.readFileSync(path.join(process.cwd(), name), 'utf8');

test('M32: migration is additive and adds revision_feedback, FK indexes, and hardened RPCs', () => {
  const sql = read('supabase/migrations/20261016000000_m32_loop_and_security_hardening.sql');
  
  // 1. Column addition
  assert.match(sql, /ALTER TABLE public\.milestones[\s\S]*?ADD COLUMN IF NOT EXISTS revision_feedback text/);

  // 2. Foreign Key Indexes
  const indexes = [
    'idx_agreements_gig_id',
    'idx_categories_created_by',
    'idx_messages_sender_id',
    'idx_payments_milestone_id',
    'idx_portfolio_items_profile_id',
    'idx_profile_hiring_interests_category_id',
    'idx_profile_skills_skill_id',
    'idx_reviews_hidden_by',
    'idx_skills_created_by',
    'idx_submissions_freelancer_id',
  ];
  for (const idx of indexes) {
    assert.match(sql, new RegExp(`CREATE INDEX IF NOT EXISTS ${idx}`));
  }

  // 3. RPC Hardening
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.resolve_report/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.switch_mode/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.admin_soft_delete_user/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.review_milestone/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.define_milestones/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.report_payment/);
  assert.match(sql, /revision_feedback = trim\(p_feedback\)/);
  assert.match(sql, /GRANT SELECT, INSERT ON TABLE public\.audit_events TO service_role/);
});

test('M32: Milestone revision feedback is typed in service and displayed across submit and agreement screens', () => {
  const milestoneService = read('services/milestones.ts');
  const agreementDetail = read('app/agreements/[id].tsx');
  const submitScreen = read('app/agreements/[id]/milestones/[milestoneId]/submit.tsx');

  assert.match(milestoneService, /revision_feedback\?: string \| null/);
  assert.match(agreementDetail, /m\.revision_feedback/);
  assert.match(agreementDetail, /Revision Feedback:/);
  assert.match(submitScreen, /revisionFeedback/);
  assert.match(submitScreen, /Client Revision Feedback/);
});

test('M32: Payment reporting supports milestone allocation and remaining unpaid balance pre-fill', () => {
  const reportScreen = read('app/agreements/[id]/payments/report.tsx');
  assert.match(reportScreen, /milestonesService\.getAgreementMilestones/);
  assert.match(reportScreen, /paymentsService\.reportPayment\(\{/);
  assert.match(reportScreen, /milestoneId:\s*selectedMilestoneId\s*\|\|\s*undefined/);
  assert.match(reportScreen, /Apply to Milestone \(Optional\)/);
  assert.match(reportScreen, /General \/ Unallocated/);
});

test('M32: Real-time applicant subscription and proposal withdrawal in activity', () => {
  const appService = read('services/applications.ts');
  const activityScreen = read('app/(tabs)/activity.tsx');
  const applicantsScreen = read('app/gigs/[id]/applicants.tsx');

  assert.match(appService, /subscribeToGigApplicants/);
  assert.match(activityScreen, /applicationsService\.respondToCounter\(app\.id, action\)/);
  assert.match(activityScreen, /title: 'Withdraw Proposal'/);
  assert.match(activityScreen, /handleRespondToCounter\(app, 'withdraw'\)/);
  assert.match(applicantsScreen, /subscribeToGigApplicants/);
});

test('M32: Gig editing and AI polishing integration', () => {
  const gigsService = read('services/gigs.ts');
  const postScreen = read('app/gigs/post.tsx');
  const gigDetail = read('app/gigs/[id].tsx');

  assert.match(gigsService, /async updateGig\(gigId: string, params: CreateGigParams\)/);
  assert.match(postScreen, /editGigId/);
  assert.match(postScreen, /gigsService\.updateGig\(editGigId/);
  assert.match(postScreen, /aiService\.polishGigDescription/);
  assert.match(gigDetail, /strings\.gigs\.editGig/);
});

test('M32: In-app confirmation dialogs and zero system alert APIs', () => {
  const reportScreen = read('app/agreements/[id]/payments/report.tsx');
  const activityScreen = read('app/(tabs)/activity.tsx');
  const postScreen = read('app/gigs/post.tsx');
  const skillsScreen = read('app/profile/skills.tsx');

  for (const code of [reportScreen, activityScreen, postScreen, skillsScreen]) {
    assert.doesNotMatch(code, /Alert\.alert/);
    assert.doesNotMatch(code, /window\.alert/);
    assert.doesNotMatch(code, /window\.confirm/);
  }
});
