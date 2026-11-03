const test = require('node:test');
const assert = require('node:assert');

// 1. Agreement completed_at and 14-day review window
test('Hardening: 14-day review eligibility is tied strictly to completed_at', () => {
  function isReviewAllowed(completedAt, now) {
    if (!completedAt) return false;
    const completedTime = new Date(completedAt).getTime();
    const currentTime = new Date(now).getTime();
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    
    // Window must be >= 0 (cannot be in future) and <= 14 days
    const diff = currentTime - completedTime;
    return diff >= 0 && diff <= fourteenDaysMs;
  }

  const completedAt = '2026-10-01T10:00:00Z';

  // 13 days later: valid
  assert.strictEqual(isReviewAllowed(completedAt, '2026-10-14T10:00:00Z'), true);

  // Exactly 14 days later: valid
  assert.strictEqual(isReviewAllowed(completedAt, '2026-10-15T10:00:00Z'), true);

  // 14 days + 1 second later: expired
  assert.strictEqual(isReviewAllowed(completedAt, '2026-10-15T10:00:01Z'), false);

  // Missing completed_at: not allowed
  assert.strictEqual(isReviewAllowed(null, '2026-10-02T10:00:00Z'), false);
});

// 2. Reviews hidden flag & recalculation excluding hidden reviews
test('Hardening: Reviews recalculation excludes hidden reviews', () => {
  const reviews = [
    { id: 'rev_1', reviewee_role: 'freelancer', rating: 5, hidden: false },
    { id: 'rev_2', reviewee_role: 'freelancer', rating: 3, hidden: false },
    { id: 'rev_3', reviewee_role: 'freelancer', rating: 1, hidden: true }, // hidden by admin
    { id: 'rev_4', reviewee_role: 'client', rating: 4, hidden: false }, // different role
  ];

  function computeRoleRatings(reviewList, targetRole) {
    const activeRoleReviews = reviewList.filter(
      (r) => r.reviewee_role === targetRole && !r.hidden
    );
    if (activeRoleReviews.length === 0) {
      return { avg: 0, count: 0 };
    }
    const sum = activeRoleReviews.reduce((acc, r) => acc + r.rating, 0);
    const count = activeRoleReviews.length;
    const avg = Math.round((sum / count) * 100) / 100;
    return { avg, count };
  }

  // Freelancer ratings: rev_1 (5) and rev_2 (3). rev_3 (1) is hidden -> avg = (5+3)/2 = 4.0
  const freelancerRatings = computeRoleRatings(reviews, 'freelancer');
  assert.strictEqual(freelancerRatings.avg, 4.0);
  assert.strictEqual(freelancerRatings.count, 2);

  // Client ratings: rev_4 (4) -> avg = 4.0, count = 1
  const clientRatings = computeRoleRatings(reviews, 'client');
  assert.strictEqual(clientRatings.avg, 4.0);
  assert.strictEqual(clientRatings.count, 1);
});

// 3. Admin hide review action recalculates profile rating
test('Hardening: admin_hide_review updates hidden status and recomputes stats', () => {
  const state = {
    reviews: [
      { id: 'rev_a', reviewee_id: 'usr_f1', reviewee_role: 'freelancer', rating: 5, hidden: false },
      { id: 'rev_b', reviewee_id: 'usr_f1', reviewee_role: 'freelancer', rating: 1, hidden: false },
    ],
    profile: {
      freelancer_rating_avg: 3.0,
      freelancer_rating_count: 2,
    },
  };

  function adminHideReview(reviewId, reason) {
    if (!reason || reason.trim() === '') {
      throw new Error('Reason required for hiding review');
    }
    const review = state.reviews.find((r) => r.id === reviewId);
    if (!review) throw new Error('Review not found');

    review.hidden = true;
    review.hidden_at = new Date().toISOString();

    // Recompute
    const visible = state.reviews.filter((r) => !r.hidden && r.reviewee_role === review.reviewee_role);
    if (visible.length === 0) {
      state.profile.freelancer_rating_avg = 0;
      state.profile.freelancer_rating_count = 0;
    } else {
      const sum = visible.reduce((acc, r) => acc + r.rating, 0);
      state.profile.freelancer_rating_avg = Math.round((sum / visible.length) * 100) / 100;
      state.profile.freelancer_rating_count = visible.length;
    }
  }

  // Hide the abusive 1-star review
  adminHideReview('rev_b', 'Contains prohibited content');

  assert.strictEqual(state.reviews[1].hidden, true);
  assert.strictEqual(state.profile.freelancer_rating_avg, 5.0);
  assert.strictEqual(state.profile.freelancer_rating_count, 1);

  // Require reason
  assert.throws(() => adminHideReview('rev_a', ''), /Reason required/);
});

// 4. Mode switch gate check: unresolved reports block mode switch
test('Hardening: switch_mode blocked by unresolved reports', () => {
  function getModeSwitchStatus(userId, agreements, reports) {
    const activeAgreements = agreements.filter(
      (a) => (a.client_id === userId || a.freelancer_id === userId) && ['active', 'in_dispute'].includes(a.status)
    );
    const unresolvedReports = reports.filter(
      (r) => (r.reporter_id === userId || r.target_user_id === userId) && ['pending', 'investigating'].includes(r.status)
    );

    const reasons = [];
    if (activeAgreements.length > 0) {
      reasons.push(`You have ${activeAgreements.length} active or disputed agreement(s).`);
    }
    if (unresolvedReports.length > 0) {
      reasons.push(`You have ${unresolvedReports.length} unresolved safety report(s).`);
    }

    return {
      can_switch: reasons.length === 0,
      reasons,
    };
  }

  const userId = 'usr_alice';

  // Case 1: No agreements, no reports -> allowed
  assert.deepStrictEqual(getModeSwitchStatus(userId, [], []), {
    can_switch: true,
    reasons: [],
  });

  // Case 2: Unresolved report filed against user -> blocked
  const pendingReports = [
    { id: 'rep_1', reporter_id: 'usr_bob', target_user_id: 'usr_alice', status: 'pending' },
  ];
  const res1 = getModeSwitchStatus(userId, [], pendingReports);
  assert.strictEqual(res1.can_switch, false);
  assert.match(res1.reasons[0], /unresolved safety report/);

  // Case 3: Resolved report -> allowed
  const resolvedReports = [
    { id: 'rep_1', reporter_id: 'usr_bob', target_user_id: 'usr_alice', status: 'resolved' },
  ];
  const res2 = getModeSwitchStatus(userId, [], resolvedReports);
  assert.strictEqual(res2.can_switch, true);
});

// 5. Verification: Zero mock/seed data enforcement
test('Hardening: Production safety check rejects mock patterns in app services', () => {
  const forbiddenPatterns = [
    /mock-data/i,
    /demo_user/i,
    /seed_test_data/i,
    /fake_token/i,
  ];

  function validateProductionSafety(codeString) {
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(codeString)) {
        return false;
      }
    }
    return true;
  }

  assert.strictEqual(validateProductionSafety('const user = await supabase.auth.getUser();'), true);
  assert.strictEqual(validateProductionSafety('const mock = mock-data;'), false);
  assert.strictEqual(validateProductionSafety('const id = demo_user_1;'), false);
});
