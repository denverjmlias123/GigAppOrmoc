-- Migration: 20261104000003_wipe_all_data_except_superadmin.sql
-- Force delete all transactional and non-admin user data while keeping Super Admin intact

-- 1. Truncate all transactional tables with CASCADE
TRUNCATE TABLE 
  public.external_payments,
  public.milestones,
  public.agreements,
  public.applications,
  public.gigs,
  public.messages,
  public.conversations,
  public.notifications,
  public.reviews,
  public.reports,
  public.project_inbox_messages,
  public.user_skills,
  public.portfolio_items,
  public.audit_events,
  public.user_sessions,
  public.otp_challenges,
  public.email_verification_otps
  CASCADE;

-- 2. Remove non-super-admin users from auth.users and profiles
DELETE FROM auth.users WHERE id <> '00000000-0000-0000-0000-000000000001';
DELETE FROM public.profiles WHERE id <> '00000000-0000-0000-0000-000000000001';

-- 3. Reset Super Admin security lockout state
UPDATE public.login_security_state
SET failed_attempts = 0,
    lockout_tier = 0,
    captcha_required = false
WHERE user_id = '00000000-0000-0000-0000-000000000001';

-- 4. Reset Super Admin profile to pristine metrics
UPDATE public.profiles
SET active_mode = 'hire',
    onboarding_completed = true,
    onboarding_step = 3,
    freelancer_rating_avg = 0.00,
    freelancer_rating_count = 0,
    client_rating_avg = 0.00,
    client_rating_count = 0,
    freelancer_completed_gigs = 0,
    client_completed_gigs = 0,
    is_active = true,
    is_admin_locked = false,
    last_mode_switch_at = NULL
WHERE id = '00000000-0000-0000-0000-000000000001';
