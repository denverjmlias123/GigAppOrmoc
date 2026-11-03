type PasswordCheck =
  | 'length'
  | 'lowercase'
  | 'uppercase'
  | 'number'
  | 'special'
  | 'noSpaces'
  | 'notEmail'
  | 'notName';
export function getPasswordChecks(
  password: string,
  email?: string,
  displayName?: string
): Record<PasswordCheck, boolean>;
export function validatePassword(
  password: string,
  email?: string,
  displayName?: string
): { valid: boolean; failed: PasswordCheck[] };
export function validatePasswordConfirmation(password: string, confirmation: string): boolean;
