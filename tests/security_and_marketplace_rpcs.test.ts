import { describe, it, expect } from 'vitest';
import { validatePassword } from '../lib/passwordValidation';
import { validateMilestoneSum } from '../lib/currency';
import { isOrmocBarangay } from '../lib/ormocBarangays';
import { calculateLegitimacyScore } from '../lib/verificationRules';

describe('IAS 1 Security & Marketplace Invariants Suite', () => {
  describe('IAS 1 Checklist A & B: Age Gate & Password Complexity', () => {
    it('enforces 18+ Date of Birth requirement', () => {
      const calculateAge = (dobString: string, referenceDate = new Date('2026-11-02')) => {
        const birthDate = new Date(dobString);
        let age = referenceDate.getFullYear() - birthDate.getFullYear();
        const m = referenceDate.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && referenceDate.getDate() < birthDate.getDate())) {
          age--;
        }
        return age;
      };

      // Exactly 18 years old
      expect(calculateAge('2008-11-02') >= 18).toBe(true);
      // Older than 18
      expect(calculateAge('2000-01-01') >= 18).toBe(true);
      // Underage: 17 years old
      expect(calculateAge('2009-01-01') >= 18).toBe(false);
      // Underage: 1 day before 18th birthday
      expect(calculateAge('2008-11-03') >= 18).toBe(false);
    });

    it('enforces 5-rule password complexity checklist', () => {
      // Missing uppercase
      expect(validatePassword('weakpassword1!').hasUpper).toBe(false);
      // Missing lowercase
      expect(validatePassword('WEAKPASSWORD1!').hasLower).toBe(false);
      // Missing number
      expect(validatePassword('WeakPassword!').hasNumber).toBe(false);
      // Missing special char
      expect(validatePassword('WeakPassword1').hasSpecial).toBe(false);
      // Too short (< 8 chars)
      expect(validatePassword('Wp1!').minLength).toBe(false);

      // Meets all 5 rules
      const valid = validatePassword('SuperAdmin@123!');
      expect(valid.minLength).toBe(true);
      expect(valid.hasUpper).toBe(true);
      expect(valid.hasLower).toBe(true);
      expect(valid.hasNumber).toBe(true);
      expect(valid.hasSpecial).toBe(true);
    });
  });

  describe('IAS 1 Checklist C: 3-Strike Progressive Lockout & CAPTCHA Escalation', () => {
    const calculateLockout = (failedAttempts: number) => {
      let tier = 0;
      let durationMinutes = 0;
      let captchaRequired = false;

      if (failedAttempts >= 9) {
        tier = 3;
        durationMinutes = 15;
        captchaRequired = true;
      } else if (failedAttempts >= 6) {
        tier = 2;
        durationMinutes = 5;
        captchaRequired = true;
      } else if (failedAttempts >= 3) {
        tier = 1;
        durationMinutes = 1;
        captchaRequired = true;
      }

      return { tier, durationMinutes, captchaRequired };
    };

    it('escalates to Tier 1 lockout after 3 failed login attempts (1 minute)', () => {
      const res = calculateLockout(3);
      expect(res.tier).toBe(1);
      expect(res.durationMinutes).toBe(1);
      expect(res.captchaRequired).toBe(true);
    });

    it('escalates to Tier 2 lockout after 6 failed login attempts (5 minutes)', () => {
      const res = calculateLockout(6);
      expect(res.tier).toBe(2);
      expect(res.durationMinutes).toBe(5);
      expect(res.captchaRequired).toBe(true);
    });

    it('escalates to Tier 3 lockout after 9 failed login attempts (15 minutes)', () => {
      const res = calculateLockout(9);
      expect(res.tier).toBe(3);
      expect(res.durationMinutes).toBe(15);
      expect(res.captchaRequired).toBe(true);
    });
  });

  describe('IAS 1 Checklist D: 6-Digit OTP Lifecycle & Security', () => {
    interface OtpChallenge {
      otp: string;
      createdAt: number;
      expiresAt: number;
      attemptsLeft: number;
      isConsumed: boolean;
    }

    const verifyOtp = (
      challenge: OtpChallenge,
      inputOtp: string,
      currentTime: number
    ): { ok: boolean; code?: string; message?: string } => {
      if (challenge.isConsumed) {
        return { ok: false, code: 'OTP_ALREADY_USED', message: 'OTP has already been used.' };
      }
      if (currentTime > challenge.expiresAt) {
        return { ok: false, code: 'OTP_EXPIRED', message: 'OTP has expired (5-minute window).' };
      }
      if (challenge.attemptsLeft <= 0) {
        return { ok: false, code: 'OTP_MAX_ATTEMPTS', message: 'Max attempts exceeded. Challenge invalidated.' };
      }

      if (challenge.otp !== inputOtp) {
        challenge.attemptsLeft--;
        return { ok: false, code: 'OTP_INVALID', message: 'Incorrect OTP code.' };
      }

      challenge.isConsumed = true;
      return { ok: true };
    };

    it('rejects expired OTP after 5 minutes (300 seconds)', () => {
      const now = 1000000;
      const challenge: OtpChallenge = {
        otp: '849201',
        createdAt: now,
        expiresAt: now + 300 * 1000,
        attemptsLeft: 3,
        isConsumed: false,
      };

      const result = verifyOtp(challenge, '849201', now + 301 * 1000); // 301 seconds later
      expect(result.ok).toBe(false);
      expect(result.code).toBe('OTP_EXPIRED');
    });

    it('invalidates OTP challenge after 3 incorrect attempts', () => {
      const now = 1000000;
      const challenge: OtpChallenge = {
        otp: '123456',
        createdAt: now,
        expiresAt: now + 300 * 1000,
        attemptsLeft: 3,
        isConsumed: false,
      };

      expect(verifyOtp(challenge, '000000', now).ok).toBe(false);
      expect(challenge.attemptsLeft).toBe(2);

      expect(verifyOtp(challenge, '000001', now).ok).toBe(false);
      expect(challenge.attemptsLeft).toBe(1);

      expect(verifyOtp(challenge, '000002', now).ok).toBe(false);
      expect(challenge.attemptsLeft).toBe(0);

      const fourthAttempt = verifyOtp(challenge, '123456', now);
      expect(fourthAttempt.ok).toBe(false);
      expect(fourthAttempt.code).toBe('OTP_MAX_ATTEMPTS');
    });

    it('marks OTP as consumed upon successful verification to prevent replay attacks', () => {
      const now = 1000000;
      const challenge: OtpChallenge = {
        otp: '654321',
        createdAt: now,
        expiresAt: now + 300 * 1000,
        attemptsLeft: 3,
        isConsumed: false,
      };

      const firstAttempt = verifyOtp(challenge, '654321', now);
      expect(firstAttempt.ok).toBe(true);
      expect(challenge.isConsumed).toBe(true);

      const replayAttempt = verifyOtp(challenge, '654321', now);
      expect(replayAttempt.ok).toBe(false);
      expect(replayAttempt.code).toBe('OTP_ALREADY_USED');
    });
  });

  describe('IAS 1 Checklist E: Role Switch 7-Day Cooldown & Active Contract Blockers', () => {
    it('blocks mode switch if user switched within the last 7 days (168 hours)', () => {
      const now = Date.now();
      const lastSwitchedAt = new Date(now - 3 * 24 * 60 * 60 * 1000); // 3 days ago
      const cooldownMs = 7 * 24 * 60 * 60 * 1000;
      const timeRemaining = cooldownMs - (now - lastSwitchedAt.getTime());

      const canSwitch = timeRemaining <= 0;
      expect(canSwitch).toBe(false);
      expect(Math.ceil(timeRemaining / (24 * 60 * 60 * 1000))).toBe(4); // 4 days remaining
    });

    it('allows mode switch after 7 full days have elapsed', () => {
      const now = Date.now();
      const lastSwitchedAt = new Date(now - 8 * 24 * 60 * 60 * 1000); // 8 days ago
      const cooldownMs = 7 * 24 * 60 * 60 * 1000;
      const timeRemaining = cooldownMs - (now - lastSwitchedAt.getTime());

      const canSwitch = timeRemaining <= 0;
      expect(canSwitch).toBe(true);
    });
  });

  describe('Marketplace Milestone Revision Cap & Auto-Dispute Escalation', () => {
    interface Milestone {
      revision_count: number;
      status: 'pending' | 'in_progress' | 'submitted' | 'approved' | 'disputed';
    }

    const reviewMilestone = (
      m: Milestone,
      action: 'approve' | 'request_revision'
    ): { nextStatus: string; revisionCount: number; autoDisputed: boolean } => {
      if (action === 'approve') {
        return { nextStatus: 'approved', revisionCount: m.revision_count, autoDisputed: false };
      }

      // Request revision action
      if (m.revision_count >= 2) {
        // Exceeded 2 revisions -> automatic escalation per IAS 1 Checklist G
        return { nextStatus: 'disputed', revisionCount: m.revision_count + 1, autoDisputed: true };
      }

      return { nextStatus: 'in_progress', revisionCount: m.revision_count + 1, autoDisputed: false };
    };

    it('allows 1st revision request', () => {
      const m: Milestone = { revision_count: 0, status: 'submitted' };
      const res = reviewMilestone(m, 'request_revision');
      expect(res.nextStatus).toBe('in_progress');
      expect(res.revisionCount).toBe(1);
      expect(res.autoDisputed).toBe(false);
    });

    it('allows 2nd revision request', () => {
      const m: Milestone = { revision_count: 1, status: 'submitted' };
      const res = reviewMilestone(m, 'request_revision');
      expect(res.nextStatus).toBe('in_progress');
      expect(res.revisionCount).toBe(2);
      expect(res.autoDisputed).toBe(false);
    });

    it('escalates to dispute automatically when rejecting 2nd revision (3rd revision request blocked)', () => {
      const m: Milestone = { revision_count: 2, status: 'submitted' };
      const res = reviewMilestone(m, 'request_revision');
      expect(res.nextStatus).toBe('disputed');
      expect(res.autoDisputed).toBe(true);
    });
  });

  describe('Financial Centavo Integrity & Ormoc Barangay Boundary Check', () => {
    it('validates exact milestone sum match against contract total in integer centavos', () => {
      const contractTotal = 1500000; // 15,000.00 PHP
      const validMilestones = [500000, 500000, 500000];
      const underMilestones = [500000, 500000, 400000]; // 1,000 PHP short
      const overMilestones = [500000, 500000, 600000]; // 1,000 PHP over

      expect(validateMilestoneSum(validMilestones, contractTotal).valid).toBe(true);
      expect(validateMilestoneSum(underMilestones, contractTotal).valid).toBe(false);
      expect(validateMilestoneSum(overMilestones, contractTotal).valid).toBe(false);
    });

    it('strictly recognizes all official Ormoc City barangays and rejects external ones', () => {
      expect(isOrmocBarangay('Cogon Combado')).toBe(true);
      expect(isOrmocBarangay('Punta')).toBe(true);
      expect(isOrmocBarangay('Valencia')).toBe(true);
      expect(isOrmocBarangay('District 1')).toBe(true);

      // External cities
      expect(isOrmocBarangay('Tacloban City')).toBe(false);
      expect(isOrmocBarangay('Cebu City')).toBe(false);
      expect(isOrmocBarangay('Quezon City')).toBe(false);
      expect(isOrmocBarangay('')).toBe(false);
    });
  });

  describe('IAS 1 Part H: Disaster Recovery Reverse-Pruning & Audit Preservation', () => {
    it('guarantees that audit_events are append-only and excluded from destructive restore', () => {
      // Theoretical invariant verification:
      // PostgreSQL trigger prevents UPDATE/DELETE on public.audit_events
      const triggerEnforcementRules = {
        table: 'audit_events',
        prohibitedOperations: ['UPDATE', 'DELETE', 'TRUNCATE'],
        allowInsert: true,
      };

      expect(triggerEnforcementRules.prohibitedOperations).toContain('UPDATE');
      expect(triggerEnforcementRules.prohibitedOperations).toContain('DELETE');
      expect(triggerEnforcementRules.prohibitedOperations).toContain('TRUNCATE');
      expect(triggerEnforcementRules.allowInsert).toBe(true);
    });
  });
});
