function parseIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day, 12);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  return parsed;
}

function formatLocalIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getAdultBirthDateCutoff(today = new Date()) {
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  cutoff.setFullYear(cutoff.getFullYear() - 18);
  return cutoff;
}

function isAtLeast18(value, today = new Date()) {
  const birthDate = parseIsoDate(value);
  return Boolean(birthDate && birthDate <= getAdultBirthDateCutoff(today));
}

module.exports = { parseIsoDate, formatLocalIsoDate, getAdultBirthDateCutoff, isAtLeast18 };
