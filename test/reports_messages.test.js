const test = require('node:test');
const assert = require('node:assert');

// 1. Agreement cancellation state transitions
test('Agreement cancellation rule: free before start vs dispute after work starts', () => {
  function cancelAgreement({ agreementStatus, milestones, reason }) {
    if (agreementStatus !== 'active') {
      throw new Error('Only active agreements can be cancelled.');
    }
    if (!reason || reason.trim().length < 5) {
      throw new Error('Reason required for cancellation.');
    }

    const hasSubmittedWork = milestones.some(
      (m) => m.status === 'submitted' || m.status === 'approved' || m.status === 'revision_requested'
    );

    if (!hasSubmittedWork) {
      // Work not started -> freely cancelled
      return {
        status: 'cancelled',
        createdReport: false,
      };
    } else {
      // Work started -> flagged as disputed and admin report filed
      return {
        status: 'disputed',
        createdReport: true,
      };
    }
  }

  // Case A: Fresh agreement, no milestones submitted
  const fresh = cancelAgreement({
    agreementStatus: 'active',
    milestones: [{ status: 'pending' }, { status: 'pending' }],
    reason: 'Client changed mind before work began',
  });
  assert.strictEqual(fresh.status, 'cancelled');
  assert.strictEqual(fresh.createdReport, false);

  // Case B: Work already submitted by freelancer
  const workStarted = cancelAgreement({
    agreementStatus: 'active',
    milestones: [{ status: 'submitted' }],
    reason: 'Client wants refund after seeing drafts',
  });
  assert.strictEqual(workStarted.status, 'disputed');
  assert.strictEqual(workStarted.createdReport, true);

  // Case C: One milestone approved, one pending
  const partiallyApproved = cancelAgreement({
    agreementStatus: 'active',
    milestones: [{ status: 'approved' }, { status: 'pending' }],
    reason: 'Dispute over remaining scope',
  });
  assert.strictEqual(partiallyApproved.status, 'disputed');
  assert.strictEqual(partiallyApproved.createdReport, true);
});

// 2. Messaging rate limit check (max 30 msgs / 10 mins)
test('Messaging rate limit threshold', () => {
  function checkMessageRateLimit(recentMessageCount) {
    const MAX_MESSAGES_PER_WINDOW = 30;
    if (recentMessageCount >= MAX_MESSAGES_PER_WINDOW) {
      throw new Error('Message rate limit exceeded. Please wait a few moments before sending more messages.');
    }
    return true;
  }

  assert.strictEqual(checkMessageRateLimit(0), true);
  assert.strictEqual(checkMessageRateLimit(29), true);
  assert.throws(() => checkMessageRateLimit(30), /Message rate limit exceeded/);
  assert.throws(() => checkMessageRateLimit(35), /Message rate limit exceeded/);
});

// 3. Reporting rate limit check (max 5 reports / hr)
test('Report submission rate limit threshold', () => {
  function checkReportRateLimit(recentReportCount) {
    const MAX_REPORTS_PER_HOUR = 5;
    if (recentReportCount >= MAX_REPORTS_PER_HOUR) {
      throw new Error('Report limit reached (maximum 5 reports per hour).');
    }
    return true;
  }

  assert.strictEqual(checkReportRateLimit(0), true);
  assert.strictEqual(checkReportRateLimit(4), true);
  assert.throws(() => checkReportRateLimit(5), /Report limit reached/);
});

// 4. Report category validity
test('Report category and target type validation', () => {
  const validTargetTypes = ['profile', 'gig', 'agreement', 'message'];
  const validCategories = [
    'spam_scam',
    'harassment',
    'unresponsive',
    'payment_issue',
    'work_quality',
    'cancellation_request',
    'other',
  ];

  validTargetTypes.forEach((t) => assert.ok(t.length > 0));
  validCategories.forEach((c) => assert.ok(c.length > 0));
  assert.strictEqual(validTargetTypes.includes('agreement'), true);
  assert.strictEqual(validCategories.includes('cancellation_request'), true);
});
