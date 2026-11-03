function resolveLoginFailure(error, showAccountNotFound, messages) {
  if (error && (error.code === 'ACCOUNT_LOCKED' || error.code === 'LOGIN_LOCKED')) {
    const seconds = Number(error.seconds_left ?? error.secondsLeft ?? error.retryAfterSeconds);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    const secondsLeft = Math.ceil(seconds);
    const attempts = Number(error.attempts_left ?? error.attemptsLeft);
    const attemptsLeft = Number.isFinite(attempts) && attempts >= 0 ? Math.floor(attempts) : null;
    return {
      kind: 'locked',
      secondsLeft,
      attemptsLeft,
      message: messages.locked(secondsLeft),
    };
  }

  if (error && error.code === 'ACCOUNT_NOT_FOUND') {
    if (showAccountNotFound) {
      return { kind: 'account_not_found', message: messages.accountNotFound };
    }
    return { kind: 'credentials', message: messages.wrongCredentials };
  }

  return null;
}

function formatLockoutCountdown(seconds) {
  const safeSeconds = Math.max(0, Math.ceil(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

module.exports = { resolveLoginFailure, formatLockoutCountdown };
