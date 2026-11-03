const test = require('node:test');
const assert = require('node:assert');

// 1. 14-day window review eligibility
test('Review submission 14-day window check', () => {
  function isReviewWindowOpen(completedAtDate, now = new Date()) {
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    const diff = now.getTime() - completedAtDate.getTime();
    return diff <= fourteenDaysMs && diff >= 0;
  }

  const now = new Date('2026-10-15T12:00:00Z');

  // Completed 5 days ago -> allowed
  const day5Ago = new Date('2026-10-10T12:00:00Z');
  assert.strictEqual(isReviewWindowOpen(day5Ago, now), true);

  // Completed exactly 14 days ago -> allowed
  const day14Ago = new Date('2026-10-01T12:00:00Z');
  assert.strictEqual(isReviewWindowOpen(day14Ago, now), true);

  // Completed 15 days ago -> expired
  const day15Ago = new Date('2026-09-30T12:00:00Z');
  assert.strictEqual(isReviewWindowOpen(day15Ago, now), false);
});

// 2. Rating recalculation formula in same transaction
test('Incremental rating average recalculation', () => {
  function calculateNewRatingAvg(currentAvg, currentCount, newRating) {
    const totalScore = currentAvg * currentCount + newRating;
    const newCount = currentCount + 1;
    const newAvg = Math.round((totalScore / newCount) * 100) / 100;
    return {
      newAvg,
      newCount,
    };
  }

  // First review of 5 stars
  const r1 = calculateNewRatingAvg(0, 0, 5);
  assert.strictEqual(r1.newAvg, 5.0);
  assert.strictEqual(r1.newCount, 1);

  // Second review of 4 stars -> (5 + 4) / 2 = 4.5
  const r2 = calculateNewRatingAvg(5.0, 1, 4);
  assert.strictEqual(r2.newAvg, 4.5);
  assert.strictEqual(r2.newCount, 2);

  // Third review of 3 stars -> (4.5 * 2 + 3) / 3 = 4.0
  const r3 = calculateNewRatingAvg(4.5, 2, 3);
  assert.strictEqual(r3.newAvg, 4.0);
  assert.strictEqual(r3.newCount, 3);
});

// 3. One review per party per agreement validation
test('One review per party constraint simulation', () => {
  const existingReviews = [
    { agreementId: 'agr_1', reviewerId: 'usr_client' },
  ];

  function canSubmitReview(agreementId, reviewerId, agreementStatus) {
    if (agreementStatus !== 'completed') {
      throw new Error('Agreement must be completed.');
    }
    const alreadyReviewed = existingReviews.some(
      (r) => r.agreementId === agreementId && r.reviewerId === reviewerId
    );
    if (alreadyReviewed) {
      throw new Error('Already reviewed this agreement.');
    }
    return true;
  }

  // Freelancer can review
  assert.strictEqual(canSubmitReview('agr_1', 'usr_freelancer', 'completed'), true);

  // Client cannot review twice
  assert.throws(
    () => canSubmitReview('agr_1', 'usr_client', 'completed'),
    /Already reviewed/
  );

  // Cannot review uncompleted agreement
  assert.throws(
    () => canSubmitReview('agr_2', 'usr_client', 'active'),
    /Agreement must be completed/
  );
});

// 4. Rating range constraint (1 to 5)
test('Review rating range boundary validation', () => {
  function validateRating(rating) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new Error('Rating must be an integer between 1 and 5.');
    }
    return true;
  }

  assert.strictEqual(validateRating(1), true);
  assert.strictEqual(validateRating(5), true);
  assert.strictEqual(validateRating(3), true);

  assert.throws(() => validateRating(0), /between 1 and 5/);
  assert.throws(() => validateRating(6), /between 1 and 5/);
  assert.throws(() => validateRating(4.5), /between 1 and 5/);
});
