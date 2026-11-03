async function runConfirmedLogout({ requestConfirmation, signOut, onConfirmed }) {
  const confirmed = await requestConfirmation();
  if (!confirmed) return false;

  onConfirmed?.();
  await signOut();
  return true;
}

module.exports = { runConfirmedLogout };
