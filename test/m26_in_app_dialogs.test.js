const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

describe('In-App Dialogs & Transaction Loop Verification', () => {
  it('1. ConfirmDialog component exists with required exports and provider is mounted in app/_layout.tsx', () => {
    const dialogPath = path.join(ROOT, 'components', 'ui', 'ConfirmDialog.tsx');
    assert.ok(fs.existsSync(dialogPath), 'ConfirmDialog.tsx must exist');
    const dialogSrc = fs.readFileSync(dialogPath, 'utf8');

    assert.ok(dialogSrc.includes('export function showConfirmDialog'), 'Must export showConfirmDialog');
    assert.ok(dialogSrc.includes('export const ConfirmDialog'), 'Must export ConfirmDialog');
    assert.ok(dialogSrc.includes('export const ConfirmDialogProvider'), 'Must export ConfirmDialogProvider');

    const layoutPath = path.join(ROOT, 'app', '_layout.tsx');
    const layoutSrc = fs.readFileSync(layoutPath, 'utf8');
    assert.ok(layoutSrc.includes('ConfirmDialogProvider'), 'app/_layout.tsx must mount ConfirmDialogProvider');
  });

  it('2. lib/dialog.ts delegates confirmDialog to in-app ConfirmDialog', () => {
    const libDialogPath = path.join(ROOT, 'lib', 'dialog.ts');
    assert.ok(fs.existsSync(libDialogPath), 'lib/dialog.ts must exist');
    const src = fs.readFileSync(libDialogPath, 'utf8');

    assert.ok(src.includes('showConfirmDialog'), 'confirmDialog must delegate to showConfirmDialog');
    assert.ok(!src.includes('window.confirm'), 'lib/dialog.ts must not call window.confirm');
    assert.ok(!src.includes('window.alert'), 'lib/dialog.ts must not call window.alert');
    assert.ok(!src.includes('Alert.alert'), 'lib/dialog.ts must not call Alert.alert');
  });

  it('3. Repo audit: Zero Alert.alert, window.alert, or window.confirm in app/ screens', () => {
    const appDir = path.join(ROOT, 'app');
    const violations = [];

    function scan(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          scan(full);
        } else if (ent.isFile() && (ent.name.endsWith('.tsx') || ent.name.endsWith('.ts'))) {
          const content = fs.readFileSync(full, 'utf8');
          const lines = content.split('\n');
          lines.forEach((line, idx) => {
            // Check for actual calls, ignoring comment lines
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
            if (
              trimmed.includes('Alert.alert(') ||
              trimmed.includes('window.alert(') ||
              trimmed.includes('window.confirm(') ||
              trimmed.includes('window.prompt(')
            ) {
              violations.push(`${path.relative(ROOT, full)}:${idx + 1} -> ${trimmed}`);
            }
          });
        }
      }
    }

    scan(appDir);
    assert.deepEqual(violations, [], `Found dialog API calls in screens: \n${violations.join('\n')}`);
  });

  it('4. Milestone Review screen (review.tsx) uses confirmDialog and showToast without blocking on Alert.alert', () => {
    const reviewPath = path.join(
      ROOT,
      'app',
      'agreements',
      '[id]',
      'milestones',
      '[milestoneId]',
      'review.tsx'
    );
    const src = fs.readFileSync(reviewPath, 'utf8');

    assert.ok(src.includes('confirmDialog'), 'review.tsx must use confirmDialog');
    assert.ok(src.includes('milestonesService.reviewMilestone(milestoneId, \'approve\')'), 'Must call reviewMilestone with approve');
    assert.ok(src.includes('showToast(strings.toasts.milestoneApproved)'), 'Must show toast on approval');
    assert.ok(src.includes('navigateAfterSuccess()'), 'Must navigate back after approval');
    assert.ok(!src.includes('Alert.alert'), 'review.tsx must not use Alert.alert');
  });

  it('5. Agreement detail screen (agreements/[id].tsx) uses confirmDialog for complete and cancel', () => {
    const agreementPath = path.join(ROOT, 'app', 'agreements', '[id].tsx');
    const src = fs.readFileSync(agreementPath, 'utf8');

    assert.ok(src.includes('confirmDialog'), 'agreements/[id].tsx must use confirmDialog');
    assert.ok(src.includes('paymentsService.completeAgreement'), 'Must call completeAgreement');
    assert.ok(src.includes('showToast(strings.toasts.agreementCompleted)'), 'Must show toast on agreement completion');
    assert.ok(!src.includes('Alert.alert'), 'agreements/[id].tsx must not use Alert.alert');
  });

  it('6. No browser or system dialog APIs are called in application code', () => {
    const roots = ['app', 'components', 'services', 'lib', 'utils'];
    const forbidden = /(?:window\s*\.\s*(?:alert|confirm|prompt)|Alert\s*\.\s*alert)\s*\(|\b(?:alert|confirm|prompt)\s*\(/;
    const violations = [];
    function scan(dir) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) scan(full);
        else if (ent.isFile() && /\.(?:tsx?|jsx?)$/.test(ent.name)) {
          const source = fs.readFileSync(full, 'utf8');
          source.split('\n').forEach((line, idx) => {
            const code = line.replace(/\/\/.*$/, '');
            if (forbidden.test(code)) violations.push(`${path.relative(ROOT, full)}:${idx + 1}`);
            forbidden.lastIndex = 0;
          });
        }
      }
    }
    for (const root of roots) scan(path.join(ROOT, root));
    assert.deepEqual(violations, []);
  });

  it('7. Every user-initiated logout asks in-app confirmation before calling signOut', () => {
    const files = [
      ['app', '(tabs)', 'profile.tsx'],
      ['app', '(onboarding)', 'step1-mode.tsx'],
      ['app', '(onboarding)', 'step2-skills.tsx'],
      ['app', '(onboarding)', 'step3-profile.tsx'],
    ];
    for (const parts of files) {
      const source = fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
      assert.ok(source.includes('confirmDialog('), `${parts.join('/')} must confirm logout`);
      assert.ok(source.includes('runConfirmedLogout('), `${parts.join('/')} must use the shared confirmation gate`);
      assert.ok(source.includes('strings.auth.logoutConfirmTitle'));
      assert.ok(source.includes('strings.auth.logoutConfirmYes'));
      assert.ok(source.indexOf('runConfirmedLogout(') < source.indexOf('if (!confirmed) return;'));
      assert.ok(source.includes("router.replace('/(auth)/login')"), `${parts.join('/')} must return to Login after logout`);
    }
  });

  it('11. Canceling logout performs neither sign-out nor follow-up work', async () => {
    const { runConfirmedLogout } = require(path.join(ROOT, 'utils', 'confirmedLogout.js'));
    let signOutCalls = 0;
    let confirmedCalls = 0;
    let navigationCalls = 0;
    const confirmed = await runConfirmedLogout({
      requestConfirmation: async () => false,
      signOut: async () => { signOutCalls += 1; },
      onConfirmed: () => { confirmedCalls += 1; },
    });
    if (confirmed) navigationCalls += 1;

    assert.equal(confirmed, false);
    assert.equal(signOutCalls, 0);
    assert.equal(confirmedCalls, 0);
    assert.equal(navigationCalls, 0);
  });

  it('12. Confirming logout signs out once before navigation is allowed', async () => {
    const { runConfirmedLogout } = require(path.join(ROOT, 'utils', 'confirmedLogout.js'));
    const events = [];
    const confirmed = await runConfirmedLogout({
      requestConfirmation: async () => true,
      onConfirmed: () => { events.push('confirmed'); },
      signOut: async () => { events.push('signOut'); },
    });
    if (confirmed) events.push('navigate');

    assert.equal(confirmed, true);
    assert.deepEqual(events, ['confirmed', 'signOut', 'navigate']);
  });

  it('8. Signup never puts the password in route params', () => {
    const path1 = path.join(ROOT, 'app', '(auth)', 'signup-step1.tsx');
    const path2 = path.join(ROOT, 'app', '(auth)', 'signup-step2.tsx');
    const source1 = fs.readFileSync(path1, 'utf8');
    const source2 = fs.readFileSync(path2, 'utf8');
    assert.ok(source1.includes('setSignupDraft({ displayName: displayName.trim(), email: normalizedEmail, password })'));
    assert.ok(source1.includes("verify-otp"));
    assert.doesNotMatch(source1, /password\s*:/);
    assert.doesNotMatch(source2, /useLocalSearchParams/);
    assert.ok(source2.includes('getSignupDraft()'));
  });

  it('9. Supabase local Auth config sets the server password policy', () => {
    const config = fs.readFileSync(path.join(ROOT, 'supabase', 'config.toml'), 'utf8');
    assert.match(config, /minimum_password_length\s*=\s*8/);
    assert.match(config, /password_requirements\s*=\s*"lower_upper_letters_digits_symbols"/);
    assert.match(config, /secure_password_change\s*=\s*true/);
    assert.match(config, /\[auth\.email\][\s\S]*?enable_confirmations\s*=\s*false/);
  });

  it('10. Login validation and resend feedback use centralized strings', () => {
    const source = fs.readFileSync(path.join(ROOT, 'app', '(auth)', 'login.tsx'), 'utf8');
    assert.ok(source.includes('strings.auth.loginEmailRequired'));
    assert.ok(source.includes('strings.auth.loginPasswordRequired'));
    assert.ok(source.includes('strings.auth.loginResendEmailRequired'));
    assert.ok(source.includes('strings.auth.confirmationEmailSent(normalizedEmail)'));
  });

  it('Login screen keeps user-facing copy in the centralized strings file', () => {
    const source = fs.readFileSync(path.join(ROOT, 'app', '(auth)', 'login.tsx'), 'utf8');
    for (const key of [
      'loginTitle', 'loginReturnSubtitle', 'loginBackLabel', 'loginEmailLabel',
      'loginPasswordLabel', 'forgotPassword', 'loginOffline',
      'loginResendConfirmation', 'loginCreateAccount',
    ]) {
      assert.ok(source.includes(`strings.auth.${key}`), `missing centralized string ${key}`);
    }
    assert.doesNotMatch(source, />(?:Welcome back|Forgot password\?|Resend confirmation email|Create an account)</);
  });

  it('Unknown-account disclosure is opt-in and the login screen offers sign-up only for that response', () => {
    const config = fs.readFileSync(path.join(ROOT, 'constants', 'featureFlags.ts'), 'utf8');
    const login = fs.readFileSync(path.join(ROOT, 'app', '(auth)', 'login.tsx'), 'utf8');
    assert.match(config, /SHOW_ACCOUNT_NOT_FOUND\s*=\s*false/);
    assert.ok(login.includes('resolveLoginFailure(err, SHOW_ACCOUNT_NOT_FOUND'));
    assert.ok(login.includes("pathname: '/(auth)/signup-step1'"));
    assert.ok(login.includes('accountNotFound &&'));
    assert.ok(login.includes('strings.auth.loginAccountNotFound'));
  });

  it('Change password handles Supabase secure-password reauthentication without disabling the guard', () => {
    const screen = fs.readFileSync(path.join(ROOT, 'app', 'settings', 'password.tsx'), 'utf8');
    const auth = fs.readFileSync(path.join(ROOT, 'services', 'auth.ts'), 'utf8');
    const config = fs.readFileSync(path.join(ROOT, 'supabase', 'config.toml'), 'utf8');
    assert.ok(screen.includes('authService.requestPasswordReauthentication()'));
    assert.ok(screen.includes('nonce: needsReauthentication ? reauthCode.trim() : undefined'));
    assert.ok(auth.includes('supabase.auth.reauthenticate()'));
    assert.ok(auth.includes('...(nonce ? { nonce } : {})'));
    assert.match(config, /secure_password_change\s*=\s*true/);
  });

  it('13. Forgot password uses shared controls, centralized copy, and an enumeration-safe success state', () => {
    const source = fs.readFileSync(path.join(ROOT, 'app', '(auth)', 'forgot-password.tsx'), 'utf8');
    assert.ok(source.includes("import { Button } from '../../components/ui/Button'"));
    assert.ok(source.includes("import { TextInput } from '../../components/ui/TextInput'"));
    assert.ok(source.includes('strings.auth.passwordResetDescription'));
    assert.ok(source.includes('strings.auth.passwordResetSent'));
    assert.ok(source.includes('await authService.resetPassword(normalizedEmail)'));
    assert.doesNotMatch(source, /#[0-9A-Fa-f]{3,8}\b/);
    assert.doesNotMatch(source, /TouchableOpacity|ActivityIndicator|TextInput from 'react-native'/);
  });

  it('14. Signup uses the shared password controls and a real cross-platform date picker', () => {
    const step1 = fs.readFileSync(path.join(ROOT, 'app', '(auth)', 'signup-step1.tsx'), 'utf8');
    const step2 = fs.readFileSync(path.join(ROOT, 'app', '(auth)', 'signup-step2.tsx'), 'utf8');
    const dateField = fs.readFileSync(path.join(ROOT, 'components', 'ui', 'DateOfBirthField.tsx'), 'utf8');
    assert.ok(step1.includes('<PasswordPolicyChecklist'));
    assert.ok(step1.includes('strings.auth.signupConfirmPasswordLabel'));
    assert.ok(step1.includes("import { TextInput } from '../../components/ui/TextInput'"));
    assert.ok(step2.includes('<DateOfBirthField'));
    assert.ok(step2.includes('isAtLeast18(dateOfBirth)'));
    assert.ok(dateField.includes("type: 'date'"), 'Web must use a native date input');
    assert.ok(dateField.includes('<DateTimePicker'), 'iOS and Android must use the platform date picker');
    assert.ok(dateField.includes('maximumDate={maximumDate}'), 'Picker must block dates under age 18');
  });
});
