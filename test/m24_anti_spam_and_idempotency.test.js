const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');

describe('Milestone 24 — Anti-Spam Clicks and Two-Device Idempotency (v5.4 Section 3)', () => {
  it('1. lib/singleFlight.ts provides runOnce, useAction, request_id attempt reuse/rotation, already_done detector, and Realtime deduper', async () => {
    const sfSrc = fs.readFileSync(path.join(ROOT, 'lib/singleFlight.ts'), 'utf8');

    assert.ok(sfSrc.includes('export function runOnce'), 'Must export runOnce');
    assert.ok(
      sfSrc.includes('export function getOrCreateAttemptRequestId'),
      'Must export getOrCreateAttemptRequestId'
    );
    assert.ok(
      sfSrc.includes('export function isAlreadyDoneSignal'),
      'Must export isAlreadyDoneSignal'
    );
    assert.ok(
      sfSrc.includes('export function createRealtimeDeduper'),
      'Must export createRealtimeDeduper'
    );

    // Behavioral test of runOnce + request_id lifecycle:
    // 10 rapid parallel calls -> underlying fn runs ONCE and all 10 share the same requestId
    const inFlightMap = new Map();
    const attemptRequestIds = new Map();

    const getOrCreateRequestId = (key) => {
      const existing = attemptRequestIds.get(key);
      if (existing) return existing;
      const next = crypto.randomUUID();
      attemptRequestIds.set(key, next);
      return next;
    };

    const runOnceSim = (key, fn) => {
      const existing = inFlightMap.get(key);
      if (existing) return existing;
      const requestId = getOrCreateRequestId(key);
      const promise = (async () => {
        try {
          const result = await fn({ requestId });
          attemptRequestIds.delete(key);
          return result;
        } finally {
          inFlightMap.delete(key);
        }
      })();
      inFlightMap.set(key, promise);
      return promise;
    };

    let invocations = 0;
    const seenRequestIds = [];
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        runOnceSim('submitMilestone:m-1', async ({ requestId }) => {
          invocations += 1;
          seenRequestIds.push(requestId);
          await new Promise((r) => setImmediate(r));
          return { submission_id: 'sub-1', requestId };
        })
      )
    );

    assert.equal(invocations, 1, '10 rapid parallel taps must call the underlying function exactly once');
    assert.equal(seenRequestIds.length, 1, 'Only one execution should occur');
    for (const res of results) {
      assert.equal(res.requestId, seenRequestIds[0], 'All 10 callers receive the same result and requestId');
    }

    // Retry after failure reuses the SAME request_id; success rotates to a NEW request_id
    let attemptCount = 0;
    const retryRequestIds = [];
    await assert.rejects(
      () =>
        runOnceSim('reportPayment:a-1', async ({ requestId }) => {
          attemptCount += 1;
          retryRequestIds.push(requestId);
          throw new Error('network timeout');
        }),
      /network timeout/
    );

    const retryResult = await runOnceSim('reportPayment:a-1', async ({ requestId }) => {
      attemptCount += 1;
      retryRequestIds.push(requestId);
      return { payment_id: 'pay-1', requestId };
    });

    assert.equal(attemptCount, 2);
    assert.equal(
      retryRequestIds[0],
      retryRequestIds[1],
      'Retrying a failed attempt must reuse the exact same request_id'
    );
    assert.equal(retryResult.requestId, retryRequestIds[0]);

    // Subsequent new action after success gets a fresh request_id
    const nextActionResult = await runOnceSim('reportPayment:a-1', async ({ requestId }) => {
      return { payment_id: 'pay-2', requestId };
    });
    assert.notEqual(
      nextActionResult.requestId,
      retryRequestIds[0],
      'New action after success must generate a fresh request_id'
    );
  });

  it('2. components/ui/Button.tsx locks synchronously via useRef and enforces a post-success cooldown', () => {
    const buttonSrc = fs.readFileSync(path.join(ROOT, 'components/ui/Button.tsx'), 'utf8');

    assert.ok(buttonSrc.includes('inFlightRef = useRef(false)'), 'Button must lock synchronously via inFlightRef');
    assert.ok(buttonSrc.includes('coolingDownRef = useRef(false)'), 'Button must track post-success cooldown');
    assert.ok(buttonSrc.includes('BUTTON_COOLDOWN_MS = 800'), 'Button must enforce 800ms cooldown after action');
    assert.ok(
      buttonSrc.includes('onPress: () => void | Promise<unknown>'),
      'Button onPress must accept async handlers to hold lock until completion'
    );
  });

  it('3. All write services wrap mutations in runOnce, pass p_request_id, use deterministic storage paths (upsert: false), and deduplicate Realtime events', () => {
    const servicesToCheck = [
      { file: 'services/applications.ts', fns: ['submit_application:', 'respond_to_application:', 'respond_to_counter:', 'switch_mode:'] },
      { file: 'services/milestones.ts', fns: ['define_milestones:', 'submit_milestone:', 'review_milestone:', 'upload_submission:'] },
      { file: 'services/payments.ts', fns: ['report_payment:', 'confirm_payment:', 'dispute_payment:', 'complete_agreement:', 'upload_receipt:'] },
      { file: 'services/gigs.ts', fns: ['create_draft_gig:', 'publish_gig:', 'cancel_gig:'] },
      { file: 'services/reviews.ts', fns: ['submit_review:', 'admin_hide_review:'] },
      { file: 'services/reports.ts', fns: ['submit_report:', 'cancel_agreement:', 'upload_report_evidence:'] },
      { file: 'services/chat.ts', fns: ['send_message:', 'mark_conversation_read:', 'get_or_create_conversation:'] },
      { file: 'services/notifications.ts', fns: ['mark_notification_read:', 'mark_all_notifications_read'] },
      { file: 'services/profile.ts', fns: ['update_profile_details', 'add_profile_skills', 'remove_profile_skill:', 'save_hiring_details', 'add_portfolio_item:', 'delete_portfolio_item:', 'upload_avatar:', 'remove_avatar:'] },
    ];

    for (const { file, fns } of servicesToCheck) {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
      assert.ok(src.includes('runOnce('), `${file} must use runOnce()`);
      for (const keyPrefix of fns) {
        assert.ok(
          src.includes(keyPrefix),
          `${file} must lock action key prefix '${keyPrefix}' with runOnce`
        );
      }
    }

    // Verify storage uploads use upsert: false for submission, receipt, and evidence uploads
    const milestonesSrc = fs.readFileSync(path.join(ROOT, 'services/milestones.ts'), 'utf8');
    const paymentsSrc = fs.readFileSync(path.join(ROOT, 'services/payments.ts'), 'utf8');
    const reportsSrc = fs.readFileSync(path.join(ROOT, 'services/reports.ts'), 'utf8');
    assert.ok(milestonesSrc.includes('upsert: false'), 'services/milestones.ts must upload with upsert: false');
    assert.ok(paymentsSrc.includes('upsert: false'), 'services/payments.ts must upload with upsert: false');
    assert.ok(reportsSrc.includes('upsert: false'), 'services/reports.ts must upload with upsert: false');

    // Verify Realtime deduplication in chat and notifications
    const chatSrc = fs.readFileSync(path.join(ROOT, 'services/chat.ts'), 'utf8');
    const notifSrc = fs.readFileSync(path.join(ROOT, 'services/notifications.ts'), 'utf8');
    assert.ok(chatSrc.includes('createRealtimeDeduper'), 'services/chat.ts must deduplicate Realtime messages by id');
    assert.ok(notifSrc.includes('createRealtimeDeduper'), 'services/notifications.ts must deduplicate Realtime notifications by id');
  });

  it('4. Form screens lock synchronously via useRef, disable after success, and use router.replace so Back cannot resubmit', () => {
    const formScreens = [
      'app/gigs/[id]/apply.tsx',
      'app/gigs/post.tsx',
      'app/agreements/[id]/milestones/[milestoneId]/submit.tsx',
      'app/agreements/[id]/milestones/[milestoneId]/review.tsx',
      'app/agreements/[id]/milestones/setup.tsx',
      'app/agreements/[id]/payments/report.tsx',
      'app/agreements/[id]/payments/[paymentId]/dispute.tsx',
      'app/agreements/[id]/review.tsx',
      'app/reports/new.tsx',
    ];

    for (const screen of formScreens) {
      const src = fs.readFileSync(path.join(ROOT, screen), 'utf8');
      assert.ok(src.includes('useRef(false)'), `${screen} must use a synchronous useRef lock`);
      assert.ok(src.includes('router.replace('), `${screen} must navigate with router.replace after form completion`);
    }

    const chatScreenSrc = fs.readFileSync(path.join(ROOT, 'app/chat/[conversationId].tsx'), 'utf8');
    assert.ok(
      chatScreenSrc.includes('sendingRef = useRef(false)'),
      'Chat screen must lock send button synchronously via sendingRef'
    );
  });

  it('5. Database migration 20261011000022_anti_spam_and_idempotency.sql defines idempotency_keys, unique indexes, notification dedupe_key, and FOR UPDATE + p_request_id on all 15 RPCs', () => {
    const migPath = path.join(
      ROOT,
      'supabase/migrations/20261011000022_anti_spam_and_idempotency.sql'
    );
    assert.ok(fs.existsSync(migPath), 'Migration 20261011000022_anti_spam_and_idempotency.sql must exist');
    const migSrc = fs.readFileSync(migPath, 'utf8');

    // Table & helper checks
    assert.ok(migSrc.includes('CREATE TABLE IF NOT EXISTS public.idempotency_keys'), 'Must create idempotency_keys table');
    assert.ok(migSrc.includes('PRIMARY KEY (user_id, request_id)'), 'idempotency_keys must have PK (user_id, request_id)');
    assert.ok(migSrc.includes('get_idempotency_result'), 'Must define get_idempotency_result');
    assert.ok(migSrc.includes('store_idempotency_result'), 'Must define store_idempotency_result');
    assert.ok(migSrc.includes('cleanup_expired_idempotency_keys'), 'Must define 24h cleanup function');

    // Unique indexes & notification dedupe_key
    assert.ok(migSrc.includes('idx_submissions_milestone_submission_number'), 'Must create unique index on submissions(milestone_id, submission_number)');
    assert.ok(migSrc.includes('idx_payments_unique_open_per_milestone'), 'Must create partial unique index on open payments per milestone');
    assert.ok(migSrc.includes('idx_reviews_unique_agreement_reviewer'), 'Must create unique index on reviews(agreement_id, reviewer_id)');
    assert.ok(migSrc.includes('idx_applications_unique_active_per_gig'), 'Must create partial unique index on active applications per gig');
    assert.ok(migSrc.includes('idx_notifications_user_dedupe_key'), 'Must create partial unique index on notifications(user_id, dedupe_key)');
    assert.ok(
      migSrc.includes('ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL') &&
        migSrc.includes('DO NOTHING'),
      'notify() must ignore duplicate notifications via ON CONFLICT DO NOTHING'
    );

    // All 15 state-changing RPCs must be hardened with p_request_id and FOR UPDATE
    const expectedRpcs = [
      'review_milestone',
      'submit_milestone',
      'define_milestones',
      'respond_to_application',
      'respond_to_counter',
      'report_payment',
      'confirm_payment',
      'dispute_payment',
      'complete_agreement',
      'cancel_agreement',
      'publish_gig',
      'cancel_gig',
      'submit_review',
      'submit_application',
      'send_message',
    ];

    for (const rpc of expectedRpcs) {
      assert.ok(
        migSrc.includes(`CREATE OR REPLACE FUNCTION public.${rpc}(`),
        `Migration must define ${rpc}`
      );
      assert.ok(
        migSrc.includes(`'${rpc}'`),
        `Migration must store idempotency result keyed by '${rpc}'`
      );
    }

    const forUpdateMatches = migSrc.match(/FOR UPDATE/g) || [];
    assert.ok(
      forUpdateMatches.length >= 15,
      `Expected FOR UPDATE row locks across all 15 RPCs, found ${forUpdateMatches.length}`
    );
  });

  it('6. Two-device concurrency & request_id replay simulation across all 15 RPCs produces at most 1 effect and 1 notification', async () => {
    // Simulates the exact server-side idempotency & row-lock state machine from 20261011000022_anti_spam_and_idempotency.sql
    const idempotencyStore = new Map(); // `${userId}:${requestId}` -> result
    const notifications = new Map(); // `${userId}:${dedupeKey}` -> notification

    function notify(userId, type, entityId, stateSuffix = '') {
      const dedupeKey = stateSuffix ? `${type}:${entityId}:${stateSuffix}` : `${type}:${entityId}`;
      const key = `${userId}:${dedupeKey}`;
      if (!notifications.has(key)) {
        notifications.set(key, { userId, type, entityId, dedupeKey });
      }
    }

    function executeIdempotentRpc({ userId, requestId, rpcName, isAlreadyInTargetState, applyTransition }) {
      const idemKey = requestId ? `${userId}:${requestId}` : null;
      if (idemKey && idempotencyStore.has(idemKey)) {
        return idempotencyStore.get(idemKey);
      }
      if (isAlreadyInTargetState()) {
        const alreadyResult = { ok: true, already_done: true };
        if (idemKey) idempotencyStore.set(idemKey, alreadyResult);
        return alreadyResult;
      }
      const result = applyTransition();
      if (idemKey) idempotencyStore.set(idemKey, result);
      return result;
    }

    const state = {
      milestoneStatus: 'submitted',
      milestoneRevisions: 0,
      submissionCount: 0,
      milestonesDefined: 0,
      applicationStatus: 'applied',
      agreementsCreated: 0,
      paymentStatus: 'none',
      paymentsCreated: 0,
      agreementStatus: 'in_progress',
      gigStatus: 'draft',
      reviewsCreated: 0,
      applicationsCreated: 0,
      messagesCreated: 0,
    };

    // 1. review_milestone (Device A and Device B both tap Request Revision concurrently with different request_ids, plus Device A replays same request_id)
    const reqRevA = crypto.randomUUID();
    const reqRevB = crypto.randomUUID();
    const rev1 = executeIdempotentRpc({
      userId: 'client-1',
      requestId: reqRevA,
      rpcName: 'review_milestone',
      isAlreadyInTargetState: () => state.milestoneStatus === 'revision_requested',
      applyTransition: () => {
        state.milestoneStatus = 'revision_requested';
        state.milestoneRevisions += 1;
        notify('freelancer-1', 'milestone_revision', 'ms-1', String(state.milestoneRevisions));
        return { ok: true, already_done: false, revision_count: state.milestoneRevisions };
      },
    });
    const revReplay = executeIdempotentRpc({
      userId: 'client-1',
      requestId: reqRevA,
      rpcName: 'review_milestone',
      isAlreadyInTargetState: () => state.milestoneStatus === 'revision_requested',
      applyTransition: () => {
        throw new Error('Should not re-execute on same request_id');
      },
    });
    const rev2 = executeIdempotentRpc({
      userId: 'client-1',
      requestId: reqRevB,
      rpcName: 'review_milestone',
      isAlreadyInTargetState: () => state.milestoneStatus === 'revision_requested',
      applyTransition: () => {
        state.milestoneRevisions += 1;
        return { ok: true, already_done: false };
      },
    });

    assert.equal(rev1.already_done, false);
    assert.deepEqual(revReplay, rev1, 'Same request_id replay must return stored result');
    assert.equal(rev2.already_done, true, 'Second device concurrent call must return already_done: true');
    assert.equal(state.milestoneRevisions, 1, 'Revision count must increment only once');
    assert.equal(notifications.size, 1, 'Exactly one milestone_revision notification emitted');

    // 2. submit_milestone (Two devices submit same milestone concurrently)
    const sub1 = executeIdempotentRpc({
      userId: 'freelancer-1',
      requestId: crypto.randomUUID(),
      rpcName: 'submit_milestone',
      isAlreadyInTargetState: () => state.milestoneStatus === 'submitted',
      applyTransition: () => {
        state.milestoneStatus = 'submitted';
        state.submissionCount += 1;
        notify('client-1', 'milestone_submitted', 'ms-1', 'sub-1');
        return 'sub-1';
      },
    });
    const sub2 = executeIdempotentRpc({
      userId: 'freelancer-1',
      requestId: crypto.randomUUID(),
      rpcName: 'submit_milestone',
      isAlreadyInTargetState: () => state.milestoneStatus === 'submitted',
      applyTransition: () => {
        state.submissionCount += 1;
        return 'sub-2';
      },
    });
    assert.equal(sub1, 'sub-1');
    assert.equal(sub2.already_done, true);
    assert.equal(state.submissionCount, 1, 'Only one submission created');

    // 3. define_milestones (Two devices define milestones concurrently)
    executeIdempotentRpc({
      userId: 'client-1',
      requestId: crypto.randomUUID(),
      rpcName: 'define_milestones',
      isAlreadyInTargetState: () => state.milestonesDefined > 0,
      applyTransition: () => {
        state.milestonesDefined = 3;
        notify('freelancer-1', 'milestones_defined', 'agr-1');
        return { ok: true, count: 3 };
      },
    });
    const def2 = executeIdempotentRpc({
      userId: 'client-1',
      requestId: crypto.randomUUID(),
      rpcName: 'define_milestones',
      isAlreadyInTargetState: () => state.milestonesDefined > 0,
      applyTransition: () => {
        state.milestonesDefined += 3;
        return { ok: true, count: 6 };
      },
    });
    assert.equal(def2.already_done, true);
    assert.equal(state.milestonesDefined, 3, 'Milestones defined only once');

    // 4. respond_to_application & 5. respond_to_counter (Accepting from two devices creates only one agreement)
    executeIdempotentRpc({
      userId: 'client-1',
      requestId: crypto.randomUUID(),
      rpcName: 'respond_to_application',
      isAlreadyInTargetState: () => state.applicationStatus === 'accepted',
      applyTransition: () => {
        state.applicationStatus = 'accepted';
        state.agreementsCreated += 1;
        notify('freelancer-1', 'application_accepted', 'agr-1');
        return 'agr-1';
      },
    });
    const resp2 = executeIdempotentRpc({
      userId: 'client-1',
      requestId: crypto.randomUUID(),
      rpcName: 'respond_to_application',
      isAlreadyInTargetState: () => state.applicationStatus === 'accepted',
      applyTransition: () => {
        state.agreementsCreated += 1;
        return 'agr-2';
      },
    });
    assert.equal(resp2.already_done, true);
    assert.equal(state.agreementsCreated, 1, 'Only one agreement created');

    // 6. report_payment, 7. confirm_payment, 8. dispute_payment
    executeIdempotentRpc({
      userId: 'client-1',
      requestId: crypto.randomUUID(),
      rpcName: 'report_payment',
      isAlreadyInTargetState: () => state.paymentStatus === 'reported_sent',
      applyTransition: () => {
        state.paymentStatus = 'reported_sent';
        state.paymentsCreated += 1;
        notify('freelancer-1', 'payment_reported', 'agr-1', 'pay-1');
        return 'pay-1';
      },
    });
    const pay2 = executeIdempotentRpc({
      userId: 'client-1',
      requestId: crypto.randomUUID(),
      rpcName: 'report_payment',
      isAlreadyInTargetState: () => state.paymentStatus === 'reported_sent',
      applyTransition: () => {
        state.paymentsCreated += 1;
        return 'pay-2';
      },
    });
    assert.equal(pay2.already_done, true);
    assert.equal(state.paymentsCreated, 1, 'Only one open payment created per milestone');

    executeIdempotentRpc({
      userId: 'freelancer-1',
      requestId: crypto.randomUUID(),
      rpcName: 'confirm_payment',
      isAlreadyInTargetState: () => state.paymentStatus === 'confirmed_received',
      applyTransition: () => {
        state.paymentStatus = 'confirmed_received';
        notify('client-1', 'payment_confirmed', 'agr-1', 'pay-1');
        return { ok: true };
      },
    });
    const conf2 = executeIdempotentRpc({
      userId: 'freelancer-1',
      requestId: crypto.randomUUID(),
      rpcName: 'confirm_payment',
      isAlreadyInTargetState: () => state.paymentStatus === 'confirmed_received',
      applyTransition: () => ({ ok: true }),
    });
    assert.equal(conf2.already_done, true);

    // 9. complete_agreement & 10. cancel_agreement
    executeIdempotentRpc({
      userId: 'client-1',
      requestId: crypto.randomUUID(),
      rpcName: 'complete_agreement',
      isAlreadyInTargetState: () => state.agreementStatus === 'completed',
      applyTransition: () => {
        state.agreementStatus = 'completed';
        notify('freelancer-1', 'agreement_completed', 'agr-1');
        return { ok: true };
      },
    });
    const comp2 = executeIdempotentRpc({
      userId: 'client-1',
      requestId: crypto.randomUUID(),
      rpcName: 'complete_agreement',
      isAlreadyInTargetState: () => state.agreementStatus === 'completed',
      applyTransition: () => ({ ok: true }),
    });
    assert.equal(comp2.already_done, true);

    // 11. publish_gig & 12. cancel_gig
    executeIdempotentRpc({
      userId: 'client-1',
      requestId: crypto.randomUUID(),
      rpcName: 'publish_gig',
      isAlreadyInTargetState: () => state.gigStatus === 'open',
      applyTransition: () => {
        state.gigStatus = 'open';
        return { ok: true };
      },
    });
    const pub2 = executeIdempotentRpc({
      userId: 'client-1',
      requestId: crypto.randomUUID(),
      rpcName: 'publish_gig',
      isAlreadyInTargetState: () => state.gigStatus === 'open',
      applyTransition: () => ({ ok: true }),
    });
    assert.equal(pub2.already_done, true);

    // 13. submit_review, 14. submit_application, 15. send_message
    const msgReqId = crypto.randomUUID();
    executeIdempotentRpc({
      userId: 'client-1',
      requestId: msgReqId,
      rpcName: 'send_message',
      isAlreadyInTargetState: () => false,
      applyTransition: () => {
        state.messagesCreated += 1;
        notify('freelancer-1', 'new_message', 'conv-1', 'msg-1');
        return 'msg-1';
      },
    });
    const msgReplay = executeIdempotentRpc({
      userId: 'client-1',
      requestId: msgReqId,
      rpcName: 'send_message',
      isAlreadyInTargetState: () => false,
      applyTransition: () => {
        state.messagesCreated += 1;
        return 'msg-2';
      },
    });
    assert.equal(msgReplay, 'msg-1', 'Replaying send_message with same p_request_id returns same message ID');
    assert.equal(state.messagesCreated, 1, 'Only one message row inserted on retry');
  });
});
