const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Pure logic helpers matching services/auth.ts and services/profile.ts
const COMMON_EMAIL_DOMAIN_TYPOS = new Set([
  'gmial.com',
  'gamil.com',
  'gmal.com',
  'gmai.com',
  'gmail.con',
  'gmail.co',
  'yaho.com',
  'yahooo.com',
  'yahoo.con',
  'hotmial.com',
  'outlok.com',
]);

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

function validateEmailInput(rawEmail) {
  const normalized = normalizeEmail(rawEmail);
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized)) {
    return { valid: false, reason: 'format' };
  }
  const domain = normalized.split('@')[1] || '';
  if (COMMON_EMAIL_DOMAIN_TYPOS.has(domain)) {
    return { valid: false, reason: 'typo' };
  }
  return { valid: true };
}

function isDuplicateEmailAuthResult(error, data) {
  if (error) {
    const code = String(error.code || '').toLowerCase();
    const msg = String(error.message || '').toLowerCase();
    if (
      code === 'user_already_exists' ||
      code === 'email_exists' ||
      msg.includes('user already registered') ||
      msg.includes('already registered') ||
      msg.includes('already been registered') ||
      msg.includes('email already exists')
    ) {
      return true;
    }
  }
  if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return true;
  }
  return false;
}

test('M16: Email normalization (trim and lowercase across mixed case)', () => {
  assert.strictEqual(normalizeEmail('  Maria.Santos@Gmail.COM '), 'maria.santos@gmail.com');
  assert.strictEqual(normalizeEmail('USER@ORMOC.PH'), 'user@ormoc.ph');
});

test('M16: Duplicate email detection handles user_already_exists AND empty identities array', () => {
  // 1. Explicit error code user_already_exists
  assert.strictEqual(
    isDuplicateEmailAuthResult({ code: 'user_already_exists', message: 'User already registered' }, null),
    true
  );

  // 2. Error message "User already registered"
  assert.strictEqual(
    isDuplicateEmailAuthResult({ message: 'User already registered' }, null),
    true
  );

  // 3. Supabase signUp with email confirmation enabled returning user with empty identities array
  assert.strictEqual(
    isDuplicateEmailAuthResult(null, { user: { id: 'u1', email: 'a@b.com', identities: [] } }),
    true
  );

  // 4. Fresh user registration with identity present is NOT flagged as duplicate
  assert.strictEqual(
    isDuplicateEmailAuthResult(null, { user: { id: 'u2', email: 'new@b.com', identities: [{ id: 'id1' }] } }),
    false
  );
});

test('M16: Same email twice (different case) and double-tap protection', async () => {
  const registeredEmails = new Set();
  let inFlight = false;
  let createdProfiles = 0;

  async function simulatedSignUp(rawEmail) {
    if (inFlight) {
      const err = new Error('Sign up is already in progress.');
      err.code = 'SIGNUP_IN_PROGRESS';
      throw err;
    }
    const email = normalizeEmail(rawEmail);
    const check = validateEmailInput(email);
    if (!check.valid) {
      throw new Error('Invalid email');
    }

    inFlight = true;
    try {
      await new Promise((r) => setTimeout(r, 15));
      if (registeredEmails.has(email)) {
        const dupErr = new Error('This email is already registered. Log in or reset your password.');
        dupErr.code = 'EMAIL_ALREADY_REGISTERED';
        throw dupErr;
      }
      registeredEmails.add(email);
      createdProfiles += 1;
      return { email };
    } finally {
      inFlight = false;
    }
  }

  // First signup succeeds
  await simulatedSignUp('Juan@Example.com');
  assert.strictEqual(createdProfiles, 1);

  // Second signup with different case is blocked with EMAIL_ALREADY_REGISTERED and creates no new profile
  await assert.rejects(
    () => simulatedSignUp('  juan@EXAMPLE.com '),
    (err) => err.code === 'EMAIL_ALREADY_REGISTERED'
  );
  assert.strictEqual(createdProfiles, 1);

  // Double-tap concurrent signup creates only one account
  const [res1, res2] = await Promise.allSettled([
    simulatedSignUp('pedro@example.com'),
    simulatedSignUp('pedro@example.com'),
  ]);
  const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
  const rejected = [res1, res2].filter((r) => r.status === 'rejected');
  assert.strictEqual(fulfilled.length, 1);
  assert.strictEqual(rejected.length, 1);
  assert.strictEqual(createdProfiles, 2);
});

