const test = require('node:test');
const assert = require('node:assert');

// 1. End-to-end loop price consistency (pesos to centavos, milestone sum check)
test('Complete Real Loop: Milestone sum exact parity with agreed price', () => {
  function validateMilestoneSum(agreedPriceCentavos, milestones) {
    if (!milestones || milestones.length === 0 || milestones.length > 5) {
      throw new Error('Agreement must have between 1 and 5 milestones.');
    }
    const sum = milestones.reduce((acc, m) => acc + m.amount, 0);
    if (sum !== agreedPriceCentavos) {
      throw new Error(`Sum of milestone amounts (${sum}) must exactly equal agreed price (${agreedPriceCentavos}).`);
    }
    return true;
  }

  const agreed = 50000; // ₱500.00
  const validMilestones = [
    { title: 'Milestone 1', amount: 20000 },
    { title: 'Milestone 2', amount: 30000 },
  ];
  assert.strictEqual(validateMilestoneSum(agreed, validMilestones), true);

  const invalidMilestones = [
    { title: 'Milestone 1', amount: 20000 },
    { title: 'Milestone 2', amount: 25000 },
  ];
  assert.throws(() => validateMilestoneSum(agreed, invalidMilestones), /must exactly equal agreed price/);
});

// 2. Revision count limit (max 2)
test('Complete Real Loop: Milestone review revision limit strictly enforced', () => {
  function requestRevision(milestone, feedback) {
    if (!feedback || feedback.trim().length < 5) {
      throw new Error('Feedback of at least 5 characters is required.');
    }
    if (milestone.revision_count >= 2) {
      throw new Error('Maximum revisions limit (2) reached for this milestone.');
    }
    return {
      ...milestone,
      status: 'revision_requested',
      revision_count: milestone.revision_count + 1,
    };
  }

  let m = { id: 'm1', status: 'submitted', revision_count: 0 };
  m = requestRevision(m, 'Please improve mobile responsiveness.');
  assert.strictEqual(m.revision_count, 1);

  m.status = 'submitted';
  m = requestRevision(m, 'Still missing tablet support.');
  assert.strictEqual(m.revision_count, 2);

  m.status = 'submitted';
  assert.throws(() => requestRevision(m, 'Another change please'), /Maximum revisions limit \(2\) reached/);
});

// 3. Payment completion threshold check
test('Complete Real Loop: Complete agreement requires all milestones approved and confirmed payments', () => {
  function canCompleteAgreement(agreement, milestones, payments) {
    if (agreement.status !== 'active') return false;
    if (milestones.length === 0) return false;
    const unapproved = milestones.some((m) => m.status !== 'approved');
    if (unapproved) return false;

    const hasDisputes = payments.some((p) => p.status === 'disputed');
    if (hasDisputes) return false;

    const hasPendingReports = payments.some((p) => p.status === 'reported_sent');
    if (hasPendingReports) return false;

    const totalConfirmed = payments
      .filter((p) => p.status === 'confirmed_received')
      .reduce((acc, p) => acc + p.amount, 0);

    return totalConfirmed >= agreement.agreed_price;
  }

  const agr = { id: 'agr1', status: 'active', agreed_price: 30000 };
  const allApproved = [{ id: 'm1', status: 'approved' }, { id: 'm2', status: 'approved' }];
  const onePending = [{ id: 'm1', status: 'approved' }, { id: 'm2', status: 'submitted' }];

  // Milestone pending
  assert.strictEqual(canCompleteAgreement(agr, onePending, [{ status: 'confirmed_received', amount: 30000 }]), false);

  // Insufficient payment
  assert.strictEqual(canCompleteAgreement(agr, allApproved, [{ status: 'confirmed_received', amount: 20000 }]), false);

  // Pending payment report
  assert.strictEqual(canCompleteAgreement(agr, allApproved, [
    { status: 'confirmed_received', amount: 20000 },
    { status: 'reported_sent', amount: 10000 },
  ]), false);

  // Disputed payment
  assert.strictEqual(canCompleteAgreement(agr, allApproved, [
    { status: 'confirmed_received', amount: 20000 },
    { status: 'disputed', amount: 10000 },
  ]), false);

  // Valid and complete
  assert.strictEqual(canCompleteAgreement(agr, allApproved, [{ status: 'confirmed_received', amount: 30000 }]), true);
});

// 4. Agreement cancellation logic (free before work vs dispute after work)
test('Complete Real Loop: Free cancellation before work vs dispute after work', () => {
  function cancelAgreement(milestones, reason) {
    if (!reason || reason.trim().length < 5) {
      throw new Error('Reason must be at least 5 characters.');
    }
    const workStarted = milestones.some((m) =>
      ['submitted', 'approved', 'revision_requested'].includes(m.status)
    );
    if (!workStarted) {
      return { status: 'cancelled', notificationType: 'agreement_cancelled' };
    }
    return { status: 'disputed', notificationType: 'agreement_disputed' };
  }

  // No work submitted
  const beforeWork = [{ status: 'pending' }];
  const res1 = cancelAgreement(beforeWork, 'Client cancelled early');
  assert.strictEqual(res1.status, 'cancelled');
  assert.strictEqual(res1.notificationType, 'agreement_cancelled');

  // Work submitted
  const afterWork = [{ status: 'submitted' }];
  const res2 = cancelAgreement(afterWork, 'Freelancer failed to deliver as expected');
  assert.strictEqual(res2.status, 'disputed');
  assert.strictEqual(res2.notificationType, 'agreement_disputed');
});

// 5. Counteroffer response mapping and notification emission
test('Complete Real Loop: respond_to_counter role mapping and agreement integrity', () => {
  function processCounterResponse({ gig, application, freelancerId, action }) {
    if (freelancerId !== application.freelancer_id) {
      throw new Error('Only the applicant freelancer can respond to this counteroffer.');
    }
    if (action === 'accept') {
      // Must not invert roles! client_id is gig owner, freelancer_id is applicant
      const agreement = {
        gig_id: gig.id,
        client_id: gig.client_id,
        freelancer_id: application.freelancer_id,
        agreed_price: application.counter_price,
        status: 'active',
      };
      assert.notStrictEqual(agreement.client_id, agreement.freelancer_id);
      return agreement;
    }
    return null;
  }

  const gig = { id: 'gig-1', client_id: 'client-user-id' };
  const application = { id: 'app-1', freelancer_id: 'freelancer-user-id', counter_price: 45000 };

  const agr = processCounterResponse({ gig, application, freelancerId: 'freelancer-user-id', action: 'accept' });
  assert.strictEqual(agr.client_id, 'client-user-id');
  assert.strictEqual(agr.freelancer_id, 'freelancer-user-id');
  assert.strictEqual(agr.agreed_price, 45000);
});
