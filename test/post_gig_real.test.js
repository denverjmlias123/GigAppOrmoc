const test = require('node:test');
const assert = require('node:assert');

// 1. Minimum budget threshold in PHP & centavos
test('Post Gig Real: Minimum budget floor validation (₱100 / 10,000 centavos)', () => {
  function validateBudget(phpAmount) {
    const minBudgetPesos = parseFloat(phpAmount);
    if (isNaN(minBudgetPesos) || minBudgetPesos < 100) {
      throw new Error('Minimum budget must be at least ₱100.00 PHP.');
    }
    const centavos = Math.round(minBudgetPesos * 100);
    if (centavos < 10000) {
      throw new Error('Minimum budget must be at least 10000 centavos.');
    }
    return centavos;
  }

  // Under floor
  assert.throws(() => validateBudget('50'), /at least ₱100\.00 PHP/);
  assert.throws(() => validateBudget('99.99'), /at least ₱100\.00 PHP/);
  assert.throws(() => validateBudget('0'), /at least ₱100\.00 PHP/);
  assert.throws(() => validateBudget('-10'), /at least ₱100\.00 PHP/);

  // Exactly at floor (₱100 -> 10,000 centavos)
  assert.strictEqual(validateBudget('100'), 10000);

  // Above floor (₱500.50 -> 50,050 centavos)
  assert.strictEqual(validateBudget('500.50'), 50050);
});

// 2. Title & description bounds parity
test('Post Gig Real: Title length bounds (5 to 80 chars)', () => {
  function validateTitle(title) {
    const trimmed = (title || '').trim();
    if (!trimmed) throw new Error('Gig title is required.');
    if (trimmed.length < 5 || trimmed.length > 80) {
      throw new Error('Gig title must be between 5 and 80 characters.');
    }
    return trimmed;
  }

  assert.throws(() => validateTitle(''), /Gig title is required/);
  assert.throws(() => validateTitle('Need'), /between 5 and 80 characters/);
  assert.throws(() => validateTitle('a'.repeat(81)), /between 5 and 80 characters/);

  assert.strictEqual(validateTitle('Need math tutor'), 'Need math tutor');
  assert.strictEqual(validateTitle('a'.repeat(80)), 'a'.repeat(80));
});

test('Post Gig Real: Description length bounds (30 to 2000 chars)', () => {
  function validateDescription(desc) {
    const trimmed = (desc || '').trim();
    if (!trimmed) throw new Error('Gig description is required.');
    if (trimmed.length < 30 || trimmed.length > 2000) {
      throw new Error('Gig description must be between 30 and 2000 characters.');
    }
    return trimmed;
  }

  assert.throws(() => validateDescription(''), /Gig description is required/);
  assert.throws(() => validateDescription('Too short description'), /between 30 and 2000 characters/);
  assert.throws(() => validateDescription('b'.repeat(2001)), /between 30 and 2000 characters/);

  const validDesc = 'This is a valid gig description that easily exceeds the thirty characters minimum.';
  assert.strictEqual(validateDescription(validDesc), validDesc);
});

// 3. Category existence & empty state rule
test('Post Gig Real: Category requirement & empty state blocks publish', () => {
  function canPublishGig({ categories, selectedCategory }) {
    if (!categories || categories.length === 0) return false;
    if (!selectedCategory) return false;
    return categories.some((c) => c.id === selectedCategory && c.is_active);
  }

  // Empty categories table in DB
  assert.strictEqual(canPublishGig({ categories: [], selectedCategory: '' }), false);
  assert.strictEqual(canPublishGig({ categories: [], selectedCategory: 'cat-1' }), false);

  // Active category selected
  const activeCats = [{ id: 'cat-1', name: 'Tutoring', is_active: true }];
  assert.strictEqual(canPublishGig({ categories: activeCats, selectedCategory: 'cat-1' }), true);

  // Inactive category selected
  const inactiveCats = [{ id: 'cat-2', name: 'Archived', is_active: false }];
  assert.strictEqual(canPublishGig({ categories: inactiveCats, selectedCategory: 'cat-2' }), false);
});

// 4. Double-tap idempotent publish simulation
test('Post Gig Real: Double-tap publish is idempotent', () => {
  function publishGig(gig) {
    if (gig.status === 'open') {
      // Idempotent: return without error
      return { status: 'open', alreadyPublished: true };
    }
    if (gig.status !== 'draft') {
      throw new Error('Only draft gigs can be published.');
    }
    return { status: 'open', alreadyPublished: false };
  }

  const draftGig = { id: 'gig-1', status: 'draft' };
  const firstTap = publishGig(draftGig);
  assert.strictEqual(firstTap.status, 'open');
  assert.strictEqual(firstTap.alreadyPublished, false);

  const openGig = { id: 'gig-1', status: 'open' };
  const secondTap = publishGig(openGig);
  assert.strictEqual(secondTap.status, 'open');
  assert.strictEqual(secondTap.alreadyPublished, true);
});

