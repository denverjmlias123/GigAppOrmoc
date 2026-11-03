type LoginFailurePresentation = {
  kind: 'account_not_found' | 'credentials' | 'locked';
  message: string;
  secondsLeft?: number;
  attemptsLeft?: number | null;
};

export function resolveLoginFailure(
  error: unknown,
  showAccountNotFound: boolean,
  messages: {
    accountNotFound: string;
    wrongCredentials: string;
    locked: (secondsLeft: number) => string;
  }
): LoginFailurePresentation | null;

export function formatLockoutCountdown(seconds: number): string;
