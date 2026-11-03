type ConfirmedLogoutOptions = {
  requestConfirmation: () => boolean | Promise<boolean>;
  signOut: () => unknown | Promise<unknown>;
  onConfirmed?: () => void;
};

export function runConfirmedLogout(options: ConfirmedLogoutOptions): Promise<boolean>;
