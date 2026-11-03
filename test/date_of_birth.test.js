const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  formatLocalIsoDate,
  getAdultBirthDateCutoff,
  isAtLeast18,
  parseIsoDate,
} = require('../utils/dateOfBirth.js');

describe('Date of birth UX validation', () => {
  const today = new Date(2026, 9, 13, 12);

  it('rejects impossible calendar dates and accepts valid leap dates', () => {
    assert.equal(parseIsoDate('2025-02-29'), null);
    assert.equal(formatLocalIsoDate(parseIsoDate('2008-02-29')), '2008-02-29');
  });

  it('uses the exact eighteenth birthday as the minimum age boundary', () => {
    assert.equal(isAtLeast18('2008-10-13', today), true);
    assert.equal(isAtLeast18('2008-10-14', today), false);
    assert.equal(isAtLeast18('', today), false);
  });

  it('limits the picker to the latest date that is already 18', () => {
    assert.equal(formatLocalIsoDate(getAdultBirthDateCutoff(today)), '2008-10-13');
  });
});
