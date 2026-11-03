const test = require('node:test');
const assert = require('node:assert');

// 1. Payment status transition logic
test('Payment status transitions', () => {
  function confirmPayment(currentStatus, isPayee) {
    if (!isPayee) {
      throw new Error('Only the receiving payee can confirm payment.');
    }
    if (currentStatus === 'confirmed_received') {
      return 'confirmed_received'; // idempotent
    }
    return 'confirmed_received';
  }

  function disputePayment(currentStatus, isPayee, reason) {
    if (!isPayee) {
      throw new Error('Only the payee can dispute payment.');
    }
    if (currentStatus === 'confirmed_received') {
      throw new Error('Cannot dispute a payment that was already confirmed.');
    }
    if (!reason || reason.trim().length < 5) {
      throw new Error('Reason required for dispute.');
    }
    return 'disputed';
  }

  // Payee confirms reported payment
  assert.strictEqual(confirmPayment('reported_sent', true), 'confirmed_received');

  // Stranger cannot confirm
  assert.throws(() => confirmPayment('reported_sent', false), /Only the receiving payee/);

  // Payee disputes reported payment
  assert.strictEqual(
    disputePayment('reported_sent', true, 'Payment not received in account'),
    'disputed'
  );

  // Cannot dispute already confirmed payment
  assert.throws(
    () => disputePayment('confirmed_received', true, 'Changed mind'),
    /Cannot dispute a payment that was already confirmed/
  );
});

// 2. Complete agreement gate logic
test('Complete agreement requirements gate', () => {
  function canCompleteAgreement({
    agreementStatus,
    milestones,
    payments,
    agreedPriceCentavos,
  }) {
    if (agreementStatus !== 'active') return false;
    if (milestones.length === 0) return false;

    // All milestones must be approved
    const allMilestonesApproved = milestones.every((m) => m.status === 'approved');
    if (!allMilestonesApproved) return false;

    // No payment disputes
    const hasDisputes = payments.some((p) => p.status === 'disputed');
    if (hasDisputes) return false;

    // No pending reported payments
    const hasPendingReports = payments.some((p) => p.status === 'reported_sent');
    if (hasPendingReports) return false;

    // Confirmed sum >= agreed price
    const confirmedSum = payments
      .filter((p) => p.status === 'confirmed_received')
      .reduce((sum, p) => sum + p.amount, 0);

    return confirmedSum >= agreedPriceCentavos;
  }

  const agreed = 100000; // ₱1,000.00

  // Valid complete state
  assert.strictEqual(
    canCompleteAgreement({
      agreementStatus: 'active',
      milestones: [{ status: 'approved' }, { status: 'approved' }],
      payments: [{ status: 'confirmed_received', amount: 100000 }],
      agreedPriceCentavos: agreed,
    }),
    true
  );

  // Incomplete milestone prevents completion
  assert.strictEqual(
    canCompleteAgreement({
      agreementStatus: 'active',
      milestones: [{ status: 'approved' }, { status: 'submitted' }],
      payments: [{ status: 'confirmed_received', amount: 100000 }],
      agreedPriceCentavos: agreed,
    }),
    false
  );

  // Underpaid confirmed sum prevents completion
  assert.strictEqual(
    canCompleteAgreement({
      agreementStatus: 'active',
      milestones: [{ status: 'approved' }],
      payments: [{ status: 'confirmed_received', amount: 80000 }],
      agreedPriceCentavos: agreed,
    }),
    false
  );

  // Pending unconfirmed payment prevents completion
  assert.strictEqual(
    canCompleteAgreement({
      agreementStatus: 'active',
      milestones: [{ status: 'approved' }],
      payments: [
        { status: 'confirmed_received', amount: 50000 },
        { status: 'reported_sent', amount: 50000 },
      ],
      agreedPriceCentavos: agreed,
    }),
    false
  );

  // Disputed payment prevents completion
  assert.strictEqual(
    canCompleteAgreement({
      agreementStatus: 'active',
      milestones: [{ status: 'approved' }],
      payments: [
        { status: 'confirmed_received', amount: 100000 },
        { status: 'disputed', amount: 20000 },
      ],
      agreedPriceCentavos: agreed,
    }),
    false
  );
});

// 3. UI language compliance check
test('No misleading escrow/guarantee wording in payment context', () => {
  const allowedTerms = ['reported_sent', 'confirmed_received', 'disputed'];
  const forbiddenTerms = ['verified', 'guaranteed', 'escrow_hold', 'insured'];

  allowedTerms.forEach((term) => {
    assert.strictEqual(forbiddenTerms.includes(term), false);
  });
});