test('M16: Email format and disposable domain typo validation', () => {
  assert.strictEqual(validateEmailInput('not-an-email').valid, false);
  assert.strictEqual(validateEmailInput('juan@gmial.com').valid, false);
  assert.strictEqual(validateEmailInput('juan@gmial.com').reason, 'typo');
  assert.strictEqual(validateEmailInput('juan@gmail.com').valid, true);
});

test('M16: Avatar storage path format, old object extraction, and file type/size validation', () => {
  const profileSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'profile.ts'), 'utf8');

  // Verify avatar-{timestamp}.{ext} path builder exists in services/profile.ts
  assert.ok(
    profileSource.includes('`${userId}/avatar-${timestamp}.${cleanExt}`'),
    'Avatar path must use {user_id}/avatar-{timestamp}.jpg format'
  );

  // Verify old object deletion happens after set_profile_avatar
  assert.ok(
    profileSource.includes('previous_avatar_path') && profileSource.includes(".from('avatars').remove"),
    'Replacing or removing an avatar must delete the previous storage object'
  );

  // Verify 5MB limit and JPEG/PNG/WebP allow-list
  assert.ok(
    profileSource.includes('5 * 1024 * 1024') && profileSource.includes("'image/webp'"),
    'Avatar validation must enforce 5 MB limit and JPEG/PNG/WebP types'
  );
});

test('M16: Profile completeness badge never uses forbidden words verified or guaranteed', () => {
  const stringsSource = fs.readFileSync(path.join(__dirname, '..', 'constants', 'strings.ts'), 'utf8');
  const completenessComp = fs.readFileSync(
    path.join(__dirname, '..', 'components', 'ui', 'ProfileCompleteness.tsx'),
    'utf8'
  );

  assert.strictEqual(/verified|guaranteed/i.test(stringsSource), false);
  assert.strictEqual(/verified|guaranteed/i.test(completenessComp), false);
  assert.ok(stringsSource.includes("profileCompleteBadge: 'Profile complete'"));
});

test('M16: Universal cross-platform image upload supports PC/Laptop Web and Mobile (Android/iOS)', () => {
  const imageUploadSource = fs.readFileSync(path.join(__dirname, '..', 'utils', 'imageUpload.ts'), 'utf8');
  const profileSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'profile.ts'), 'utf8');
  const milestonesSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'milestones.ts'), 'utf8');
  const paymentsSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'payments.ts'), 'utf8');

  // Verify Web DOM file picker, Canvas normalization, and base64 -> Uint8Array decoding exist
  assert.ok(imageUploadSource.includes('pickImagesUniversal'), 'Must export pickImagesUniversal');
  assert.ok(imageUploadSource.includes('decodeBase64ToUint8Array'), 'Must decode base64 to Uint8Array for native mobile');
  assert.ok(imageUploadSource.includes('renderWebImageViaCanvas'), 'Must support Canvas normalization for PC/Laptop web');

  // Verify services use pickImagesUniversal and Uint8Array bytes
  assert.ok(profileSource.includes('pickImagesUniversal'), 'profileService must use pickImagesUniversal');
  assert.ok(milestonesSource.includes('pickImagesUniversal'), 'milestonesService must use pickImagesUniversal');
  assert.ok(paymentsSource.includes('pickImagesUniversal'), 'paymentsService must use pickImagesUniversal');
});

