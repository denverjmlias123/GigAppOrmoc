const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  getPasswordChecks,
  validatePassword,
  validatePasswordConfirmation,
} = require('../utils/passwordPolicy');

test('password policy accepts a valid password', () => {
  assert.deepEqual(validatePassword('Strong123!', 'user@example.com', 'Maria Santos'), { valid: true, failed: [] });
});

test('password policy enforces the 8-character minimum and 72-character maximum', () => {
  assert.equal(getPasswordChecks('Aa1!xyz').length, false);
  assert.equal(getPasswordChecks(`Aa1!${'x'.repeat(68)}`).length, true);
  assert.equal(getPasswordChecks(`Aa1!${'x'.repeat(69)}`).length, false);
});

test('password policy requires lowercase, uppercase, digit, and special character', () => {
  assert.equal(getPasswordChecks('STRONG123!').lowercase, false);
  assert.equal(getPasswordChecks('strong123!').uppercase, false);
  assert.equal(getPasswordChecks('StrongPass!').number, false);
  assert.equal(getPasswordChecks('Strong1234').special, false);
});

test('password policy rejects whitespace', () => {
  assert.equal(getPasswordChecks('Strong 123!').noSpaces, false);
  assert.equal(getPasswordChecks('Strong\t123!').noSpaces, false);
});

test('password policy rejects a case-insensitive match for email or display name', () => {
  assert.equal(validatePassword('USER@EXAMPLE.COM', 'user@example.com').valid, false);
  assert.equal(validatePassword('maria santos', '', 'Maria Santos').valid, false);
});

test('password confirmation requires an exact match', () => {
  assert.equal(validatePasswordConfirmation('Strong123!', 'Strong123!'), true);
  assert.equal(validatePasswordConfirmation('Strong123!', 'strong123!'), false);
});
