const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('Auth, Session & Routing Flow Hardening Suite', async (t) => {
  const supaSrc = read('lib/supabase.ts');
  const authSrc = read('services/auth.ts');
  const sessionsSrc = read('services/sessions.ts');
  const layoutSrc = read('app/_layout.tsx');

  await t.test('2.1 Dead session-expiry callback is implemented and wired', () => {
    assert.match(
      supaSrc,
      /let sessionExpiredHandler/,
      'Must declare sessionExpiredHandler storage'
    );
    assert.match(
      supaSrc,
      /registerSessionExpiredHandler\(cb:/,
      'registerSessionExpiredHandler must accept and store callback'
    );
    assert.match(
      supaSrc,
      /export async function notifySessionExpired\(\)/,
      'Must export notifySessionExpired to dispatch session expiration events'
    );
    assert.match(
      supaSrc,
      /await sessionExpiredHandler\(\)/,
      'notifySessionExpired must invoke the registered handler'
    );
  });

  await t.test('2.2 Protected RPCs refresh session on 401 instead of falling back to anonClient', () => {
    assert.match(
      supaSrc,
      /refreshSessionSingleFlight\(\)/,
      'callRpc must invoke refreshSessionSingleFlight upon 401 on protected RPCs'
    );
    assert.match(
      supaSrc,
      /const refreshed = await refreshSessionSingleFlight\(\);[\s\S]*?if \(refreshed\) \{[\s\S]*?retryResult = await supabase\.rpc/,
      'callRpc must retry with authenticated supabase client after successful refresh'
    );
    assert.match(
      supaSrc,
      /notifySessionExpired\(\)/,
      'callRpc must notify session expired when refresh fails or 401 persists'
    );
    assert.doesNotMatch(
      supaSrc,
      /const fallback = await anonClient\.rpc\(fnName, params\);/,
      'Protected RPCs must never fall back to anonClient on 401'
    );
  });

  await t.test('2.3 Login guard fails closed on check errors', () => {
    assert.match(
      authSrc,
      /LOGIN_GUARD_UNAVAILABLE/,
      'callLoginGuard must fail closed with LOGIN_GUARD_UNAVAILABLE when check cannot verify security status'
    );
    assert.match(
      authSrc,
      /if \(action === 'check'\) \{[\s\S]*?throw guardError;/,
      'callLoginGuard must throw error on check failures rather than silently returning locked: false'
    );
  });

  await t.test('2.4 & 2.5 Local session tracking cannot resurrect dead/revoked sessions', () => {
    assert.match(
      sessionsSrc,
      /const alive = await this\.heartbeat\(\);[\s\S]*?if \(!alive\) \{[\s\S]*?return false;/,
      'ensureCurrentSession must return false and not resurrect dead sessions when heartbeat fails'
    );
    assert.match(
      sessionsSrc,
      /notifySessionExpired\(\)/,
      'heartbeat must notify session expired when session is inactive, expired or not found'
    );
    assert.match(
      sessionsSrc,
      /lastActivity > now/,
      'getInactivityRemainingMs must protect against clock skew / future timestamps'
    );
  });

  await t.test('2.6 Sign-out performs global revocation while JWT is valid before local signout', () => {
    assert.match(
      authSrc,
      /await sessionService\.endCurrentSession\(options\?\.scope === 'global' \? 'revoked' : 'logout'/,
      'Remote session revocation must be called before local tokens are cleared'
    );
    const signOutMethod = authSrc.slice(authSrc.indexOf('async signOut('), authSrc.indexOf('async resetPassword('));
    const globalIdx = signOutMethod.indexOf("supabase.auth.signOut({ scope: 'global' })");
    const localIdx = signOutMethod.indexOf("supabase.auth.signOut({ scope: 'local' })");
    assert.ok(globalIdx !== -1, 'Must include global signout in signOut method');
    assert.ok(localIdx !== -1, 'Must include local signout in signOut method');
    assert.ok(
      globalIdx < localIdx,
      'Global signout must be invoked before local signout clears credentials'
    );
  });

  await t.test('2.7 Root layout navigation prevents race condition loops and handles non-admin', () => {
    assert.match(
      layoutSrc,
      /let isCurrent = true;/,
      'Root navigation must track active effect state to prevent race conditions'
    );
    assert.match(
      layoutSrc,
      /if \(!isCurrent\) return;/,
      'Navigation effect must abort redirect if segments/props changed during async resolution'
    );
    assert.match(
      layoutSrc,
      /if \(inAdminGroup\) \{[\s\S]*?router\.replace\('\/\(tabs\)'\);/,
      'Non-super-admin trying to access admin group must be redirected to tabs'
    );
  });

  await t.test('2.8 Email input validation enforces proper RFC format and catches common domain typos', () => {
    const COMMON_EMAIL_DOMAIN_TYPOS = new Set([
      'gmial.com',
      'gamil.com',
      'gmal.com',
      'gmai.com',
      'gmail.con',
      'gmail.co',
      'yaho.com',
      'yahooo.com',
      'yahoo.con',
      'hotmial.com',
      'outlok.com',
    ]);

    function validateEmailInput(rawEmail) {
      const normalized = (rawEmail || '').trim().toLowerCase();
      if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized)) {
        return { valid: false, reason: 'format' };
      }
      const domain = normalized.split('@')[1] || '';
      if (COMMON_EMAIL_DOMAIN_TYPOS.has(domain)) {
        return { valid: false, reason: 'typo' };
      }
      return { valid: true };
    }

    assert.equal(validateEmailInput('').valid, false);
    assert.equal(validateEmailInput('abc').valid, false);
    assert.equal(validateEmailInput('user@').valid, false);
    assert.equal(validateEmailInput('user@domain').valid, false);
    assert.equal(validateEmailInput('maria@gmial.com').valid, false);
    assert.equal(validateEmailInput('maria@gmial.com').reason, 'typo');
    assert.equal(validateEmailInput('pedro@gmail.com').valid, true);
    assert.equal(validateEmailInput('client@gigormoc.ph').valid, true);

    assert.match(authSrc, /\/^\(\?!\[\\s@\]\+\)@\[\^\\s@\]\+\\.\(?\[\^\\s@\]\{2,\}\)\$\/|\/\^\[\^\\s@\]\+@\[\^\\s@\]\+\\.\^?\[\^\\s@\]\{2,\}\$\//);
    assert.match(authSrc, /COMMON_EMAIL_DOMAIN_TYPOS\.has\(domain\)/);
  });

  await t.test('2.9 Password reset and OTP flows use consistent RPC mechanisms', () => {
    assert.doesNotMatch(
      authSrc,
      /resetPasswordForEmail/,
      'resetPassword must not fall back to magic link resetPasswordForEmail'
    );
    assert.match(
      authSrc,
      /create_password_reset_otp/,
      'resetPassword must use create_password_reset_otp RPC'
    );
    assert.match(
      authSrc,
      /verify_password_reset_otp/,
      'verifyPasswordResetOtp must use verify_password_reset_otp RPC'
    );
    assert.match(
      authSrc,
      /verify_and_reset_password/,
      'updatePassword must use verify_and_reset_password RPC when OTP is supplied'
    );
  });

  await t.test('2.10 Timeout wrapper normalizes network errors', () => {
    assert.match(
      supaSrc,
      /err\.code = 'OFFLINE'|err\.code = err\.code \|\| 'NETWORK_ERROR'/,
      'fetchWithTimeout must normalize offline/network errors'
    );
  });
});
