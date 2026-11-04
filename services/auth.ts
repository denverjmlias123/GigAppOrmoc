import { supabase } from '../lib/supabase';
import { strings } from '../constants/strings';
import * as passwordPolicy from '../utils/passwordPolicy';
import * as Linking from 'expo-linking';
import { sessionService } from './sessions';

interface SignUpParams {
  email: string;
  password: string;
  displayName: string;
  dob: string; // YYYY-MM-DD
  termsVersion?: string;
}

interface SignInParams {
  email: string;
  password: string;
}

export interface Profile {
  id: string;
  display_name: string;
  headline: string;
  bio: string | null;
  avatar_path: string | null;
  avatar_url?: string | null;
  area: string | null;
  area_barangay?: string | null;
  preferred_contact: string;
  languages: string[];
  work_types: string[];
  availability: 'available_now' | 'part_time' | 'weekends' | 'not_taking_work' | null;
  experience_years: 'lt_1' | '1_3' | '3_5' | '5_plus' | null;
  starting_rate_note: string;
  client_type: 'individual' | 'business' | 'organization' | 'other' | null;
  business_name: string;
  about_hiring: string;
  active_mode: 'find_work' | 'hire' | null;
  mode_changed_at: string | null;
  last_mode_switch_at?: string | null;
  onboarding_complete: boolean;
  onboarding_completed?: boolean;
  onboarding_step?: number;
  freelancer_rating_avg: number;
  freelancer_rating_count: number;
  freelancer_review_count?: number;
  client_rating_avg: number;
  client_rating_count: number;
  client_review_count?: number;
  freelancer_completed_gigs: number;
  client_completed_gigs: number;
  status: 'active' | 'suspended' | 'deactivated' | 'deleted';
  is_active?: boolean;
  is_admin_locked?: boolean;
  must_change_password: boolean;
  email?: string;
  username?: string;
  date_of_birth?: string;
  phone?: string | null;
  email_verified?: boolean;
  is_legit_verified?: boolean;
  verification_status?: 'unverified' | 'ai_flagged' | 'approved' | 'rejected' | 'unsubmitted' | 'pending' | 'update_requested';
  legitimacy_score?: number;
  ai_legitimacy_score?: number;
  ai_legitimacy_report?: any;
  verified_at?: string | null;
  verified_by?: string | null;
  hiring_interests?: string[] | null;
  created_at: string;
  updated_at?: string;
}

export type UserProfile = Profile;

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

export function normalizeEmail(email: string): string {
  return (email || '').trim().toLowerCase();
}

export function validateEmailInput(rawEmail: string): { valid: boolean; message?: string } {
  const normalized = normalizeEmail(rawEmail);
  // Local accounts accepted: any non-empty text of at least 3 characters.
  // Real email format is not required because OTP is copy-paste in-app, not email delivery.
  if (!normalized || normalized.length < 3) {
    return { valid: false, message: strings.auth.invalidEmailFormat };
  }
  return { valid: true };
}

export function isDuplicateEmailAuthResult(error: any, data?: any): boolean {
  if (error) {
    const code = String(error.code || '').toLowerCase();
    const msg = String(error.message || '').toLowerCase();
    if (
      code === 'user_already_exists' ||
      code === 'email_exists' ||
      msg.includes('user already registered') ||
      msg.includes('already registered') ||
      msg.includes('already been registered') ||
      msg.includes('email already exists')
    ) {
      return true;
    }
  }

  // Supabase Auth returns a user with an empty identities array when email confirmation is enabled and the email is already registered
  if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return true;
  }

  return false;
}

let signUpInFlight = false;
let signInInFlight: Promise<any> | null = null;
let signOutInFlight: Promise<void> | null = null;
let resetPasswordInFlight = false;
let updatePasswordInFlight = false;
let resendConfirmationInFlight = false;
let lastResendConfirmationAt = 0;

type LoginGuardResult = { locked?: boolean; seconds_left?: number; attempts_left?: number };

async function callLoginGuard(action: 'check' | 'failure' | 'success', email: string): Promise<LoginGuardResult> {
  try {
    const { data, error } = await supabase.functions.invoke('login-guard', { body: { action, email } });
    if (error) {
      return { locked: false, attempts_left: 3, seconds_left: 0 };
    }
    if (data?.error) {
      if (data.error === 'server_unavailable' || data.error === 'method_not_allowed') {
        return { locked: false, attempts_left: 3, seconds_left: 0 };
      }
      const guardError: any = new Error(strings.errors.generic);
      guardError.code = data.error;
      throw guardError;
    }
    return data ?? {};
  } catch (err: any) {
    if (err?.code === 'ACCOUNT_LOCKED') throw err;
    return { locked: false, attempts_left: 3, seconds_left: 0 };
  }
}

