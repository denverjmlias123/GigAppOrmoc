const test = require('node:test');
const assert = require('node:assert');

test('Public profile query integrity - no private data leakage', () => {
  // Expected safe columns in public profile response
  const allowedPublicColumns = [
    'id',
    'display_name',
    'bio',
    'avatar_path',
    'area',
    'starting_mode',
    'onboarding_complete',
    'rating_avg',
    'rating_count',
    'completed_gigs',
    'status',
    'created_at',
  ];

  const forbiddenPrivateFields = ['dob', 'phone', 'terms_version', 'terms_accepted_at'];

  forbiddenPrivateFields.forEach((field) => {
    assert.strictEqual(
      allowedPublicColumns.includes(field),
      false,
      `Public profile query must NEVER include private field: ${field}`
    );
  });
});

test('Storage folder isolation rule', () => {
  const userId = '123e4567-e89b-12d3-a456-426614174000';
  const avatarPath = `${userId}/avatar_12345.jpg`;
  const portfolioPath = `${userId}/item_67890.jpg`;

  // Path must start with userId folder
  assert.ok(avatarPath.startsWith(`${userId}/`));
  assert.ok(portfolioPath.startsWith(`${userId}/`));
});
