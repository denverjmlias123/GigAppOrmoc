# GigOrmoc Local Freelance Marketplace & Security Architecture

* **Author:** John Denver Lias (`denverjmliaz`)
* **Date:** 2026-11-02

## Overview

GigOrmoc is a cross-platform mobile and web freelance marketplace for Ormoc City built with Expo Router (React Native + TypeScript) and Supabase (PostgreSQL, Row-Level Security, Realtime, and Storage). It serves three user groups: local freelancers (`Find Work` mode), local clients and small businesses (`Hire Someone` mode), and platform administrators (`Admin` and `Super Admin`).

The system combines a 43-screen marketplace workflow (gigs, proposals, milestone agreements, external payment tracking in integer centavos, real-time 1-on-1 chat, reviews, and moderation reports) with server-enforced Information Assurance and Security 1 (IAS 1 Checklists A–H) controls: made-up email support with self-hosted 6-digit OTP verification delivered via an in-app demo mail drawer, 3-strike escalating login lockouts (`1m -> 5m -> 15m`) with a self-generated visual alphanumeric CAPTCHA, 15-minute idle auto-logout, multi-tab session revocation, an append-only security log trail, and database backup and restore.

## Analysis

The six Goldfish review lenses (`egm-design`, `egm-codebase-details`, `egm-zoom-out`, `egm-comprehension`, `egm-implementation-readiness`, and `egm-structural`) identified seven structural risks across the original specification files ([AUTH_ONBOARDING_LOGIC.md](file:///c:/Users/denverjmliaz/.opencode/plan/AUTH_ONBOARDING_LOGIC.md), [MAIN_APP_LOGIC.md](file:///c:/Users/denverjmliaz/.opencode/plan/MAIN_APP_LOGIC.md), and [implementation_plan.md](file:///c:/Users/denverjmliaz/.gemini/antigravity/brain/95be8320-e97b-45c0-8a89-2889d91ad052/implementation_plan.md)):

1. **PostgreSQL Transaction Rollback Wipes Security Counters (`egm-design` / `egm-codebase-details` — Blocker):**
   In PostgreSQL, if an RPC increments `failed_attempts` or `attempts_used`, inserts a failure record into `public.audit_events`, and then calls `RAISE EXCEPTION` to return an error to the client, the database rolls back the entire transaction. That erases the failed attempt increment, the lockout timer, and the audit log entry. All security gate RPCs (`rpc_verify_credentials_and_gate`, `rpc_verify_otp`, `rpc_verify_captcha`) must commit normally and return a structured JSONB payload (`{ ok: boolean, code: string, message: string, remaining_attempts?: number, locked_until?: string, captcha_required?: boolean }`).

2. **Hybrid Identity Synchronization Between `auth.users` and `public.profiles` (`egm-design` — Blocker):**
   Using Supabase Realtime, Storage, and Row-Level Security requires a valid Supabase Auth JWT (`auth.uid()`), while IAS 1 requires made-up email registration without external SMTP, username-or-email login, 3-strike lockouts, and OTP-gated password resets and email changes. Storing a separate `password_hash` only in `public.profiles` breaks `supabase.auth.signInWithPassword`. Instead, `auth.users` must remain the canonical store for `encrypted_password` and `email` (with Supabase email confirmation turned off so made-up emails receive a JWT immediately), while `public.profiles.email_verified` gates app access until the 6-digit OTP is verified. When a user resets their password, changes their email via OTP, or when an Admin creates a user, `SECURITY DEFINER` RPCs must update `auth.users` and `public.profiles` in the same database transaction.

3. **Unauthenticated Access to the Demo Project Mail Inbox on Forgot Password (`egm-comprehension` / `egm-design` — Blocker):**
   During the Forgot Password flow (and pre-session Confirm Email), the user is not logged in (`auth.uid()` is null). If `public.project_inbox_messages` relies on standard `auth.uid() = user_id` RLS, the in-app mail drawer will be empty during password reset. Because this is a classroom evaluator demo without external SMTP, inbox retrieval must use a scoped `SECURITY DEFINER` RPC (`rpc_get_project_inbox_messages(p_recipient_email, p_challenge_id)`) bound to the active email or challenge in client state so the evaluator sees the 6-digit OTP banner across Sign Up, Forgot Password, and Change Email.

4. **Database Restore vs. Append-Only `audit_events` and Foreign Keys (`egm-codebase-details` — Blocker):**
   `public.audit_events` forbids `UPDATE` and `DELETE`. If `audit_events.actor_user_id` or `database_backups.created_by_admin_id` has a strict foreign-key constraint referencing `public.profiles(id)`, deleting or rolling back user rows during a backup restore will fail with a foreign-key error or trigger an illegal cascade delete on `audit_events`. Both `audit_events.actor_user_id` and `database_backups.created_by_admin_id` must be stored as loose UUID columns without foreign-key constraints to `profiles`. During `rpc_admin_restore_backup`, the system must first save an automatic `pre_restore` snapshot, upsert domain tables in parent-to-child order, remove non-snapshot rows only from mutable child domain tables in child-to-parent order, and leave `audit_events` and `database_backups` untouched.

5. **PII Leak on Public Profile View (`egm-codebase-details` / `egm-zoom-out` — Major):**
   Allowing any authenticated or guest user to run `SELECT * FROM public.profiles` to render `app/profile/[id].tsx` exposes private columns (`date_of_birth`, `email`, `is_admin_locked`). Public profile lookups must flow through a safe view or RPC (`rpc_get_public_profile`) that returns only public marketplace fields.

6. **Evaluator Testing Bottleneck on the 15-Minute Idle Timer (`egm-comprehension` / `egm-implementation-readiness` — Major):**
   Waiting 13 minutes and 30 seconds during a live classroom defense to demonstrate the inactivity warning modal and 15-minute auto-logout is impractical. Alongside the real wall-clock 13m30s/15m00s timer in `InactivityGuard.tsx`, the Active Sessions screen (`app/settings/sessions.tsx`) should include a clearly labeled evaluator test control to fast-forward the idle timer to 13m25s so the warning countdown and auto-logout can be graded live in under 30 seconds.

7. **43-Screen Cold-Start Implementation Risk (`egm-zoom-out` / `egm-structural` — Major):**
   The workspace currently contains zero code files. Attempting to build all 43 screens without shared primitives for currency conversion (centavos to PHP), confirmation dialogs, status badges, and typed RPC wrappers will produce inconsistent validation and duplicated boilerplate. Execution must be staged in vertical slices: (1) Database Schema & Security RPCs, (2) Auth, Onboarding & Global Security Overlays, (3) Marketplace Core (Gigs, Agreements, Milestones, Payments, Reviews), (4) Chat, Notifications, Profile & Settings, and (5) Admin Governance, Log Trail & Backup/Restore.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * Implement all 9 Auth & Onboarding screens and 34 Main Application screens defined in the module specifications using Expo Router and TypeScript.
  * Enforce IAS 1 Checklists A–H server-side in PostgreSQL: unique username and made-up email validation, 18+ age gate, 5-rule live password policy, 6-digit hashed OTP lifecycle (`5m` expiry, max `3` attempts, `60s` resend cooldown, single-use), 3-strike login lockout (`1m -> 5m -> 15m`) with server-verified visual alphanumeric CAPTCHA, 15-minute inactivity auto-logout (`13m30s` warning), multi-tab session sync, append-only `audit_events`, and JSONB database backup/restore.
  * Enforce marketplace financial and contract invariants: integer centavo storage, milestone sum equal to agreement total, max 2 revisions per milestone with automatic dispute escalation on the failed 2nd revision, external payment tracking (`GCash`, `Maya`, `PayPal`, `Cash`), deterministic agreement completion when all milestones are approved and 100% of contract centavos are confirmed received, 14-day post-completion review window, separate freelancer and client ratings, and 7-day mode-switch cooldown with active-work blockers.
  * Implement deterministic, zero-LLM catalog skill suggestions and a rule-based profile legitimacy verification queue for `Super Admin`.

* **Out-of-Scope Non-Goals:**
  * External SMTP email delivery or third-party email APIs (SendGrid, Resend, Mailgun).
  * In-app wallet balances, simulated payment gateways, or automated escrow fund holding.
  * External paid LLM API dependencies (OpenAI, Gemini API keys) for skill suggestions or profile verification.
  * Simultaneous dual-role execution without switching active mode (`Find Work` vs. `Hire Someone`).

## Alternatives Weighed

1. **100% Custom Auth Table (`profiles.password_hash` + custom tokens) vs. Hybrid Supabase Auth (`auth.users` + PostgreSQL Security RPCs):**
   * *Rejected:* 100% custom table-based auth without `auth.users`. Bypassing Supabase Auth leaves `auth.uid()` null on the client, breaking native PostgreSQL Row-Level Security, Supabase Realtime subscriptions for chat and session sync, and Supabase Storage policies.
2. **External SMTP Email Delivery vs. Self-Hosted Project OTP + In-App Demo Mail Drawer:**
   * *Rejected:* External SMTP delivery. Free-tier SMTP providers block made-up test emails (`@gigormoc.ph`, `@ormoc.local`) and impose strict hourly rate limits that fail during classroom evaluation of Sign Up, Forgot Password, and Change Email.
3. **Destructive Table Truncation on Backup Restore vs. Topological Upsert + Loose Audit UUIDs:**
   * *Rejected:* Truncating all tables including `profiles` with hard foreign keys from `audit_events`. That approach violates the append-only rule on `public.audit_events` (`REVOKE UPDATE, DELETE`) and destroys the active Admin session executing the restore.
4. **External LLM Calls vs. Deterministic Rule Engine for Verification & Skill Suggestions:**
   * *Rejected:* Calling an external LLM API for `app/admin/verification.tsx` and `app/(onboarding)/step2-skills.tsx`. External API keys add quota failure modes and latency for features that are not required by the grading rubric and can be solved deterministically in SQL and TypeScript.
5. **Manual "Mark Agreement Completed" Button vs. Automatic State Predicate:**
   * *Rejected:* Allowing either party to manually mark an agreement completed. Manual completion allows contracts to close while milestones remain unapproved or external payments remain unconfirmed or disputed.

## Key Decisions & Staging for Next Steps

1. **Database & RPC Transaction Model:** Security RPCs must commit state updates (`failed_attempts`, `locked_until`, `attempts_used`, `audit_events`) and return structured `{ ok, code, message, ... }` JSONB responses rather than raising SQL exceptions for validation or authentication failures.
2. **Agreement & Milestone Resolution:** Agreements auto-complete only when every milestone is `approved` and `confirmed_received` external payments equal `total_amount_centavos`. Rejecting a milestone when `revision_count == 2` automatically transitions both the milestone and the agreement to `disputed` and creates an admin moderation report.
3. **Backup & Restore Boundary:** `public.audit_events` and `public.database_backups` use loose UUID references (`actor_user_id`, `created_by_admin_id`) without foreign-key constraints to `public.profiles`, ensuring restores never modify or delete audit logs or backup history.
4. **Evaluator Demo Ergonomics:** Mount `<ProjectMailInbox />` globally in `app/_layout.tsx` using `rpc_get_project_inbox_messages` so OTPs display across authenticated and unauthenticated flows, and provide an evaluator fast-forward trigger on `app/settings/sessions.tsx` to test the 13m30s/15m00s inactivity auto-logout during live grading.
