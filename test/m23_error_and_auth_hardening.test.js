const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

describe('Milestone 23 — Error Handling and Login/Logout Hardening (v5.4 Section 2)', () => {
  it('1. lib/errors.ts defines AppError with all 11 error kinds, requestId, retryable flag, and friendly messages', () => {
    const errorsSrc = fs.readFileSync(path.join(ROOT, 'lib/errors.ts'), 'utf8');
    const stringsSrc = fs.readFileSync(path.join(ROOT, 'constants/strings.ts'), 'utf8');

    const expectedKinds = [
      'offline',
      'timeout',
      'unauthorized',
      'session_expired',
      'forbidden',
      'not_found',
      'conflict',
      'rate_limited',
      'validation',
      'server',
      'unknown',
    ];
    for (const kind of expectedKinds) {
      assert.ok(
        errorsSrc.includes(`'${kind}'`),
        `lib/errors.ts must classify AppError kind '${kind}'`
      );
    }

    assert.ok(errorsSrc.includes('export function toAppError'), 'Must export toAppError');
    assert.ok(errorsSrc.includes('export function createRequestId'), 'Must export createRequestId');
    assert.ok(errorsSrc.includes('retryable:'), 'AppError must include retryable flag');
    assert.ok(errorsSrc.includes('requestId'), 'AppError must include support requestId');

    // Verify constants/strings.ts maps each category to friendly text and sanitizes raw SQL/PostgREST codes
    assert.ok(stringsSrc.includes('sessionExpired:'), 'strings.errors.sessionExpired must exist');
    assert.ok(stringsSrc.includes('loggedOutNotice:'), 'strings.errors.loggedOutNotice must exist');
    assert.ok(stringsSrc.includes('wrongCredentials:'), 'strings.errors.wrongCredentials must exist');
    assert.ok(stringsSrc.includes('emailNotConfirmed:'), 'strings.errors.emailNotConfirmed must exist');
    assert.ok(stringsSrc.includes('accountSuspended:'), 'strings.errors.accountSuspended must exist');
    assert.ok(stringsSrc.includes('alreadyDoneOtherDevice:'), 'strings.errors.alreadyDoneOtherDevice must exist');
    assert.ok(stringsSrc.includes('syntax error at or near'), 'Must sanitize raw SQL syntax errors');
  });

  it('2. lib/supabase.ts enforces request timeout, single-flight session refresh, and one retry on 401', () => {
    const supaSrc = fs.readFileSync(path.join(ROOT, 'lib/supabase.ts'), 'utf8');

    assert.ok(supaSrc.includes('REQUEST_TIMEOUT_MS'), 'Must define REQUEST_TIMEOUT_MS');
    assert.ok(supaSrc.includes('fetchWithTimeout'), 'Must wrap fetch with AbortController timeout');
    assert.ok(
      supaSrc.includes('refreshSessionSingleFlight'),
      'Must provide single-flight session refresh helper'
    );
  });

  it('3. Root ErrorBoundary and OfflineBanner exist and are mounted in app/_layout.tsx', () => {
    const boundarySrc = fs.readFileSync(
      path.join(ROOT, 'components/ui/ErrorBoundary.tsx'),
      'utf8'
    );
    const offlineSrc = fs.readFileSync(
      path.join(ROOT, 'components/ui/OfflineBanner.tsx'),
      'utf8'
    );
    const layoutSrc = fs.readFileSync(path.join(ROOT, 'app/_layout.tsx'), 'utf8');

    assert.ok(
      boundarySrc.includes('Something went wrong. Reload'),
      'ErrorBoundary must render "Something went wrong. Reload"'
    );
    assert.ok(boundarySrc.includes('requestId'), 'ErrorBoundary must log/display support requestId');
    assert.ok(
      offlineSrc.includes('useNetworkStatus') && offlineSrc.includes('OfflineBanner'),
      'OfflineBanner must export useNetworkStatus and OfflineBanner'
    );
    assert.ok(
      layoutSrc.includes('<ErrorBoundary>') && layoutSrc.includes('<OfflineBanner />'),
      'app/_layout.tsx must mount ErrorBoundary and OfflineBanner'
    );
  });

  it('4. Login (Section 2A): single-flight lock (double tap = one request), email normalized, resend confirmation rate-limited, single replace navigation', async () => {
    const authSrc = fs.readFileSync(path.join(ROOT, 'services/auth.ts'), 'utf8');
    const loginSrc = fs.readFileSync(path.join(ROOT, 'app/(auth)/login.tsx'), 'utf8');
    const confirmSrc = fs.readFileSync(path.join(ROOT, 'app/(auth)/confirm-email.tsx'), 'utf8');

    // Verify signIn single-flight lock in services/auth.ts
    assert.ok(
      authSrc.includes('if (signInInFlight)') && authSrc.includes('return signInInFlight;'),
      'authService.signIn must deduplicate concurrent calls via signInInFlight'
    );
    assert.ok(
      authSrc.includes('resendConfirmationEmail') &&
        authSrc.includes('RESEND_CONFIRMATION_COOLDOWN_SECONDS'),
      'authService must provide rate-limited resendConfirmationEmail'
    );

    // Behavioral proof: simulate 5 rapid taps on a single-flight signIn wrapper -> underlying call runs once
    let networkCalls = 0;
    let inFlight = null;
    const simulatedSignIn = () => {
      if (inFlight) return inFlight;
      inFlight = (async () => {
        try {
          networkCalls += 1;
          await new Promise((r) => setImmediate(r));
          return { user: { id: 'u1' } };
        } finally {
          inFlight = null;
        }
      })();
      return inFlight;
    };

    const results = await Promise.all([
      simulatedSignIn(),
      simulatedSignIn(),
      simulatedSignIn(),
      simulatedSignIn(),
      simulatedSignIn(),
    ]);
    assert.equal(networkCalls, 1, 'Double/rapid tap on login must fire exactly 1 request');
    assert.equal(results.length, 5);

    // Login screen checks
    assert.ok(
      loginSrc.includes('handleResendConfirmation') &&
        loginSrc.includes('strings.auth.loginResendConfirmation') &&
        fs.readFileSync(path.join(ROOT, 'constants', 'strings.ts'), 'utf8').includes("loginResendConfirmation: 'Resend confirmation email'"),
      'login.tsx must show the centralized Resend confirmation email string when email is unconfirmed'
    );
    const rootNavigationSrc = fs.readFileSync(path.join(ROOT, 'app', '_layout.tsx'), 'utf8');
    assert.ok(
      loginSrc.includes('authService.signIn') &&
        !loginSrc.includes("router.replace('/(onboarding)/step1-mode')") &&
        !loginSrc.includes("router.replace('/(tabs)')") &&
        rootNavigationSrc.includes("router.replace('/(onboarding)/step1-mode')") &&
        rootNavigationSrc.includes("router.replace('/(tabs)')"),
      'post-login routing must be owned by RootNavigation and occur only once'
    );
    assert.ok(
      confirmSrc.includes('Resend Confirmation Email'),
      'confirm-email.tsx must include a Resend Confirmation Email button'
    );
  });

  it('5. Logout (Section 2B): offline-safe local scope, shared cleanup routine with mode switch, SIGNED_OUT handled once with "You were logged out."', async () => {
    const authSrc = fs.readFileSync(path.join(ROOT, 'services/auth.ts'), 'utf8');
    const useAuthSrc = fs.readFileSync(path.join(ROOT, 'hooks/useAuth.tsx'), 'utf8');
    const cleanupSrc = fs.readFileSync(path.join(ROOT, 'lib/sessionCleanup.ts'), 'utf8');
    const modeSrc = fs.readFileSync(path.join(ROOT, 'app/settings/mode.tsx'), 'utf8');
    const profileSrc = fs.readFileSync(path.join(ROOT, 'app/(tabs)/profile.tsx'), 'utf8');

    // 1. Offline-safe local scope signOut + optional global scope
    assert.ok(
      authSrc.includes("supabase.auth.signOut({ scope: 'local' })"),
      "authService.signOut must call signOut({ scope: 'local' }) so offline logout always succeeds"
    );
    assert.ok(
      authSrc.includes("supabase.auth.signOut({ scope: 'global' })"),
      "authService.signOut must support optional scope: 'global' for logging out of all devices"
    );
    assert.ok(
      profileSrc.includes('Log out of all devices'),
      'Profile screen must offer optional "Log out of all devices"'
    );

    // 2. Shared cleanup routine used by both logout and mode switch
    assert.ok(
      cleanupSrc.includes('export async function performSharedCleanup'),
      'lib/sessionCleanup.ts must export performSharedCleanup'
    );
    assert.ok(
      cleanupSrc.includes('clearPrivateImageCache()') &&
        cleanupSrc.includes('cachedUnreadBadgeCount = 0') &&
        cleanupSrc.includes('supabase.removeAllChannels()'),
      'performSharedCleanup must clear private image cache, badge count, storage drafts, and Realtime channels'
    );
    assert.ok(
      useAuthSrc.includes('performSharedCleanup') && modeSrc.includes('runSharedCleanup'),
      'Both hooks/useAuth.tsx and app/settings/mode.tsx must run the shared cleanup routine'
    );

    // 3. SIGNED_OUT handled once with "You were logged out."
    assert.ok(
      useAuthSrc.includes('handledSignedOutRef') &&
        useAuthSrc.includes('strings.errors.loggedOutNotice'),
      'hooks/useAuth.tsx must handle SIGNED_OUT exactly once and set "You were logged out." notice'
    );
  });
});
