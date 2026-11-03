const PASSWORD_MAX_LENGTH = 72;

function getPasswordChecks(password, email = '', displayName = '') {
  const value = String(password || '');
  const normalized = value.toLocaleLowerCase();
  const normalizedEmail = String(email || '').trim().toLocaleLowerCase();
  const normalizedName = String(displayName || '').trim().toLocaleLowerCase();

  return {
    length: value.length >= 8 && value.length <= PASSWORD_MAX_LENGTH,
    lowercase: /[a-z]/.test(value),
    uppercase: /[A-Z]/.test(value),
    number: /[0-9]/.test(value),
    special: /[^A-Za-z0-9\s]/.test(value),
    noSpaces: !/\s/.test(value),
    notEmail: !normalizedEmail || normalized !== normalizedEmail,
    notName: !normalizedName || normalized !== normalizedName,
  };
}

function validatePassword(password, email = '', displayName = '') {
  const checks = getPasswordChecks(password, email, displayName);
  const failed = Object.entries(checks).filter(([, passes]) => !passes).map(([key]) => key);
  return { valid: failed.length === 0, failed };
}

function validatePasswordConfirmation(password, confirmation) {
  return String(password || '') === String(confirmation || '');
}

module.exports = {
  getPasswordChecks,
  validatePassword,
  validatePasswordConfirmation,
};