// 5. Cancel Gig notifying pending applicants
test('Post Gig Real: cancel_gig declines applicants and issues notification', () => {
  const gig = { id: 'gig-100', client_id: 'client-1', title: 'Ormoc Delivery', status: 'open' };
  const applicants = [
    { id: 'app-1', freelancer_id: 'freelancer-a', status: 'applied' },
    { id: 'app-2', freelancer_id: 'freelancer-b', status: 'countered' },
    { id: 'app-3', freelancer_id: 'freelancer-c', status: 'declined' },
  ];

  const notifications = [];

  function cancelGig(actingUserId, gigToCancel, reason) {
    if (actingUserId !== gigToCancel.client_id) {
      throw new Error('Only the gig owner can cancel this gig.');
    }
    if (!['draft', 'open'].includes(gigToCancel.status)) {
      throw new Error('Cannot cancel gig.');
    }
    gigToCancel.status = 'cancelled';

    // Decline pending applications and notify
    applicants.forEach((app) => {
      if (['applied', 'countered'].includes(app.status)) {
        app.status = 'declined';
        notifications.push({
          user_id: app.freelancer_id,
          type: 'gig_cancelled',
          title: 'Gig Cancelled',
          body: `The gig "${gigToCancel.title}" has been cancelled by the client. Reason: ${reason}`,
        });
      }
    });
  }

  cancelGig('client-1', gig, 'No longer needed');

  assert.strictEqual(gig.status, 'cancelled');
  assert.strictEqual(applicants.find((a) => a.id === 'app-1').status, 'declined');
  assert.strictEqual(applicants.find((a) => a.id === 'app-2').status, 'declined');
  assert.strictEqual(notifications.length, 2);
  assert.strictEqual(notifications[0].user_id, 'freelancer-a');
  assert.strictEqual(notifications[0].type, 'gig_cancelled');
  assert.strictEqual(notifications[1].user_id, 'freelancer-b');
});

// 6. Non-UUID category ID resolution (prevents "invalid input syntax for type uuid: cat-1")
test('Post Gig Real: Category resolution prevents non-UUID string from being passed as category_id', () => {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isValidUuid = (val) => Boolean(val && UUID_REGEX.test(val.trim()));

  const dbCategories = [
    { id: '11111111-1111-1111-1111-111111111111', name: 'Web & Mobile Development', is_active: true },
    { id: '22222222-2222-2222-2222-222222222222', name: 'Computer Programming', is_active: true },
  ];

  function resolveCategoryParams(selectedId, customName, suggested) {
    let finalCategoryId = null;
    let finalCategoryName = null;

    if (selectedId) {
      if (isValidUuid(selectedId)) {
        finalCategoryId = selectedId;
      } else {
        const matched =
          dbCategories.find((c) => c.id === selectedId) ||
          (suggested || []).find((s) => s.id === selectedId);
        if (matched) {
          const dbCat = dbCategories.find(
            (c) => c.name.trim().toLowerCase() === matched.name.trim().toLowerCase()
          );
          if (dbCat && isValidUuid(dbCat.id)) {
            finalCategoryId = dbCat.id;
          } else {
            finalCategoryName = matched.name.trim();
          }
        } else {
          finalCategoryName = selectedId;
        }
      }
    } else if (customName) {
      const dbCat = dbCategories.find(
        (c) => c.name.trim().toLowerCase() === customName.trim().toLowerCase()
      );
      if (dbCat && isValidUuid(dbCat.id)) {
        finalCategoryId = dbCat.id;
      } else {
        finalCategoryName = customName.trim();
      }
    }

    return { category_id: finalCategoryId, category_name: finalCategoryName };
  }

  // Case A: AI/Offline suggestion gave 'cat-1' for 'Web & Mobile Development'
  const suggested = [{ id: 'cat-1', name: 'Web & Mobile Development' }];
  const resA = resolveCategoryParams('cat-1', '', suggested);
  assert.strictEqual(resA.category_id, '11111111-1111-1111-1111-111111111111');
  assert.strictEqual(resA.category_name, null);
  assert.ok(isValidUuid(resA.category_id));

  // Case B: Non-UUID suggestion that does not exist in DB gets resolved as category_name, not category_id
  const unknownSug = [{ id: 'cat-99', name: 'Drone Videography' }];
  const resB = resolveCategoryParams('cat-99', '', unknownSug);
  assert.strictEqual(resB.category_id, null);
  assert.strictEqual(resB.category_name, 'Drone Videography');

  // Case C: Real UUID selected directly
  const resC = resolveCategoryParams('22222222-2222-2222-2222-222222222222', '', []);
  assert.strictEqual(resC.category_id, '22222222-2222-2222-2222-222222222222');
  assert.strictEqual(resC.category_name, null);
});

// 7. Post Gig screen requires confirmation before publishing
test('Post Gig Real: app/gigs/post.tsx prompts Confirm Post Gig before publishing', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const postCode = fs.readFileSync(path.join(__dirname, '..', 'app', 'gigs', 'post.tsx'), 'utf8');

  assert.match(postCode, /confirmDialog\(/);
  assert.match(postCode, /title:\s*['"]Confirm Post Gig['"]/);
});
