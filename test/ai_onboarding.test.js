const test = require('node:test');
const assert = require('node:assert');

// 1. Edge function task allow-list & bounded input validation
test('AI Onboarding: Edge function task allow-list enforcement', () => {
  const ALLOWED_TASKS = ['suggest_skills', 'draft_bio', 'polish_gig_description'];

  function validateTask(task) {
    if (!task || !ALLOWED_TASKS.includes(task)) {
      throw new Error(`Invalid task. Allowed tasks: ${ALLOWED_TASKS.join(', ')}`);
    }
    return true;
  }

  assert.strictEqual(validateTask('suggest_skills'), true);
  assert.strictEqual(validateTask('draft_bio'), true);
  assert.strictEqual(validateTask('polish_gig_description'), true);

  assert.throws(() => validateTask('arbitrary_prompt'), /Invalid task/);
  assert.throws(() => validateTask(''), /Invalid task/);
  assert.throws(() => validateTask(null), /Invalid task/);
});

// 2. Input length bound (max 600 chars per field)
test('AI Onboarding: Field length boundary check (max 600 chars)', () => {
  function validateFieldLength(field, max = 600) {
    if (typeof field === 'string' && field.length > max) {
      throw new Error(`Field exceeds maximum length of ${max} characters.`);
    }
    return true;
  }

  assert.strictEqual(validateFieldLength('Valid description under 600 chars'), true);
  assert.strictEqual(validateFieldLength('a'.repeat(600)), true);
  assert.throws(() => validateFieldLength('a'.repeat(601)), /exceeds maximum length/);
});

// 3. Sanitizer for URLs and phone numbers (No personal contact data sent/returned)
test('AI Onboarding: Sanitizer strips URLs and phone numbers', () => {
  function sanitizeText(input) {
    let cleaned = input.replace(/https?:\/\/[^\s]+/gi, '[link removed]');
    cleaned = cleaned.replace(/\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[contact removed]');
    cleaned = cleaned.replace(/\b\d{7,15}\b/g, '[number removed]');
    return cleaned.trim();
  }

  const raw1 = 'Check my portfolio at https://example.com/mywork and call 09171234567';
  const sanitized1 = sanitizeText(raw1);
  assert.strictEqual(sanitized1.includes('https://'), false);
  assert.strictEqual(sanitized1.includes('09171234567'), false);
  assert.ok(sanitized1.includes('[link removed]'));
  assert.ok(sanitized1.includes('[contact removed]') || sanitized1.includes('[number removed]'));
});

// 4. Custom skills bounds & case-insensitive deduplication
test('AI Onboarding: Custom skills limits and deduplication', () => {
  function processCustomSkills(existingSkills, newCustomNames) {
    if (newCustomNames.length > 10) {
      throw new Error('You may add at most 10 custom skills per request.');
    }

    const updated = [...existingSkills];

    for (const name of newCustomNames) {
      const trimmed = name.trim();
      if (trimmed.length < 2 || trimmed.length > 40) {
        throw new Error('Custom skill name must be between 2 and 40 characters.');
      }
      if (updated.length >= 15) {
        throw new Error('Maximum limit of 15 skills per profile reached.');
      }
      const exists = updated.some((s) => s.toLowerCase() === trimmed.toLowerCase());
      if (!exists) {
        updated.push(trimmed);
      }
    }
    return updated;
  }

  // Deduplication
  const initial = ['Plumbing', 'Electrical'];
  const res = processCustomSkills(initial, ['plumbing', 'Aircon Repair']);
  assert.deepStrictEqual(res, ['Plumbing', 'Electrical', 'Aircon Repair']);

  // Max 10 per call
  assert.throws(
    () => processCustomSkills([], Array(11).fill('Skill')),
    /at most 10 custom skills/
  );

  // Short / Long bounds
  assert.throws(() => processCustomSkills([], ['A']), /between 2 and 40 characters/);
  assert.throws(() => processCustomSkills([], ['x'.repeat(41)]), /between 2 and 40 characters/);
});

// 5. complete_onboarding prerequisite gate
test('AI Onboarding: complete_onboarding requires active_mode set', () => {
  function completeOnboarding(profile) {
    if (!profile.active_mode || !['find_work', 'hire'].includes(profile.active_mode)) {
      throw new Error('You must select an initial role mode before completing onboarding.');
    }
    return { ...profile, onboarding_complete: true };
  }

  assert.throws(() => completeOnboarding({ active_mode: null }), /must select an initial role mode/);
  assert.throws(() => completeOnboarding({ active_mode: 'explore_both' }), /must select an initial role mode/);

  const completed = completeOnboarding({ active_mode: 'find_work', onboarding_complete: false });
  assert.strictEqual(completed.onboarding_complete, true);
});
