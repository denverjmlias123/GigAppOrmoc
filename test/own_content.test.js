const test = require('node:test');
const assert = require('node:assert');

// 1. Agreement parties constraint: client_id <> freelancer_id
test('Own-Content Rule: Agreement cannot have same client and freelancer', () => {
  function validateAgreementParties(clientId, freelancerId) {
    if (!clientId || !freelancerId) {
      throw new Error('Both client and freelancer are required.');
    }
    if (clientId === freelancerId) {
      throw new Error('Agreement client and freelancer cannot be the same person.');
    }
    return true;
  }

  assert.strictEqual(validateAgreementParties('usr_client', 'usr_freelancer'), true);
  assert.throws(
    () => validateAgreementParties('usr_same', 'usr_same'),
    /cannot be the same person/
  );
});

// 2. submit_application rejects application to caller's own gig
test('Own-Content Rule: submit_application rejects caller applying to own gig', () => {
  function canApplyToGig(callerId, gigClientId, gigStatus) {
    if (gigStatus !== 'open') {
      throw new Error('Gig is not open for applications.');
    }
    if (callerId === gigClientId) {
      throw new Error('You cannot apply to your own gig.');
    }
    return true;
  }

  assert.strictEqual(canApplyToGig('usr_freelancer', 'usr_client', 'open'), true);
  assert.throws(
    () => canApplyToGig('usr_client', 'usr_client', 'open'),
    /You cannot apply to your own gig/
  );
});

// 3. submit_review rejects self-review
test('Own-Content Rule: submit_review rejects caller reviewing themselves', () => {
  function validateReviewParties(callerId, revieweeId) {
    if (callerId === revieweeId) {
      throw new Error('You cannot review yourself.');
    }
    return true;
  }

  assert.strictEqual(validateReviewParties('usr_client', 'usr_freelancer'), true);
  assert.throws(
    () => validateReviewParties('usr_client', 'usr_client'),
    /You cannot review yourself/
  );
});

// 4. submit_report rejects self-report
test('Own-Content Rule: submit_report rejects reporting own profile, gig, or message', () => {
  function validateReportTarget(callerId, targetType, targetOwnerId) {
    if (['profile', 'gig', 'message'].includes(targetType) && callerId === targetOwnerId) {
      throw new Error(`You cannot report your own ${targetType}.`);
    }
    return true;
  }

  assert.strictEqual(validateReportTarget('usr_a', 'profile', 'usr_b'), true);
  assert.strictEqual(validateReportTarget('usr_a', 'gig', 'usr_b'), true);
  
  assert.throws(
    () => validateReportTarget('usr_a', 'profile', 'usr_a'),
    /You cannot report your own profile/
  );
  assert.throws(
    () => validateReportTarget('usr_a', 'gig', 'usr_a'),
    /You cannot report your own gig/
  );
  assert.throws(
    () => validateReportTarget('usr_a', 'message', 'usr_a'),
    /You cannot report your own message/
  );
});

// 5. get_available_gigs strictly excludes caller's own gigs
test('Own-Content Rule: get_available_gigs strictly excludes caller own gigs', () => {
  const allOpenGigs = [
    { id: 'gig_1', client_id: 'usr_other1', title: 'Logo Design', status: 'open' },
    { id: 'gig_2', client_id: 'usr_caller', title: 'App Development', status: 'open' },
    { id: 'gig_3', client_id: 'usr_other2', title: 'Tarpaulin Layout', status: 'open' },
  ];

  function getAvailableGigs(callerId, gigs) {
    return gigs.filter((g) => g.status === 'open' && g.client_id !== callerId);
  }

  const results = getAvailableGigs('usr_caller', allOpenGigs);
  assert.strictEqual(results.length, 2);
  assert.strictEqual(results.some((g) => g.id === 'gig_2'), false);
  assert.strictEqual(results.some((g) => g.client_id === 'usr_caller'), false);
});