function createLockedError(result: LoginGuardResult): Error & Record<string, unknown> {
  const error: any = new Error('Too many failed login attempts.');
  error.code = 'ACCOUNT_LOCKED';
  error.seconds_left = Math.max(0, Number(result.seconds_left) || 0);
  error.attempts_left = 0;
  return error;
}

export const RESEND_CONFIRMATION_COOLDOWN_SECONDS = 60;

export const authService = {
  normalizeEmail,
  validateEmailInput,
  isDuplicateEmailAuthResult,
  validatePassword: passwordPolicy.validatePassword,
  validatePasswordConfirmation: passwordPolicy.validatePasswordConfirmation,

  async submitAccountAppeal(input: { email: string; details: string }): Promise<{ ok: boolean; message: string }> {
    const normalizedEmail = normalizeEmail(input.email);
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      throw new Error(strings.auth.invalidEmailFormat);
    }
    const trimmedDetails = (input.details || '').trim();
    if (trimmedDetails.length < 10) {
      throw new Error('Please enter at least 10 characters explaining your appeal or report.');
    }
    try {
      const { data, error } = await supabase.functions.invoke('login-guard', {
        body: { action: 'appeal', email: normalizedEmail, details: trimmedDetails },
      });
      if (error) {
        return { ok: true, message: 'Your appeal has been recorded. Super Admin will review your account.' };
      }
      if (data?.error) {
        throw new Error(String(data.error));
      }
      return { ok: true, message: 'Your appeal has been submitted to the Super Admin. Please wait for account review.' };
    } catch (err: any) {
      if (err?.message && !err.message.includes('FunctionsHttpError') && !err.message.includes('Failed to fetch')) {
        throw err;
      }
      return { ok: true, message: 'Your appeal has been recorded. Super Admin will review your account.' };
    }
  },

  async getLoginGuardState(email: string): Promise<LoginGuardResult> {
    const normalizedEmail = normalizeEmail(email);
    const validation = validateEmailInput(normalizedEmail);
    if (!validation.valid) return { locked: false, attempts_left: 3, seconds_left: 0 };
    return callLoginGuard('check', normalizedEmail);
  },

  assertPasswordPolicy(password: string, email = '', displayName = '') {
    const result = passwordPolicy.validatePassword(password, email, displayName);
    if (!result.valid) {
      const policyErr: any = new Error(strings.auth.passwordInvalid);
      policyErr.code = 'WEAK_PASSWORD';
      policyErr.failedRules = result.failed;
      throw policyErr;
    }
  },

  async signUp({ email, password, displayName, dob, termsVersion = 'v1.0' }: SignUpParams) {
    if (signUpInFlight) {
      const busyErr: any = new Error('Sign up is already in progress.');
      busyErr.code = 'SIGNUP_IN_PROGRESS';
      throw busyErr;
    }

    const normalizedEmail = normalizeEmail(email);
    const emailCheck = validateEmailInput(normalizedEmail);
    if (!emailCheck.valid) {
      const invalidErr: any = new Error(emailCheck.message || strings.auth.invalidEmailFormat);
      invalidErr.code = 'INVALID_EMAIL';
      invalidErr.field = 'email';
      throw invalidErr;
    }

    this.assertPasswordPolicy(password, normalizedEmail, displayName);

    signUpInFlight = true;
    try {
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: {
            display_name: displayName.trim(),
            dob,
            terms_version: termsVersion,
          },
        },
      });

      if (isDuplicateEmailAuthResult(error, data)) {
        const dupErr: any = new Error(strings.auth.duplicateEmailMessage);
        dupErr.code = 'EMAIL_ALREADY_REGISTERED';
        dupErr.field = 'email';
        throw dupErr;
      }

      if (error) {
        throw error;
      }

      return data;
    } finally {
      signUpInFlight = false;
    }
  },

  async signIn({ email, password }: SignInParams) {
    if (signInInFlight) {
      return signInInFlight;
    }

    const normalizedEmail = normalizeEmail(email);
    const emailCheck = validateEmailInput(normalizedEmail);
    if (!emailCheck.valid) {
      const invalidErr: any = new Error(emailCheck.message || strings.auth.invalidEmailFormat);
      invalidErr.code = 'INVALID_EMAIL';
      invalidErr.field = 'email';
      throw invalidErr;
    }

    signInInFlight = (async () => {
      try {
        const gate = await callLoginGuard('check', normalizedEmail);
        if (gate.locked) throw createLockedError(gate);

        const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
        if (error) {
          const lower = String(error.message || '').toLowerCase();
          if (lower.includes('email not confirmed') || (error as any).code === 'email_not_confirmed') {
            const unconfErr: any = new Error(strings.errors.emailNotConfirmed);
            unconfErr.code = 'EMAIL_NOT_CONFIRMED';
            unconfErr.field = 'email';
            throw unconfErr;
          }
          if (lower.includes('invalid login credentials') || (error as any).code === 'invalid_credentials') {
            const failure: any = new Error(strings.errors.wrongCredentials);
            failure.code = 'INVALID_CREDENTIALS';
            try {
              const result = await callLoginGuard('failure', normalizedEmail);
              if (result.locked) throw createLockedError(result);
              failure.attempts_left = result.attempts_left;
            } catch (guardError: any) {
              if (guardError?.code === 'ACCOUNT_LOCKED') throw guardError;
              // Preserve the generic credential error when recording an attempt is unavailable.
            }
            throw failure;
          }
          throw error;
        }

        try {
          await callLoginGuard('success', normalizedEmail);
          await sessionService.startSession();
        } catch (sessionError: any) {
          if (String(sessionError?.message || '').includes('account_unavailable')) {
            await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
            const suspendedErr: any = new Error(strings.errors.accountSuspended);
            suspendedErr.code = 'ACCOUNT_SUSPENDED';
            throw suspendedErr;
          }
          console.warn('Session start warning:', sessionError);
        }
        return data;
      } finally {
        signInInFlight = null;
      }
    })();

    return signInInFlight;
  },

  async signOut(options?: { scope?: 'local' | 'global' }) {
    if (signOutInFlight) {
      return signOutInFlight;
    }

    signOutInFlight = (async () => {
      // End remote session before clearing the local token so the RPC call has authenticated JWT
      try {
        const currentSessionId = await sessionService.getCurrentSessionId();
        if (currentSessionId) {
          if (options?.scope === 'global') {
            await sessionService.endOtherSessions(currentSessionId).catch(() => undefined);
          }
          await sessionService.endCurrentSession(options?.scope === 'global' ? 'revoked' : 'logout', currentSessionId).catch(() => undefined);
        }
      } catch {
        // Best-effort remote revocation; proceed with local signOut
      }

      try {
        // 1. Always clear local session first so logout works even when offline
        try {
          await supabase.auth.signOut({ scope: 'local' });
        } catch (localErr: any) {
          console.warn('Supabase local signOut warning:', localErr?.message);
        }

        // 2. Best-effort global revoke when requested (never blocks local logout if offline)
        if (options?.scope === 'global') {
          try {
            await supabase.auth.signOut({ scope: 'global' });
          } catch {
            // Best-effort server revoke; local session is already cleared
          }
        }
      } finally {
        signOutInFlight = null;
      }
    })();

    return signOutInFlight;
  },

  async resetPassword(email: string): Promise<{ devOtp: string | null }> {
    if (resetPasswordInFlight) {
      return { devOtp: null };
    }
    const normalizedEmail = normalizeEmail(email);
    const emailCheck = validateEmailInput(normalizedEmail);
    if (!emailCheck.valid) {
      const invalidErr: any = new Error(emailCheck.message || strings.auth.invalidEmailFormat);
      invalidErr.code = 'INVALID_EMAIL';
      invalidErr.field = 'email';
      throw invalidErr;
    }

    resetPasswordInFlight = true;
    try {
      const { data, error } = await supabase.rpc('create_password_reset_otp', { p_email: normalizedEmail });
      if (!error && data?.ok && data?.otp) {
        return { devOtp: String(data.otp) };
      }
      if (data && data.ok === false) {
        const appErr: any = new Error(data.message || 'No account found with this email.');
        appErr.code = data.code || 'USER_NOT_FOUND';
        throw appErr;
      }

      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: Linking.createURL('reset-password'),
      });
      if (resetErr) throw resetErr;
      return { devOtp: null };
    } finally {
      resetPasswordInFlight = false;
    }
  },

  async verifySignupOtp(arg1: string, arg2?: string, arg3?: string): Promise<any> {
    let email = '';
    let token = '';
    let userId = arg3 || '';

    if (arg1 && arg1.includes('@')) {
      email = arg1;
      token = arg2 || '';
    } else {
      token = arg1 || '';
      email = arg2 || '';
    }

    const cleanToken = token.replace(/\D/g, '').slice(0, 10);
    if (!cleanToken || cleanToken.length < 6) {
      const err: any = new Error(strings.auth.otpCodeLength);
      err.code = 'INVALID_OTP';
      throw err;
    }

    if (userId || email) {
      try {
        const ok = await this.verifySignupOtpByUser(userId, cleanToken, email);
        if (ok) return { user: { id: userId, email } };
      } catch {
        // Fall back to standard auth.verifyOtp
      }
    }

    const normalizedEmail = email ? normalizeEmail(email) : '';
    if (normalizedEmail) {
      const { data, error } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token: cleanToken,
        type: 'signup',
      });
      if (error) {
        throw error;
      }
      return data;
    }

    throw new Error('Email or user ID required to verify OTP.');
  },

  async createSignupOtp(userId?: string, email?: string): Promise<string> {
    const normEmail = email ? normalizeEmail(email) : '';
    const { data, error } = await supabase.rpc('create_signup_otp', {
      p_user_id: userId || null,
      p_email: normEmail || null,
    });
    if (error) {
      throw error;
    }
    const otpCode = String(data);
    // Mirror into project_inbox_messages so demo ProjectMailInbox can display it immediately
    if (otpCode && (userId || normEmail)) {
      try {
        await supabase.from('project_inbox_messages').insert({
          user_id: userId || null,
          recipient_email: normEmail || '',
          purpose: 'signup_verification',
          subject: 'GigOrmoc Demo Email Verification OTP',
          otp_code_display: otpCode,
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        });
      } catch {
        // Non-blocking inbox notification fallback
      }
    }
    return otpCode;
  },

  async verifySignupOtpByUser(userId?: string, otp?: string, email?: string): Promise<boolean> {
    const cleanOtp = (otp || '').replace(/\D/g, '').slice(0, 10);
    if (!cleanOtp || cleanOtp.length < 6) {
      const err: any = new Error(strings.auth.otpCodeLength);
      err.code = 'INVALID_OTP';
      throw err;
    }
    const { data, error } = await supabase.rpc('verify_signup_otp', {
      p_user_id: userId || null,
      p_otp: cleanOtp,
      p_email: email ? normalizeEmail(email) : null,
    });
    if (error) {
      throw error;
    }
    return Boolean(data);
  },

  async updateEmail(newEmail: string) {
    const normalized = normalizeEmail(newEmail);
    const check = validateEmailInput(normalized);
    if (!check.valid) {
      const err: any = new Error(check.message || strings.auth.invalidEmailFormat);
      err.code = 'INVALID_EMAIL';
      throw err;
    }
    const { data, error } = await supabase.auth.updateUser({ email: normalized });
    if (error) throw error;
    return data;
  },

  async verifyEmailChangeOtp(newEmail: string, token: string) {
    const normalized = normalizeEmail(newEmail);
    const cleanToken = token.replace(/\D/g, '').slice(0, 10);
    if (!cleanToken || cleanToken.length < 6) {
      const err: any = new Error(strings.auth.otpCodeLength);
      err.code = 'INVALID_OTP';
      throw err;
    }
    const { data, error } = await supabase.auth.verifyOtp({
      email: normalized,
      token: cleanToken,
      type: 'email_change',
    });
    if (error) throw error;
    return data;
  },

  async resolveIdentifier(identifier: string): Promise<string> {
    const trimmed = (identifier || '').trim();
    if (!trimmed) return '';
    if (trimmed.includes('@')) return normalizeEmail(trimmed);
    try {
      const { data, error } = await supabase.rpc('resolve_login_identifier', { p_identifier: trimmed });
      if (error || !data) return trimmed;
      return String(data);
    } catch {
      return trimmed;
    }
  },

  async verifyPasswordResetOtp(email: string, token: string) {
    const normalizedEmail = normalizeEmail(email);
    const cleanToken = token.replace(/\D/g, '').slice(0, 10);
    if (!cleanToken || cleanToken.length < 6) {
      const err: any = new Error(strings.auth.otpCodeLength);
      err.code = 'INVALID_OTP';
      throw err;
    }

    try {
      const { data, error } = await supabase.rpc('verify_password_reset_otp', {
        p_email: normalizedEmail,
        p_otp: cleanToken,
      });
      if (!error && data?.ok) {
        return { user: { email: normalizedEmail } };
      }
      if (data && data.ok === false) {
        const otpErr: any = new Error(data.message || strings.auth.otpInvalidOrExpired);
        otpErr.code = data.code || 'INVALID_OTP';
        throw otpErr;
      }
    } catch (rpcErr: any) {
      if (rpcErr?.code === 'INVALID_OTP' || rpcErr?.code === 'USER_NOT_FOUND') {
        throw rpcErr;
      }
    }

    const { data, error } = await supabase.auth.verifyOtp({
      email: normalizedEmail,
      token: cleanToken,
      type: 'recovery',
    });
    if (error) {
      throw error;
    }
    return data;
  },

  async updatePassword({
    password,
    currentPassword,
    nonce,
    email = '',
    displayName = '',
    otp = '',
  }: { password: string; currentPassword?: string; nonce?: string; email?: string; displayName?: string; otp?: string }) {
    if (updatePasswordInFlight) {
      const busyErr: any = new Error('Password update is already in progress.');
      busyErr.code = 'PASSWORD_UPDATE_IN_PROGRESS';
      throw busyErr;
    }
    this.assertPasswordPolicy(password, email, displayName);
    updatePasswordInFlight = true;
    try {
      if (email && otp) {
        try {
          const { data, error } = await supabase.rpc('verify_and_reset_password', {
            p_email: normalizeEmail(email),
            p_otp: otp.trim(),
            p_new_password: password,
          });
          if (!error && data?.ok) {
            return { ok: true };
          }
          if (data && data.ok === false) {
            const err: any = new Error(data.message || 'Password update failed.');
            err.code = data.code || 'UPDATE_FAILED';
            throw err;
          }
        } catch (rpcErr: any) {
          if (rpcErr?.code) throw rpcErr;
        }
      }

      const { data, error } = await supabase.auth.updateUser({
        password,
        ...(currentPassword ? { current_password: currentPassword } : {}),
        ...(nonce ? { nonce } : {}),
      });
      if (error) throw error;
      return data;
    } finally {
      updatePasswordInFlight = false;
    }
  },

  async requestPasswordReauthentication() {
    const { error } = await supabase.auth.reauthenticate();
    if (error) throw error;
  },

  async resendConfirmationEmail(email: string) {
    if (resendConfirmationInFlight) {
      return;
    }
    const normalizedEmail = normalizeEmail(email);
    const emailCheck = validateEmailInput(normalizedEmail);
    if (!emailCheck.valid) {
      const invalidErr: any = new Error(emailCheck.message || strings.auth.invalidEmailFormat);
      invalidErr.code = 'INVALID_EMAIL';
      invalidErr.field = 'email';
      throw invalidErr;
    }

    const elapsedSeconds = Math.floor((Date.now() - lastResendConfirmationAt) / 1000);
    if (lastResendConfirmationAt > 0 && elapsedSeconds < RESEND_CONFIRMATION_COOLDOWN_SECONDS) {
      const remaining = RESEND_CONFIRMATION_COOLDOWN_SECONDS - elapsedSeconds;
      const rateErr: any = new Error(`Too many tries. Please wait ${remaining} seconds.`);
      rateErr.code = 'RATE_LIMITED';
      rateErr.retryAfterSeconds = remaining;
      throw rateErr;
    }

    resendConfirmationInFlight = true;
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: normalizedEmail,
      });
      if (error) {
        throw error;
      }
      lastResendConfirmationAt = Date.now();
    } finally {
      resendConfirmationInFlight = false;
    }
  },

  async getCurrentProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) return null;

    const row: any = data;
    const rawMode = row.active_mode;
    const active_mode: 'find_work' | 'hire' | null =
      rawMode === 'hire' || rawMode === 'client'
        ? 'hire'
        : rawMode === 'find_work' || rawMode === 'freelancer'
        ? 'find_work'
        : null;

    let email = row.email || '';
    if (!email) {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData.session?.user?.id === userId) {
          email = sessionData.session.user.email || '';
        }
      } catch {}
    }

    const normalized: Profile = {
      ...row,
      active_mode,
      email,
      username: row.username || (email ? email.split('@')[0] : 'user'),
      onboarding_complete: Boolean(row.onboarding_complete || row.onboarding_completed),
      onboarding_completed: Boolean(row.onboarding_completed || row.onboarding_complete),
      onboarding_step: row.onboarding_step ?? 1,
      area: row.area || row.area_barangay || null,
      area_barangay: row.area_barangay || row.area || null,
      avatar_path: row.avatar_path || row.avatar_url || null,
      avatar_url: row.avatar_url || row.avatar_path || null,
      freelancer_rating_count: row.freelancer_rating_count ?? row.freelancer_review_count ?? 0,
      client_rating_count: row.client_rating_count ?? row.client_review_count ?? 0,
      freelancer_review_count: row.freelancer_review_count ?? row.freelancer_rating_count ?? 0,
      client_review_count: row.client_review_count ?? row.client_rating_count ?? 0,
      freelancer_completed_gigs: row.freelancer_completed_gigs ?? 0,
      client_completed_gigs: row.client_completed_gigs ?? 0,
      status: row.status ?? (row.is_active === false ? 'suspended' : 'active'),
      is_active: row.is_active ?? (row.status === 'active'),
      is_admin_locked: row.is_admin_locked ?? false,
      must_change_password: row.must_change_password ?? false,
      email_verified: row.email_verified ?? false,
      verification_status: row.verification_status ?? 'unverified',
      legitimacy_score: row.legitimacy_score ?? row.ai_legitimacy_score ?? 0,
      ai_legitimacy_score: row.ai_legitimacy_score ?? row.legitimacy_score ?? 0,
      ai_legitimacy_report: row.ai_legitimacy_report ?? null,
      verified_at: row.verified_at ?? null,
      verified_by: row.verified_by ?? null,
      is_legit_verified: row.is_legit_verified ?? (row.verification_status === 'approved'),
    };

    return normalized;
  },

  async chooseInitialMode(targetMode: 'find_work' | 'hire'): Promise<void> {
    try {
      const { data, error } = await supabase.rpc('choose_initial_mode', {
        target_mode: targetMode,
        p_mode: targetMode,
      });

      if (!error) {
        if (data && typeof data === 'object' && (data as any).ok === false) {
          throw new Error((data as any).message || 'Failed to choose initial mode.');
        }
        return;
      }
    } catch (rpcErr: any) {
      if (rpcErr?.message?.includes('already been chosen')) {
        return;
      }
      // Fall through to direct profile update fallback
    }

    // Resilient fallback: direct profile update
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { error: updateErr } = await supabase
      .from('profiles')
      .update({
        active_mode: targetMode,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (updateErr) {
      throw updateErr;
    }
  },

  async updateProfile(
    userId: string,
    updates: Partial<Pick<Profile, 'display_name' | 'bio' | 'avatar_path' | 'area' | 'onboarding_complete'>>
  ) {
    const payload: any = { ...updates };
    if ('onboarding_complete' in payload || 'onboarding_completed' in payload) {
      const val = Boolean(payload.onboarding_complete || payload.onboarding_completed);
      payload.onboarding_complete = val;
      payload.onboarding_completed = val;
    }
    if ('avatar_path' in payload || 'avatar_url' in payload) {
      const val = payload.avatar_path || payload.avatar_url || null;
      payload.avatar_path = val;
      payload.avatar_url = val;
    }
    if ('area' in payload || 'area_barangay' in payload) {
      const val = payload.area || payload.area_barangay || null;
      payload.area = val;
      payload.area_barangay = val;
    }

    let { data, error } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', userId)
      .select()
      .maybeSingle();

    if (
      error &&
      (error.code === 'PGRST204' ||
        error.message?.includes('schema cache') ||
        error.message?.includes('does not exist') ||
        error.message?.includes('not find'))
    ) {
      const altPayload: any = { ...updates };
      const retry = await supabase
        .from('profiles')
        .update(altPayload)
        .eq('id', userId)
        .select()
        .maybeSingle();
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      throw error;
    }

    return (data || updates) as Profile;
  },

  async completeOnboarding(mode?: string): Promise<void> {
    let { error } = await supabase.rpc('complete_onboarding', {
      p_mode: mode || null,
    });
    if (error && (error.code === 'PGRST202' || error.message?.includes('not find'))) {
      const stepRes = await supabase.rpc('rpc_complete_onboarding_step', {
        p_step: 3,
        p_payload: mode ? { active_mode: mode } : {},
      });
      error = stepRes.error;
    }
    if (error) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await this.updateProfile(user.id, {
            onboarding_complete: true,
            ...(mode ? { active_mode: mode } : {}),
          } as any);
          return;
        }
      } catch {
        // Fallback failed, throw original error
      }
      throw error;
    }
  },
};

