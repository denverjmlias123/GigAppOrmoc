-- ============================================================================
-- Complete Force Wipe of All Data Except Single Super Admin Account
-- ============================================================================

-- 1. Disable audit events immutability trigger so it can be wiped
ALTER TABLE public.audit_events DISABLE TRIGGER trg_audit_events_immutable;

-- 2. Truncate / delete all transactional, relational, and activity data
DELETE FROM public.external_payments;
DELETE FROM public.milestones;
DELETE FROM public.agreements;
DELETE FROM public.applications;
DELETE FROM public.gigs;
DELETE FROM public.reviews;
DELETE FROM public.messages;
DELETE FROM public.conversations;
DELETE FROM public.notifications;
DELETE FROM public.reports;
DELETE FROM public.portfolio_items;
DELETE FROM public.user_skills;
DELETE FROM public.database_backups;
DELETE FROM public.email_verification_otps;
DELETE FROM public.otp_challenges;
DELETE FROM public.project_inbox_messages;
DELETE FROM public.user_sessions;
DELETE FROM public.audit_events;

-- 3. Re-enable audit events immutability trigger
ALTER TABLE public.audit_events ENABLE TRIGGER trg_audit_events_immutable;

-- 4. Delete all auth users EXCEPT the single Super Admin account
DELETE FROM auth.users WHERE lower(email) != 'superadmin@gigormoc.local';

-- 5. Clean up any orphan profiles/identities
DELETE FROM public.profiles WHERE lower(email) != 'superadmin@gigormoc.local';
DELETE FROM auth.identities WHERE user_id != '00000000-0000-0000-0000-000000000001';

-- 6. Reset the Super Admin account to a completely fresh, pristine state
UPDATE public.profiles
SET display_name = 'Super Admin',
    bio = NULL,
    avatar_url = NULL,
    area_barangay = NULL,
    client_type = NULL,
    business_name = NULL,
    hiring_interests = '{}',
    freelancer_rating_avg = 0.00,
    freelancer_review_count = 0,
    client_rating_avg = 0.00,
    client_review_count = 0,
    legitimacy_score = 100,
    verification_status = 'verified',
    verification_notes = NULL,
    active_mode = 'client',
    email_verified = true,
    onboarding_completed = true,
    onboarding_step = 3,
    is_active = true,
    is_admin_locked = false,
    updated_at = now()
WHERE id = '00000000-0000-0000-0000-000000000001';

-- 7. Reset login security state for Super Admin
UPDATE public.login_security_state
SET failed_attempts = 0,
    lockout_tier = 0,
    locked_until = NULL,
    captcha_required = false,
    active_captcha_hash = NULL,
    updated_at = now()
WHERE user_id = '00000000-0000-0000-0000-000000000001';

-- 8. Ensure only the single Super Admin exists in platform_admins
DELETE FROM public.platform_admins WHERE user_id != '00000000-0000-0000-0000-000000000001';

INSERT INTO public.platform_admins (user_id, role, assigned_by)
VALUES ('00000000-0000-0000-0000-000000000001', 'super_admin', '00000000-0000-0000-0000-000000000001')
ON CONFLICT (user_id) DO UPDATE SET role = 'super_admin';
