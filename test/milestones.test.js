const test = require('node:test');
const assert = require('node:assert');

// 1. Milestone sum verification
test('Milestone amount sum validation', () => {
  function validateMilestoneSum(milestones, agreedPriceCentavos) {
    if (milestones.length < 1 || milestones.length > 5) {
      throw new Error('Milestone count must be between 1 and 5.');
    }
    const sum = milestones.reduce((acc, m) => acc + m.amount, 0);
    if (sum !== agreedPriceCentavos) {
      throw new Error(`Milestone sum (${sum}) does not equal agreed price (${agreedPriceCentavos}).`);
    }
    return true;
  }

  const agreed = 150000; // ₱1,500.00 in centavos

  // Exactly matching 2 milestones
  assert.strictEqual(
    validateMilestoneSum(
      [
        { seq: 1, title: 'Draft Design', amount: 50000 },
        { seq: 2, title: 'Final Build', amount: 100000 },
      ],
      agreed
    ),
    true
  );

  // Under-allocated sum throws error
  assert.throws(
    () =>
      validateMilestoneSum(
        [
          { seq: 1, title: 'Draft Design', amount: 50000 },
          { seq: 2, title: 'Final Build', amount: 90000 },
        ],
        agreed
      ),
    /does not equal agreed price/
  );

  // Over-allocated sum throws error
  assert.throws(
    () =>
      validateMilestoneSum(
        [
          { seq: 1, title: 'Draft Design', amount: 100000 },
          { seq: 2, title: 'Final Build', amount: 100000 },
        ],
        agreed
      ),
    /does not equal agreed price/
  );

  // More than 5 milestones throws error
  assert.throws(
    () =>
      validateMilestoneSum(
        [
          { seq: 1, amount: 25000 },
          { seq: 2, amount: 25000 },
          { seq: 3, amount: 25000 },
          { seq: 4, amount: 25000 },
          { seq: 5, amount: 25000 },
          { seq: 6, amount: 25000 },
        ],
        agreed
      ),
    /between 1 and 5/
  );
});

// 2. Revision counter limit (max 2 revisions)
test('Milestone revision lifecycle limit', () => {
  function reviewMilestone(currentStatus, currentRevisionCount, action) {
    if (currentStatus !== 'submitted') {
      throw new Error('Only submitted milestones can be reviewed.');
    }

    if (action === 'approve') {
      return { status: 'approved', revisionCount: currentRevisionCount };
    }

    if (action === 'request_revision') {
      if (currentRevisionCount >= 2) {
        throw new Error('Maximum of 2 revisions already reached for this milestone.');
      }
      return {
        status: 'revision_requested',
        revisionCount: currentRevisionCount + 1,
      };
    }

    throw new Error('Invalid action');
  }

  // Initial submission review -> 1st revision
  const rev1 = reviewMilestone('submitted', 0, 'request_revision');
  assert.strictEqual(rev1.status, 'revision_requested');
  assert.strictEqual(rev1.revisionCount, 1);

  // 2nd submission review -> 2nd revision
  const rev2 = reviewMilestone('submitted', 1, 'request_revision');
  assert.strictEqual(rev2.status, 'revision_requested');
  assert.strictEqual(rev2.revisionCount, 2);

  // 3rd submission review -> requesting a 3rd revision must fail
  assert.throws(
    () => reviewMilestone('submitted', 2, 'request_revision'),
    /Maximum of 2 revisions already reached/
  );

  // Approving works at any revision level
  const app1 = reviewMilestone('submitted', 2, 'approve');
  assert.strictEqual(app1.status, 'approved');
  assert.strictEqual(app1.revisionCount, 2);
});

// 3. Role enforcement for submissions and reviews
test('Milestone role authorization simulation', () => {
  function canSubmitMilestone(userId, freelancerId) {
    return userId === freelancerId;
  }

  function canReviewMilestone(userId, clientId) {
    return userId === clientId;
  }

  const client = 'usr_client';
  const freelancer = 'usr_freelancer';
  const stranger = 'usr_stranger';

  // Only freelancer can submit
  assert.strictEqual(canSubmitMilestone(freelancer, freelancer), true);
  assert.strictEqual(canSubmitMilestone(client, freelancer), false);
  assert.strictEqual(canSubmitMilestone(stranger, freelancer), false);

  // Only client can review
  assert.strictEqual(canReviewMilestone(client, client), true);
  assert.strictEqual(canReviewMilestone(freelancer, client), false);
  assert.strictEqual(canReviewMilestone(stranger, client), false);
});
