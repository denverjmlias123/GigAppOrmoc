const test = require('node:test');
const assert = require('node:assert/strict');
const { formatLockoutCountdown, resolveLoginFailure } = require('../utils/loginFailure.js');

const messages = {
  accountNotFound: 'No account found. Create one?',
  wrongCredentials: 'Incorrect email or password.',
  locked: (seconds) => `Locked for ${seconds}.`,
};

test('server lockout response includes remaining time and attempt count', () => {
  assert.deepEqual(
    resolveLoginFailure({ code: 'ACCOUNT_LOCKED', seconds_left: 61, attempts_left: 2 }, false, messages),
    { kind: 'locked', secondsLeft: 61, attemptsLeft: 2, message: 'Locked for 61.' }
  );
});

test('invalid lockout duration is not presented as a real lockout', () => {
  assert.equal(resolveLoginFailure({ code: 'ACCOUNT_LOCKED' }, false, messages), null);
});

test('lockout countdown is formatted with minutes and seconds', () => {
  assert.equal(formatLockoutCountdown(61), '01:01');
  assert.equal(formatLockoutCountdown(0), '00:00');
});

test('unknown email stays generic by default', () => {
  assert.deepEqual(
    resolveLoginFailure({ code: 'ACCOUNT_NOT_FOUND' }, false, messages),
    { kind: 'credentials', message: messages.wrongCredentials }
  );
});

test('unknown email can show sign-up prompt when the explicit feature flag is enabled', () => {
  assert.deepEqual(
    resolveLoginFailure({ code: 'ACCOUNT_NOT_FOUND' }, true, messages),
    { kind: 'account_not_found', message: messages.accountNotFound }
  );
});

test('unrelated login errors keep their existing error mapping', () => {
  assert.equal(resolveLoginFailure({ code: 'INVALID_CREDENTIALS' }, true, messages), null);
});
