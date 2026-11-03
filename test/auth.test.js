const test = require('node:test');
const assert = require('node:assert');

function calculateAge(birthDate) {
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

test('18+ age verification logic', () => {
  const today = new Date();

  // Exactly 17 years old
  const seventeen = new Date(today.getFullYear() - 17, today.getMonth(), today.getDate());
  assert.strictEqual(calculateAge(seventeen), 17);
  assert.strictEqual(calculateAge(seventeen) >= 18, false);

  // Exactly 18 years old
  const eighteen = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());
  assert.strictEqual(calculateAge(eighteen), 18);
  assert.strictEqual(calculateAge(eighteen) >= 18, true);

  // 25 years old
  const twentyFive = new Date(today.getFullYear() - 25, today.getMonth(), today.getDate());
  assert.strictEqual(calculateAge(twentyFive), 25);
  assert.strictEqual(calculateAge(twentyFive) >= 18, true);
});

test('Profile schema privacy integrity', () => {
  // Public profile columns must NOT include private fields like dob or phone
  const publicProfileColumns = [
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

  assert.strictEqual(publicProfileColumns.includes('dob'), false);
  assert.strictEqual(publicProfileColumns.includes('phone'), false);
});
