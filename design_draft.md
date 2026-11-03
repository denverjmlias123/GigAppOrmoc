# GigOrmoc Local Freelance Marketplace & Security Architecture

*   **Author:** John Denver Lias (`denverjmliaz`)
*   **Status:** Draft
*   **Date:** 2026-11-02

--------------------------------------------------------------------------------

## Overview

GigOrmoc is a cross-platform mobile and web freelance marketplace built for Ormoc City using Expo Router (React Native + TypeScript) and Supabase (PostgreSQL, Row-Level Security, Realtime, and Storage). The application connects local freelancers (`Find Work` mode) with local clients and small businesses (`Hire Someone` mode) across 43 screens while enforcing server-side Information Assurance and Security 1 (IAS 1 Checklists A–H) and Application Development 4th Increment requirements.

The platform operates with one active role mode at a time for regular users, separates administrative governance into a dedicated Admin portal (`Admin` and `Super Admin`), tracks milestone agreements and external payments (`GCash`, `Maya`, `PayPal`, `Cash`) in integer centavos without holding funds in escrow, and provides a self-hosted 6-digit OTP verification and demo mail inbox engine that works with made-up email addresses without external SMTP dependencies.

## The Problem

Local freelancers and small business clients in Ormoc City rely on informal social media posts and chat threads to find short-term work. These informal channels create four operational and security problems:

1.  **Unstructured Agreements and Payment Disputes:** Clients and freelancers lack written milestone breakdowns, revision limits, and payment receipts. Scope creep leads to endless unpaid revisions, and off-platform payments via GCash, Maya, or cash lack structured confirmation or dispute escalation.
2.  **Blurred Role Boundaries and Reputation Mixing:** When the same person both hires help and takes freelance gigs on general social platforms, their client history and freelancer reputation are mixed together, and nothing prevents self-dealing (applying to, hiring, or reviewing oneself).
3.  **Classroom Evaluation Failure Under External SMTP Limits:** Academic and local demonstration environments require testing dozens of account registrations, password resets, and email changes using made-up email addresses (such as `juan@gigormoc.ph` or `client1@ormoc.local`). Relying on third-party SMTP providers causes delivery failures and rate-limit blocks during live grading.
4.  **Client-Only Security Controls Bypassed at the API Layer:** Many student and prototype applications enforce login lockouts, OTP attempt counters, idle timeouts, and role checks only in React state. Refreshing the browser or calling the database API directly bypasses those checks, and throwing database exceptions rolls back security failure counters and audit logs.

GigOrmoc solves these problems by pairing a structured milestone-and-payment contract workflow with PostgreSQL `SECURITY DEFINER` RPCs that commit every security state change (`login_security_state`, `otp_challenges`, `user_sessions`, and append-only `audit_events`) inside the database while preserving native Supabase JWT authentication (`auth.users`) for Row-Level Security, Realtime chat, and file storage.

## Goals

*   **Complete 43-Screen Module Coverage:** Deliver all 9 Auth & Onboarding screens and all 34 Main Application screens (Main Tabs, Gigs, Agreements, Chat & Alerts, Profile, Disputes, Settings, and Admin) defined in [AUTH_ONBOARDING_LOGIC.md](file:///c:/Users/denverjmliaz/.opencode/plan/AUTH_ONBOARDING_LOGIC.md) and [MAIN_APP_LOGIC.md](file:///c:/Users/denverjmliaz/.opencode/plan/MAIN_APP_LOGIC.md).
*   **Self-Hosted 6-Digit OTP Engine Without External SMTP (IAS 1 Part B):** Support registration, password recovery, and email change for any syntactically valid, unique email address using server-generated, bcrypt-hashed 6-digit OTPs (`5-minute` expiry, maximum `3` wrong attempts, `60-second` resend cooldown, single-use) delivered to an in-app Top Push Mail Banner and Pull-Down Project Mail Inbox Drawer.
*   **Server-Persisted Login Lockout & Self-Generated Visual CAPTCHA (IAS 1 Part D):** Enforce 3-strike consecutive failed login tracking in PostgreSQL that escalates temporary lockouts (`1 minute` -> `5 minutes` -> `15 minutes`), survives page reloads and app restarts, and requires solving a server-verified, self-generated 6-character visual alphanumeric CAPTCHA after any lockout tier is reached.
*   **Password Policy & Session Governance (IAS 1 Parts C & E):** Enforce a 5-rule live password checklist (`>= 8` characters, uppercase, lowercase, number, special character), revoke all other active sessions upon password change or reset, synchronize logout across open browser tabs and devices, block Back-button access to protected routes after logout, and auto-logout inactive sessions at `15 minutes 00 seconds` (with a 90-second countdown modal at `13 minutes 30 seconds` plus an evaluator fast-forward test trigger).
*   **Deterministic Contract, Milestone & External Payment Integrity:** Store all monetary values in integer centavos (`bigint`), require milestone amounts to sum to the exact contract total, cap milestone revisions at `2` with automatic escalation to `disputed` status if a client rejects work after the 2nd revision, and transition agreements to `completed` only when all milestones are `approved` and `100%` of contract centavos are marked `confirmed_received`.
*   **Role Isolation & Mode-Switch Safeguards:** Enforce a single active mode (`Find Work` or `Hire Someone`) for regular users with a server-enforced 7-day switch cooldown, active contract/payment/report blockers, and atomic cancellation of open gigs or withdrawal of pending applications on mode switch. Isolate `Admin` and `Super Admin` users (`platform_admins`) into a dedicated governance dashboard.
*   **Append-Only Audit Trail & Non-Destructive Backup/Restore (IAS 1 Parts A, F & H):** Log all security, authentication, contract, and administrative events to an append-only `public.audit_events` table (with `UPDATE` and `DELETE` revoked and zero secrets logged), and provide scheduled, manual, and pre-restore JSONB database snapshots in `public.database_backups` that admins can restore without breaking foreign keys or modifying audit history.

## Non-Goals

*   **External Email Delivery:** Integrating external SMTP relays or commercial transactional email APIs (SendGrid, Resend, Mailgun).
*   **In-App Wallet or Escrow Holding:** Processing live credit cards, holding funds in escrow, or simulating fake wallet balances inside the application. All payments occur externally via GCash, Maya, PayPal, or Cash and are recorded as status transitions (`reported_sent`, `confirmed_received`, `disputed`).
*   **External LLM API Dependencies:** Calling paid or quota-limited external LLM APIs (OpenAI, Gemini) for skill suggestions or profile verification. Both features use deterministic local SQL and TypeScript rule engines.
*   **Simultaneous Dual-Mode Browsing:** Allowing a regular user account to post gigs as a Client and apply to gigs as a Freelancer at the same time without executing a mode switch.

## Open Questions

*   None. All architectural, state-machine, and grading-rubric questions were resolved during the `/egm-brainstorm` phase and documented in [concepts_brief.md](./concepts_brief.md).

## Critical User Journeys (CUJs)

### CUJ 1: First-Time User Registration, 18+ Gate, Project OTP Verification & Onboarding

*   **Given:** An unauthenticated guest opens GigOrmoc on mobile or web.
*   **When:** The guest completes Sign Up Step 1 (`app/(auth)/signup-step1.tsx`) with a unique username, display name, unique made-up email (e.g., `marco@gigormoc.ph`), and a password satisfying all 5 complexity rules, enters a Date of Birth >= 18 years old on Sign Up Step 2 (`app/(auth)/signup-step2.tsx`), views the 6-digit OTP inside the Top Push Mail Banner / Pull-Down Project Mail Inbox Drawer, submits the OTP on Confirm Email (`app/(auth)/confirm-email.tsx`) within 5 minutes, and completes Onboarding Steps 1–3 (`step1-mode.tsx`, `step2-skills.tsx`, `step3-profile.tsx`).
*   **Then:** The backend creates the user in `auth.users` and `public.profiles`, verifies the hashed OTP (`email_verified = true`, `status = 'used'`), saves the selected mode (`freelancer` or `client`) and Ormoc barangay profile details (`onboarding_completed = true`), writes audit events for each transition, and routes the user to `app/(tabs)/index.tsx`.

### CUJ 2: Progressive 3-Strike Login Lockout & Self-Generated Visual CAPTCHA

*   **Given:** A registered account exists with `failed_attempts = 0` and `lockout_tier = 0` in `public.login_security_state`.
*   **When:** A user submits 2 wrong passwords on `app/(auth)/login.tsx`, then submits a 3rd wrong password, reloads the app, waits for the 1-minute Tier 1 lockout timer to expire, and attempts to log in again.
*   **Then:** Attempts 1 and 2 commit to the database and display `"2 attempts remaining"` and `"1 attempt remaining"`. Attempt 3 sets `lockout_tier = 1`, `locked_until = now() + interval '1 minute'`, and `captcha_required = true`, and logs `ACCOUNT_LOCKED_TEMP`. Reloading the page preserves the live countdown timer. Once the 1-minute lockout expires, the Login screen requires solving a server-verified 6-character Visual Alphanumeric CAPTCHA alongside the password; 3 more failures escalate the lockout to `5 minutes` (Tier 2) and then `15 minutes` (Tier 3+), whereas a valid login resets all counters to zero.

### CUJ 3: Unauthenticated Forgot Password Recovery & Session Revocation

*   **Given:** A user is logged in on Device A, and opens `app/(auth)/forgot-password.tsx` as an unauthenticated guest on Device B.
*   **When:** The user enters their username or email in Stage 1, opens the Pull-Down Project Mail Inbox Drawer to view the generated `password_reset` 6-digit OTP, verifies the OTP in Stage 2, and submits a compliant new password in Stage 3.
*   **Then:** The backend marks the OTP `used`, updates `auth.users.encrypted_password`, marks every active row in `public.user_sessions` for that user as `is_revoked = true`, writes `PASSWORD_RESET_COMPLETED` and `SESSIONS_REVOKED_ON_PASSWORD_RESET` to `public.audit_events`, immediately terminates Device A's session via `SessionSyncGuard`, and redirects Device B to `app/(auth)/login.tsx`.

### CUJ 4: Milestone Agreement Execution, 2-Revision Cap & External Payment Completion

*   **Given:** A Client accepts a Freelancer's proposal on `app/gigs/[id]/applicants.tsx`, creating an active agreement (`total_amount_centavos = 500000` for PHP 5,000.00) with two milestones (`200000` and `300000` centavos).
*   **When:**
    1. *Happy Path:* The Freelancer submits work for both milestones, the Client approves both milestones (`revision_count <= 2`) and reports external GCash payments totaling `500000` centavos, and the Freelancer confirms receipt (`confirmed_received`).
    2. *Max-Revision Escalation Path:* Alternatively, on a milestone that already has `revision_count = 2`, the Client rejects the 3rd submission on `app/agreements/[id]/milestones/[milestoneId]/review.tsx`.
*   **Then:**
    1. In the Happy Path, confirming the final external payment automatically transitions `agreements.status` to `completed`, sets `completed_at = now()`, and unlocks the 14-day review window (`app/agreements/[id]/review.tsx`) for both parties.
    2. In the Max-Revision Escalation Path, rejecting the deliverable when `revision_count = 2` is blocked from requesting a 3rd revision and instead atomically transitions both the milestone and agreement to `disputed`, creates an admin moderation report in `public.reports`, and logs `AGREEMENT_AUTO_DISPUTED_MAX_REVISIONS`.

### CUJ 5: 15-Minute Inactivity Warning, Auto-Logout & Evaluator Fast-Forward

*   **Given:** An authenticated user is logged into the application with `InactivityGuard` and `SessionSyncGuard` active.
*   **When:** The user performs no touch, mouse, keyboard, or navigation activity for `13 minutes 30 seconds` (or clicks the evaluator fast-forward test button on `app/settings/sessions.tsx`), and does not click `"Stay Logged In"` before the 90-second countdown reaches `15 minutes 00 seconds`.
*   **Then:** At `13m 30s`, a modal displays a live 90-second countdown. At `15m 00s`, the app revokes the session in `public.user_sessions`, logs `AUTO_LOGOUT_INACTIVITY` in `public.audit_events`, broadcasts session termination to all open tabs, and redirects to `app/(auth)/login.tsx` with Back-button history cleared.

### CUJ 6: Admin Governance, Append-Only Audit Trail & Database Restore

*   **Given:** An authenticated `Admin` or `Super Admin` (`public.platform_admins`) opens `app/admin/dashboard.tsx`.
*   **When:** The Admin unlocks a temporarily locked user account in `app/admin/users/[id].tsx`, inspects the event in `app/admin/log-trail.tsx`, creates a manual backup in `app/admin/backups.tsx`, and restores an earlier backup snapshot after re-verifying their Admin password.
*   **Then:** Unlocking the user resets `login_security_state` and records `ADMIN_USER_UNLOCKED` in `public.audit_events`. The Security Log Trail displays the event with user, activity, timestamp, module, IP, and result, with zero edit/delete controls. Restoring the backup automatically saves a `pre_restore` snapshot first, restores the domain tables to the selected snapshot state without foreign-key errors, preserves all rows in `public.audit_events` and `public.database_backups`, and logs `DATABASE_RESTORED`.

--------------------------------------------------------------------------------

## Technical Plan (Architecture)

### 1. System Architecture & Hybrid Auth Model

GigOrmoc uses a two-layer backend model on Supabase (PostgreSQL 15+):

1.  **Identity & Transport Layer (`auth.users` + Supabase JWT):**
    *   Supabase Auth (`auth.users`) serves as the canonical password hash store (`encrypted_password` using `pgcrypto` bcrypt) and JWT issuer.
    *   External SMTP email confirmation in Supabase Auth is disabled (`email_confirm_at = now()` on creation) so that made-up email addresses (`@gigormoc.ph`, `@ormoc.local`, `@test.com`) immediately receive a valid JWT (`auth.uid()`) required by PostgreSQL Row-Level Security (RLS), Supabase Realtime channels, and Supabase Storage buckets.
    *   Application-level email verification is enforced separately via `public.profiles.email_verified` (default `false`), which blocks access to Onboarding and Main App routes and RLS write policies until a valid 6-digit OTP from `public.otp_challenges` is verified.
2.  **Transactional Security & Domain RPC Layer (`SECURITY DEFINER` PostgreSQL Functions):**
    *   All state-mutating security operations (registration, login lockout & CAPTCHA gating, OTP generation & verification, password reset & change, email change, session registration & revocation, mode switching, contract/milestone/payment transitions, and Admin user/backup management) execute inside `SECURITY DEFINER` PostgreSQL RPCs with `SET search_path = public, auth, extensions`.
    *   **Commit-on-Failure Envelope Rule:** In PostgreSQL, raising `RAISE EXCEPTION` rolls back the entire transaction—which would discard incremented `failed_attempts`, `locked_until`, `attempts_used`, and failure rows in `public.audit_events`. Therefore, every security and validation RPC commits normally and returns a structured JSONB envelope:
        ```json
        {
          "ok": false,
          "code": "INVALID_CREDENTIALS",
          "message": "Invalid username/email or password. 2 attempts remaining.",
          "remaining_attempts": 2,
          "locked_until": null,
          "lockout_tier": 0,
          "captcha_required": false
        }
        ```

```text
+-----------------------------------------------------------------------------------+
|                   CLIENT TIER (Expo Router: iOS / Android / Web)                  |
|                                                                                   |
|  +---------------------------+  +----------------------------------------------+  |
|  | Root Security Overlays    |  | Route Groups (43 Screens)                    |  |
|  | - ProjectMailInbox Drawer |  | - (auth): 6 screens     - (onboarding): 3    |  |
|  | - InactivityGuard (15m)   |  | - (tabs): 5 screens     - gigs: 4            |  |
|  | - SessionSyncGuard        |  | - agreements: 7 screens - chat/notif: 2      |  |
|  | - VisualCaptcha           |  | - profile/reports: 5    - settings: 4        |  |
|  |                           |  | - admin: 7 screens                           |  |
|  +-------------+-------------+  +----------------------+-----------------------+  |
|                |                                       |                          |
|                +-------------------+-------------------+                          |
|                                    | HTTPS (REST / RPC) + WSS (Realtime)          |
+------------------------------------+----------------------------------------------+
                                     v
+-----------------------------------------------------------------------------------+
|                        SUPABASE PLATFORM & POSTGRESQL TIER                        |
|                                                                                   |
|  +------------------------+  +-------------------------+  +--------------------+  |
|  | GoTrue Auth (JWT)      |  | Realtime Broadcast/CDC  |  | Storage Buckets    |  |
|  | auth.users / auth.uid()|  | - Direct Chat messages  |  | - avatars          |  |
|  +-----------+------------+  | - Session revocation    |  | - deliverables     |  |
|              |               | - Project Inbox banner  |  | - payment-proofs   |  |
|              v               +------------+------------+  +---------+----------+  |
|  +----------------------------------------+-------------------------+----------+  |
|  | PostgreSQL Row-Level Security (RLS) & SECURITY DEFINER RPC Engine           |  |
|  |                                                                             |  |
|  |  +--------------------------+  +-----------------------------------------+  |  |
|  |  | Security & Governance    |  | Marketplace Domain                      |  |  |
|  |  | - profiles               |  | - skills_catalog, user_skills           |  |  |
|  |  | - login_security_state   |  | - portfolio_items                       |  |  |
|  |  | - otp_challenges         |  | - gigs, applications                    |  |  |
|  |  | - project_inbox_messages |  | - agreements, milestones                |  |  |
|  |  | - user_sessions          |  | - external_payments, reviews            |  |  |
|  |  | - platform_admins        |  | - conversations, messages               |  |  |
|  |  | - audit_events (APPEND)  |  | - notifications, reports                |  |  |
|  |  | - database_backups       |  |                                         |  |  |
|  |  +--------------------------+  +-----------------------------------------+  |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

### 2. Standardized System Integration & Architecture (SIA) Diagrams

#### 2.1 Use Case Diagram (System Actors & Use Cases)

```mermaid
flowchart LR
    subgraph Actors["Primary & Secondary Actors"]
        Guest["Guest (Unauthenticated)"]
        Freelancer["Freelancer (Find Work Mode)"]
        Client["Client (Hire Someone Mode)"]
        Admin["Admin (platform_admins)"]
        SuperAdmin["Super Admin (platform_admins)"]
        ProjectMailer["Project Mail & OTP Engine (Secondary System Actor)"]
    end

    subgraph GigOrmocSystem["GigOrmoc System Boundary"]
        subgraph AuthUC["Auth & Onboarding Use Cases"]
            UC1["Register Account (Username, Made-Up Email, 18+ DOB)"]
            UC2["Verify 6-Digit Project OTP (5m Expiry, 3 Tries, 60s Cooldown)"]
            UC3["Login (3-Strike 1/5/15m Lockout + Server Visual CAPTCHA)"]
            UC4["Forgot / Reset Password & Revoke All Sessions"]
            UC5["Complete 3-Step Onboarding (Mode, Skills/Hiring, Profile)"]
        end

        subgraph MarketUC["Marketplace, Agreements & Chat Use Cases"]
            UC6["Browse & Search Ormoc Gigs"]
            UC7["Post / Edit Gig & Manage Applicants"]
            UC8["Apply / Submit Proposal"]
            UC9["Setup Milestones & Review Deliverable (Max 2 Revisions -> Auto-Dispute)"]
            UC10["Submit Milestone Work & Confirm/Dispute External Payment"]
            UC11["Leave Post-Completion Review (Within 14 Days)"]
            UC12["Exchange Real-Time Direct Chat & View Notifications"]
            UC13["File Moderation Report / Dispute"]
            UC14["Manage Settings (Switch Mode, Change Password/Email, Sessions)"]
        end

        subgraph AdminUC["Administration & Security Governance Use Cases"]
            UC15["Manage Users (CRUD, Activate/Deactivate, Lock/Unlock, Roles)"]
            UC16["View & Filter Append-Only Security Log Trail"]
            UC17["Run & Restore Scheduled/Manual JSONB Database Backups"]
            UC18["Process Deterministic Rule-Based Verification Queue"]
        end
    end

    Guest --> UC1
    Guest --> UC2
    Guest --> UC3
    Guest --> UC4

    UC1 --> ProjectMailer
    UC2 --> ProjectMailer
    UC4 --> ProjectMailer

    Freelancer --> UC5
    Freelancer --> UC6
    Freelancer --> UC8
    Freelancer --> UC10
    Freelancer --> UC11
    Freelancer --> UC12
    Freelancer --> UC13
    Freelancer --> UC14

    Client --> UC5
    Client --> UC6
    Client --> UC7
    Client --> UC9
    Client --> UC11
    Client --> UC12
    Client --> UC13
    Client --> UC14

    Admin --> UC15
    Admin --> UC16
    Admin --> UC17

    SuperAdmin --> UC15
    SuperAdmin --> UC16
    SuperAdmin --> UC17
    SuperAdmin --> UC18
```

#### 2.2 Swimlane System Flow Diagram

```mermaid
flowchart TD
    subgraph Pool_GigOrmoc["GigOrmoc End-to-End System Process Pool"]
        subgraph Lane_Guest["Lane 1: Guest / New User"]
            S1(["Start: Open GigOrmoc App"])
            S2["Submit Sign Up Step 1 (Username, Email, Password) & Step 2 (18+ DOB)"]
            S3["Open In-App Project Mail Inbox & Submit 6-Digit OTP"]
            S4["Complete Onboarding (Select Mode, Skills/Hiring Details, Area & Bio)"]
        end

        subgraph Lane_System["Lane 2: GigOrmoc Backend & Security Engine (PostgreSQL RPCs)"]
            B1{"Validate 18+ DOB, Unique Username/Email & Password Policy?"}
            B2["Create auth.users + profiles, Hash 6-Digit OTP, Dispatch Project Mail & Log Audit"]
            B3{"Verify OTP (Valid, <=5m, <3 Tries, Single-Use)?"}
            B4["Mark email_verified = true & Unlock Onboarding"]
            B5["Create Agreement, Enforce Milestone Sum == Contract Price & Log Audit"]
            B6{"All Milestones Approved AND 100% Payments Confirmed?"}
            B7["Auto-Transition Agreement to completed & Open 14-Day Review Window"]
        end

        subgraph Lane_Client["Lane 3: Client (Hire Someone Mode)"]
            C1["Post Local Gig (Budget in Centavos)"]
            C2["Review Proposals & Accept Applicant"]
            C3["Setup Milestones & Review Submitted Work (Max 2 Revisions)"]
            C4["Report External Payment (GCash/Maya/PayPal/Cash)"]
            C5["Leave Freelancer Review"]
        end

        subgraph Lane_Freelancer["Lane 4: Freelancer (Find Work Mode)"]
            F1["Browse Gigs & Submit Proposal"]
            F2["Submit Milestone Deliverable"]
            F3["Confirm External Payment Received (or Dispute)"]
            F4["Leave Client Review"]
        end

        subgraph Lane_Admin["Lane 5: Admin / Super Admin"]
            A1["Monitor Append-Only Log Trail, Lockouts, Reports, Verification & DB Backups"]
            E1(["End: Completed & Audited Lifecycle"])
        end
    end

    S1 --> S2 --> B1
    B1 -- "Invalid / Under 18" --> S2
    B1 -- "Valid" --> B2 --> S3 --> B3
    B3 -- "Invalid / Expired" --> S3
    B3 -- "Verified" --> B4 --> S4
    S4 --> C1
    S4 --> F1
    C1 --> F1 --> C2 --> B5 --> C3 --> F2 --> C3 --> C4 --> F3 --> B6
    B6 -- "No" --> C3
    B6 -- "Yes" --> B7 --> C5 & F4 --> A1 --> E1
```

#### 2.3 Entity Relationship Diagram (ERD)

> [!NOTE]
> `AUDIT_EVENTS.actor_user_id` and `DATABASE_BACKUPS.created_by_admin_id` intentionally omit foreign-key constraints to `PROFILES.id` so that non-destructive domain table restores never violate the append-only constraint on `AUDIT_EVENTS` or fail on foreign-key checks.

```mermaid
erDiagram
    PROFILES ||--o| LOGIN_SECURITY_STATE : "has security state"
    PROFILES ||--o{ OTP_CHALLENGES : "requests OTPs"
    PROFILES ||--o{ PROJECT_INBOX_MESSAGES : "receives in-app mail"
    PROFILES ||--o{ USER_SESSIONS : "maintains sessions"
    PROFILES ||--o| PLATFORM_ADMINS : "granted admin tier"
    PROFILES ||--o{ USER_SKILLS : "has freelancer skills"
    SKILLS_CATALOG ||--o{ USER_SKILLS : "categorizes"
    PROFILES ||--o{ PORTFOLIO_ITEMS : "showcases"
    PROFILES ||--o{ GIGS : "posts as client"
    GIGS ||--o{ APPLICATIONS : "receives proposals"
    PROFILES ||--o{ APPLICATIONS : "submits as freelancer"
    APPLICATIONS ||--o| AGREEMENTS : "accepted into 1 contract"
    AGREEMENTS ||--|{ MILESTONES : "divided into"
    AGREEMENTS ||--o{ EXTERNAL_PAYMENTS : "tracks payments"
    AGREEMENTS ||--o{ REVIEWS : "rated by both parties"
    APPLICATIONS ||--o| CONVERSATIONS : "initiates chat"
    CONVERSATIONS ||--o{ MESSAGES : "contains"
    PROFILES ||--o{ NOTIFICATIONS : "receives"
    PROFILES ||--o{ REPORTS : "files or targets"

    PROFILES {
        uuid id PK "Matches auth.users.id"
        text username UK "3-20 chars, lowercase/num/underscore"
        text email UK "Unique, made-up email allowed"
        text display_name
        date date_of_birth "18+ enforced, private"
        text phone "Optional, private"
        text active_mode "freelancer | client"
        timestamptz last_mode_switch_at
        boolean email_verified
        boolean onboarding_completed
        integer onboarding_step "1, 2, or 3"
        boolean is_active "Admin activate/deactivate"
        boolean is_admin_locked "Admin manual lock"
        text verification_status "unsubmitted | pending | verified | rejected"
        integer legitimacy_score "0 to 100 rule score"
        text verification_notes
        text area_barangay
        text bio
        text avatar_url
        text client_type "individual | business"
        text business_name
        text[] hiring_interests
        numeric freelancer_rating_avg
        integer freelancer_review_count
        numeric client_rating_avg
        integer client_review_count
        timestamptz created_at
        timestamptz updated_at
    }

    LOGIN_SECURITY_STATE {
        uuid user_id PK,FK
        integer failed_attempts "0 to 3"
        integer lockout_tier "0=none, 1=1m, 2=5m, 3=15m"
        timestamptz locked_until
        boolean captcha_required
        text active_captcha_hash "Bcrypt hash of 6-char code"
        timestamptz updated_at
    }

    OTP_CHALLENGES {
        uuid id PK
        uuid user_id FK
        text target_email
        text purpose "signup_verification | password_reset | email_change"
        text otp_hash "Bcrypt hash of 6-digit OTP"
        integer attempts_used "0 to 3"
        timestamptz expires_at "created_at + 5m"
        timestamptz resend_available_at "created_at + 60s"
        timestamptz consumed_at
        text status "active | used | invalidated | expired"
        timestamptz created_at
    }

    PROJECT_INBOX_MESSAGES {
        uuid id PK
        uuid user_id FK
        uuid otp_challenge_id FK
        text recipient_email
        text purpose
        text subject
        text otp_code_display "6-digit code for Demo Mail Drawer"
        timestamptz expires_at
        boolean is_read
        timestamptz created_at
    }

    USER_SESSIONS {
        uuid id PK
        uuid user_id FK
        text session_token_fingerprint
        text device_info
        text ip_address
        boolean is_revoked
        text revoked_reason
        timestamptz last_active_at "Updated on activity; 15m timeout"
        timestamptz expires_at
        timestamptz created_at
    }

    PLATFORM_ADMINS {
        uuid user_id PK,FK
        text role "admin | super_admin"
        uuid assigned_by
        timestamptz created_at
    }

    SKILLS_CATALOG {
        uuid id PK
        text name UK
        text category
        text[] keywords
    }

    USER_SKILLS {
        uuid id PK
        uuid user_id FK
        uuid skill_id FK
        text skill_name
        timestamptz created_at
    }

    PORTFOLIO_ITEMS {
        uuid id PK
        uuid user_id FK
        text title
        text description
        text media_url
        text project_link
        timestamptz created_at
    }

    GIGS {
        uuid id PK
        uuid client_id FK
        text title
        text category
        text description
        bigint budget_centavos "CHECK > 0"
        text budget_type "fixed | hourly"
        text location_barangay
        text[] required_skills
        text status "open | in_progress | completed | cancelled"
        timestamptz created_at
        timestamptz updated_at
    }

    APPLICATIONS {
        uuid id PK
        uuid gig_id FK
        uuid freelancer_id FK
        text cover_letter
        bigint proposed_rate_centavos "CHECK > 0"
        integer estimated_days "CHECK > 0"
        text status "pending | accepted | rejected | withdrawn"
        timestamptz created_at
    }

    AGREEMENTS {
        uuid id PK
        uuid gig_id FK
        uuid application_id UK,FK
        uuid client_id FK
        uuid freelancer_id FK
        bigint total_amount_centavos "CHECK > 0"
        text terms_summary
        text status "active | completed | disputed | cancelled"
        timestamptz completed_at
        timestamptz created_at
    }

    MILESTONES {
        uuid id PK
        uuid agreement_id FK
        integer sequence_order
        text title
        text description
        bigint amount_centavos "Sum == agreements.total_amount_centavos"
        integer revision_count "0 to 2 (CHECK <= 2)"
        text submission_notes
        text submission_proof_url
        text client_feedback
        text status "pending | submitted | revision_requested | approved | disputed"
        timestamptz due_date
        timestamptz created_at
    }

    EXTERNAL_PAYMENTS {
        uuid id PK
        uuid agreement_id FK
        uuid milestone_id FK
        uuid reported_by_client_id FK
        text payment_method "GCash | Maya | PayPal | Cash"
        bigint amount_centavos "CHECK > 0"
        text reference_number
        text proof_url
        text dispute_reason
        text status "reported_sent | confirmed_received | disputed"
        timestamptz confirmed_at
        timestamptz created_at
    }

    REVIEWS {
        uuid id PK
        uuid agreement_id FK
        uuid reviewer_id FK
        uuid reviewee_id FK
        text target_role "freelancer | client"
        integer rating "CHECK BETWEEN 1 AND 5"
        text comment
        timestamptz created_at
    }

    CONVERSATIONS {
        uuid id PK
        uuid gig_id FK
        uuid application_id FK
        uuid agreement_id FK
        uuid client_id FK
        uuid freelancer_id FK
        timestamptz last_message_at
        timestamptz created_at
    }

    MESSAGES {
        uuid id PK
        uuid conversation_id FK
        uuid sender_id FK
        text body
        text attachment_url
        boolean is_read
        timestamptz created_at
    }

    NOTIFICATIONS {
        uuid id PK
        uuid user_id FK
        text title
        text body
        text notification_type
        text target_route
        boolean is_read
        timestamptz created_at
    }

    REPORTS {
        uuid id PK
        uuid reporter_id FK
        uuid target_user_id FK
        uuid target_gig_id FK
        uuid target_agreement_id FK
        text category
        text description
        text evidence_url
        text status "pending | reviewed | dismissed | action_taken"
        text admin_resolution_notes
        uuid resolved_by_admin_id
        timestamptz created_at
    }

    AUDIT_EVENTS {
        uuid id PK
        uuid actor_user_id "Loose UUID (no FK)"
        text actor_identifier
        text activity
        text affected_module "AUTH | ONBOARDING | GIGS | AGREEMENTS | CHAT | PROFILE | DISPUTES | SETTINGS | ADMIN | BACKUP"
        text ip_address
        text result "SUCCESS | FAILURE | LOCKED | BLOCKED"
        jsonb metadata "Redacted: zero secrets/hashes/OTPs/tokens"
        timestamptz created_at
    }

    DATABASE_BACKUPS {
        uuid id PK
        uuid created_by_admin_id "Loose UUID (no FK)"
        text created_by_identifier
        text backup_type "scheduled | manual | pre_restore"
        text label
        text checksum_sha256
        jsonb table_row_counts
        jsonb snapshot_payload
        timestamptz created_at
    }
```

#### 2.4 System Flowchart

```mermaid
flowchart TD
    Start(["Start: User Opens GigOrmoc App"]) --> CheckSession{"Valid Active Session in DB?"}

    CheckSession -- "No" --> AuthScreen["Show Welcome / Login / Sign Up"]
    AuthScreen --> ActionChoice{"Login, Sign Up, or Forgot Password?"}

    ActionChoice -- "Sign Up" --> Step1["Input Username, Display Name, Made-Up Email, 5-Rule Password, Terms"]
    Step1 --> Step2["Input Date of Birth (DOB)"]
    Step2 --> AgeCheck{"Age >= 18?"}
    AgeCheck -- "No" --> RejectUnderage["Show 18+ Blocker & Commit Audit Event"] --> AuthScreen
    AgeCheck -- "Yes" --> CreateAcc["Create auth.users + profiles + 6-Digit Project OTP"] --> OTPFlow

    ActionChoice -- "Forgot Password" --> FP1["Input Username or Email -> Generate password_reset OTP"]
    FP1 --> FP2["Verify 6-Digit OTP from Project Mail Inbox"]
    FP2 --> FP3["Set New 5-Rule Password & Revoke All user_sessions"] --> AuthScreen

    ActionChoice -- "Login" --> LockCheck{"Is Account Locked (1m/5m/15m)?"}
    LockCheck -- "Yes" --> ShowLockTimer["Show Live Lockout Countdown Timer"] --> AuthScreen
    LockCheck -- "No" --> CaptchaCheck{"Post-Lockout CAPTCHA Required?"}
    CaptchaCheck -- "Yes" --> VerifyCaptcha{"Server Visual CAPTCHA Valid?"}
    VerifyCaptcha -- "No" --> AuthScreen
    VerifyCaptcha -- "Yes" --> CredCheck
    CaptchaCheck -- "No" --> CredCheck{"Verify Username/Email & Password via RPC"}

    CredCheck -- "Invalid" --> IncFail["Commit Failed Attempt +1 in DB & Audit Event"]
    IncFail --> ThreeStrikes{"Failed Attempts == 3?"}
    ThreeStrikes -- "Yes" --> EscalateLock["Lock Account (1m -> 5m -> 15m) & Require CAPTCHA Next"] --> ShowLockTimer
    ThreeStrikes -- "No" --> ShowRemaining["Show Remaining Attempts (2 or 1)"] --> AuthScreen

    CredCheck -- "Valid" --> ResetFail["Reset Failed Attempts, Sign In JWT & Register Tracked Session"]
    ResetFail --> CheckSession

    CheckSession -- "Yes" --> IdleCheck{"Inactive >= 15 Minutes (or Session Revoked)?"}
    IdleCheck -- "Yes" --> AutoLogout["Revoke Session, Commit AUTO_LOGOUT_INACTIVITY & Replace Route to Login"] --> AuthScreen
    IdleCheck -- "No" --> EmailVerCheck{"profiles.email_verified == true?"}

    EmailVerCheck -- "No" --> OTPFlow["Show Confirm Email + In-App Project Mail Inbox Drawer"]
    OTPFlow --> OTPValid{"6-Digit OTP Valid, <=5m & <3 Tries?"}
    OTPValid -- "No" --> OTPFlow
    OTPValid -- "Yes" --> MarkVerified["Set email_verified = true & Mark OTP used"] --> AdminCheck

    EmailVerCheck -- "Yes" --> AdminCheck{"User in platform_admins?"}
    AdminCheck -- "Yes" --> AdminDash["Route to Admin Dashboard (Users, Log Trail, Verification, Backups)"] --> EndNode(["Active Session Loop"])

    AdminCheck -- "No" --> OnboardCheck{"onboarding_completed == true?"}
    OnboardCheck -- "No" --> OnboardFlow["Complete Step 1 (Mode), Step 2 (Skills/Hiring), Step 3 (Profile)"] --> MainTabs
    OnboardCheck -- "Yes" --> MainTabs["Route to Role-Aware Main App Tabs (Freelancer or Client)"] --> EndNode
```

#### 2.5 Network Diagram (Network Flow)

```mermaid
flowchart LR
    subgraph ClientTier["Client Access Tier (Ormoc Users & Evaluators)"]
        MobileFreelancer["Freelancer Client (Expo iOS/Android/Web)"]
        MobileClient["Client Business User (Expo iOS/Android/Web)"]
        AdminWorkstation["Admin / Evaluator Workstation (Web / Mobile)"]
    end

    subgraph NetworkEdge["Local & Edge Network Infrastructure"]
        WiFiRouter["WLAN Router / Cellular 4G/5G Gateway"]
        FirewallTLS["HTTPS / TLS 1.3 & WSS Encrypted Tunnel"]
    end

    subgraph SupabaseCloud["Application Backend & Security Tier (Supabase Platform)"]
        APIGateway["Kong API Gateway & Rate Limiter"]
        AuthService["GoTrue Auth Service (JWT Issuance)"]
        RealtimeEngine["Supabase Realtime Server (Direct Chat, Session Revocation & Inbox Sync)"]
        StorageService["Private Object Storage (Avatars, Deliverables, Payment Proofs)"]
    end

    subgraph DatabaseTier["Database & Governance Tier (PostgreSQL)"]
        RLSGuard["Row-Level Security (RLS) & Parameterized Query Layer"]
        RPCEngine["SECURITY DEFINER RPC Engine (OTP, 1/5/15m Lockout, CAPTCHA, Contracts, Backups)"]
        PrimaryDB[("Primary PostgreSQL DB (20 Domain & Security Tables)")]
        AuditStore[("Append-Only Audit Trail (public.audit_events)")]
        BackupStore[("Scheduled & Manual Backup Vault (public.database_backups)")]
    end

    MobileFreelancer & MobileClient & AdminWorkstation <-->|"HTTPS / WSS"| WiFiRouter
    WiFiRouter <-->|"TLS 1.3"| FirewallTLS
    FirewallTLS <--> APIGateway

    APIGateway <--> AuthService
    APIGateway <--> RealtimeEngine
    APIGateway <--> StorageService
    APIGateway <--> RLSGuard

    RLSGuard <--> RPCEngine
    RLSGuard <--> PrimaryDB
    RPCEngine --> PrimaryDB
    RPCEngine -->|"Append-Only INSERT"| AuditStore
    RPCEngine <-->|"Topological JSONB Snapshot / Restore"| BackupStore
    RealtimeEngine <--> PrimaryDB
```

---

### 3. Security, Contract & Admin RPC Specifications

#### 3.1 Authentication, OTP, Lockout & CAPTCHA RPCs (`001_core_security_and_auth.sql`)

1.  **`rpc_check_signup_availability(p_username text, p_email text)`**:
    *   Validates `p_username ~ '^[a-z0-9_]{3,20}$'` and syntactic email format `p_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'`.
    *   Returns `{ ok, username_available, email_available, message }` for Sign Up Step 1 before advancing to Step 2.
2.  **`rpc_complete_signup_and_issue_otp(p_user_id uuid, p_username text, p_display_name text, p_email text, p_dob date)`**:
    *   Enforces the 18+ age check server-side (`age(current_date, p_dob) >= interval '18 years'`). If under 18, logs `USER_SIGNUP_REJECTED_UNDERAGE` to `audit_events`, deletes the unverified auth record, and returns `{ ok: false, code: 'UNDERAGE_18_PLUS' }`.
    *   Inserts `public.profiles` (`email_verified = false`, `onboarding_completed = false`, `onboarding_step = 1`) and `public.login_security_state`.
    *   Calls internal helper `internal_issue_otp_challenge(p_user_id, p_email, 'signup_verification')`, which generates a random 6-digit integer (`floor(random() * 900000 + 100000)::text`), stores `crypt(code, gen_salt('bf'))` in `public.otp_challenges` (`expires_at = now() + interval '5 minutes'`, `resend_available_at = now() + interval '60 seconds'`, `attempts_used = 0`, `status = 'active'`), inserts the simulated message into `public.project_inbox_messages`, and logs `USER_SIGNUP_COMPLETED` and `OTP_GENERATED`.
3.  **`rpc_generate_otp(p_identifier text, p_purpose text, p_target_email text DEFAULT NULL)`**:
    *   Supports `signup_verification`, `password_reset`, and `email_change`.
    *   Checks if an active OTP for `(target_email, purpose)` has `now() < resend_available_at`; if so, returns `{ ok: false, code: 'RESEND_COOLDOWN', resend_available_at }`.
    *   Marks any previous `active` OTP for `(target_email, purpose)` as `invalidated`, generates a fresh 6-digit OTP hash + `project_inbox_messages` entry, logs `OTP_GENERATED`, and returns `{ ok: true, challenge_id, target_email, expires_at, resend_available_at }`.
4.  **`rpc_get_project_inbox_messages(p_recipient_email text DEFAULT NULL, p_challenge_id uuid DEFAULT NULL)`**:
    *   `SECURITY DEFINER` read helper for `<ProjectMailInbox />`. Returns recent rows from `public.project_inbox_messages` matching either the authenticated user (`auth.uid()`) OR the active `p_recipient_email` / `p_challenge_id` during unauthenticated `Confirm Email` and `Forgot Password` flows.
5.  **`rpc_verify_otp(p_challenge_id uuid, p_otp_code text)`**:
    *   Locks the `otp_challenges` row `FOR UPDATE`.
    *   If `status != 'active'` or `consumed_at IS NOT NULL`, returns `{ ok: false, code: 'OTP_ALREADY_USED_OR_INVALID' }`.
    *   If `now() > expires_at`, updates `status = 'expired'`, logs `OTP_FAILED`, and returns `{ ok: false, code: 'OTP_EXPIRED' }`.
    *   If `otp_hash != crypt(trim(p_otp_code), otp_hash)`, increments `attempts_used = attempts_used + 1`. If `attempts_used >= 3`, sets `status = 'invalidated'` and logs `OTP_INVALIDATED`; otherwise logs `OTP_FAILED`. Returns `{ ok: false, code: 'OTP_MISMATCH', remaining_attempts: 3 - attempts_used }`.
    *   On match: sets `status = 'used'`, `consumed_at = now()`. If `purpose = 'signup_verification'`, sets `profiles.email_verified = true`. Logs `OTP_VERIFIED` and returns `{ ok: true, purpose, user_id, target_email }`.
6.  **`rpc_generate_captcha(p_identifier text)`**:
    *   Generates a 6-character code from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, stores `crypt(upper(code), gen_salt('bf'))` in `login_security_state.active_captcha_hash`, and returns `{ ok: true, captcha_code: code }` for `<VisualCaptcha />`.
7.  **`rpc_verify_credentials_and_gate(p_identifier text, p_password text, p_captcha_input text DEFAULT NULL)`**:
    *   Looks up `profiles` by `lower(username) = lower(trim(p_identifier))` or `lower(email) = lower(trim(p_identifier))`.
    *   Checks `is_active` and `is_admin_locked`; if deactivated or admin-locked, logs `LOGIN_FAILED` (`LOCKED`) and returns `{ ok: false, code: 'ACCOUNT_ADMIN_LOCKED_OR_INACTIVE' }`.
    *   Checks `login_security_state.locked_until > now()`; if locked, returns `{ ok: false, code: 'TEMP_LOCKED', locked_until, lockout_tier }`.
    *   If `login_security_state.captcha_required = true`: verifies `active_captcha_hash = crypt(upper(trim(coalesce(p_captcha_input, ''))), active_captcha_hash)`. On mismatch, logs `CAPTCHA_FAILED`, rotates the CAPTCHA, and returns `{ ok: false, code: 'CAPTCHA_INVALID', captcha_required: true }`. On match, logs `CAPTCHA_VERIFIED`.
    *   Verifies password against `auth.users.encrypted_password = crypt(p_password, encrypted_password)`.
    *   **On Password Mismatch:** Increments `failed_attempts = failed_attempts + 1`.
        *   If `failed_attempts < 3`: commits `failed_attempts`, logs `LOGIN_FAILED`, and returns `{ ok: false, code: 'INVALID_CREDENTIALS', remaining_attempts: 3 - failed_attempts, captcha_required }`.
        *   If `failed_attempts >= 3`: increments `lockout_tier = lockout_tier + 1`, resets `failed_attempts = 0`, sets `captcha_required = true`, computes `locked_until = now() + (CASE WHEN lockout_tier = 1 THEN interval '1 minute' WHEN lockout_tier = 2 THEN interval '5 minutes' ELSE interval '15 minutes' END)`, logs `ACCOUNT_LOCKED_TEMP`, and returns `{ ok: false, code: 'TEMP_LOCKED', locked_until, lockout_tier, captcha_required: true }`.
    *   **On Password Match:** Resets `failed_attempts = 0`, `lockout_tier = 0`, `locked_until = NULL`, `captcha_required = false`, `active_captcha_hash = NULL`, logs `LOGIN_SUCCESS`, and returns `{ ok: true, email: profile.email, user_id: profile.id, email_verified: profile.email_verified, onboarding_completed: profile.onboarding_completed, onboarding_step: profile.onboarding_step }`.
8.  **`rpc_reset_password_with_otp(p_challenge_id uuid, p_otp_code text, p_new_password text)`**:
    *   Verifies the `password_reset` OTP (or accepts an already-verified challenge token within 5 minutes), validates `p_new_password` against all 5 password complexity rules server-side (`length >= 8`, `[A-Z]`, `[a-z]`, `[0-9]`, special character), updates `auth.users.encrypted_password = crypt(p_new_password, gen_salt('bf'))`, sets `is_revoked = true` on **all** rows in `public.user_sessions` for that user, resets `login_security_state`, and logs `PASSWORD_RESET_COMPLETED` and `SESSIONS_REVOKED_ON_PASSWORD_RESET`.
9.  **`rpc_change_password(p_current_password text, p_new_password text, p_current_session_id uuid)`**:
    *   Verifies `p_current_password` against `auth.users.encrypted_password`, ensures `p_new_password != p_current_password`, enforces all 5 password complexity rules, updates `auth.users.encrypted_password`, sets `is_revoked = true` on all `public.user_sessions` for `auth.uid()` where `id != p_current_session_id`, and logs `PASSWORD_CHANGED` and `OTHER_SESSIONS_REVOKED`.
10. **`rpc_request_email_change(p_current_password text, p_new_email text)` & `rpc_confirm_email_change(p_challenge_id uuid, p_otp_code text)`**:
    *   Step 1 verifies `p_current_password`, checks syntactic validity and uniqueness of `p_new_email`, and dispatches a 6-digit `email_change` OTP to `<ProjectMailInbox />`.
    *   Step 2 verifies the 6-digit OTP and atomically updates both `auth.users.email` and `public.profiles.email`, logging `EMAIL_CHANGED`.

#### 3.2 Marketplace, Contract & Mode-Switch RPCs (`002_marketplace_agreements_and_admin.sql`)

1.  **`rpc_accept_application(p_application_id uuid, p_terms_summary text)`**:
    *   Verifies caller is the Client owner of the gig in `client` mode and `client_id != freelancer_id` (own-content rule).
    *   Marks the application `accepted`, transitions `gigs.status = 'in_progress'`, creates the row in `public.agreements` (`total_amount_centavos = proposed_rate_centavos`, `status = 'active'`), ensures a row in `public.conversations` exists for the pair, notifies the Freelancer, and logs `AGREEMENT_CREATED`.
2.  **`rpc_setup_milestones(p_agreement_id uuid, p_milestones jsonb)`**:
    *   Verifies caller is the Agreement Client.
    *   Validates that every milestone has `amount_centavos > 0` and that `SUM(amount_centavos) == agreements.total_amount_centavos`. Rejects mismatches with `{ ok: false, code: 'MILESTONE_SUM_MISMATCH' }`.
3.  **`rpc_review_milestone(p_milestone_id uuid, p_decision text, p_feedback text)`**:
    *   `p_decision` is `'approve'` or `'request_revision'`.
    *   If `'approve'`: sets `milestones.status = 'approved'`, evaluates `internal_check_agreement_completion(agreement_id)` (which sets `agreements.status = 'completed'` and `completed_at = now()` if and only if all milestones are `approved` AND `SUM(confirmed_received payments) == agreements.total_amount_centavos`).
    *   If `'request_revision'`:
        *   When `revision_count < 2`: increments `revision_count = revision_count + 1`, sets `milestones.status = 'revision_requested'`, saves `client_feedback`, and notifies the Freelancer.
        *   When `revision_count == 2` (2nd revision already used): atomically transitions `milestones.status = 'disputed'` and `agreements.status = 'disputed'`, inserts an escalated dispute in `public.reports` (`category = 'milestone_max_revisions_exceeded'`), notifies both parties and Admins, and logs `AGREEMENT_AUTO_DISPUTED_MAX_REVISIONS`.
4.  **`rpc_report_external_payment(...)`, `rpc_confirm_external_payment(p_payment_id uuid)`, & `rpc_dispute_external_payment(p_payment_id uuid, p_reason text)`**:
    *   Client reports payment sent via `GCash`, `Maya`, `PayPal`, or `Cash` (`status = 'reported_sent'`).
    *   Freelancer confirming receipt sets `status = 'confirmed_received'`, `confirmed_at = now()`, and triggers `internal_check_agreement_completion(agreement_id)`.
    *   Freelancer disputing payment sets `external_payments.status = 'disputed'`, `agreements.status = 'disputed'`, creates a moderation record in `public.reports`, and logs `PAYMENT_DISPUTED`.
5.  **`rpc_submit_review(p_agreement_id uuid, p_rating integer, p_comment text)`**:
    *   Verifies `agreements.status = 'completed'`, `now() <= agreements.completed_at + interval '14 days'`, caller is `client_id` or `freelancer_id`, and no prior review from caller exists for `p_agreement_id`.
    *   Inserts into `public.reviews` with `target_role = ('freelancer' if caller is client else 'client')` and recalculates `freelancer_rating_avg` / `freelancer_review_count` or `client_rating_avg` / `client_review_count` on `public.profiles`.
6.  **`rpc_switch_user_mode(p_target_mode text)`**:
    *   Enforces all 5 server-side blockers: (a) `last_mode_switch_at IS NULL OR now() - last_mode_switch_at >= interval '7 days'`, (b) zero `active` or `disputed` agreements, (c) zero `reported_sent` or `disputed` external payments, (d) zero `pending` moderation reports targeting the user, and (e) `is_active = true AND is_admin_locked = false`.
    *   Atomically cancels open gigs (if switching from `client`) or withdraws pending applications (if switching from `freelancer`), updates `active_mode` and `last_mode_switch_at = now()`, and logs `MODE_SWITCHED`.

#### 3.3 Admin Governance, Audit Trail & Backup/Restore RPCs

1.  **`rpc_admin_create_user(...)` & `rpc_admin_manage_user(...)`**:
    *   Verifies caller exists in `public.platform_admins`.
    *   `rpc_admin_create_user` inserts directly into `auth.users`, `auth.identities`, `public.profiles`, and `public.login_security_state` (plus `public.platform_admins` if role is `admin` or `super_admin`), preserving the caller Admin's JWT session.
    *   `rpc_admin_manage_user` supports `update_profile`, `set_active` (revoking sessions if deactivated), `set_admin_lock`, `unlock_temp_lockout` (resetting `failed_attempts = 0`, `lockout_tier = 0`, `locked_until = NULL`, `captcha_required = false`), and `assign_role` (enforcing that only `super_admin` can grant/revoke `super_admin`).
2.  **`rpc_admin_create_backup(p_label text, p_backup_type text DEFAULT 'manual')`**:
    *   Serializes the 16 mutable domain tables into `snapshot_payload` JSONB, computes per-table row counts in `table_row_counts`, calculates `checksum_sha256 = encode(digest(snapshot_payload::text, 'sha256'), 'hex')`, inserts into `public.database_backups`, and logs `DATABASE_BACKUP_CREATED` in `public.audit_events`.
3.  **`rpc_admin_restore_backup(p_backup_id uuid, p_admin_password text)`**:
    *   Verifies caller is in `public.platform_admins` and verifies `p_admin_password` against `auth.users.encrypted_password`.
    *   Step 1: Calls `rpc_admin_create_backup('Auto Pre-Restore Snapshot', 'pre_restore')` so the state immediately before restore is preserved.
    *   Step 2: Upserts snapshot rows in topological parent-first order (`profiles` -> `login_security_state` -> `platform_admins` -> `skills_catalog` -> `user_skills` -> `portfolio_items` -> `gigs` -> `applications` -> `agreements` -> `milestones` -> `external_payments` -> `reviews` -> `conversations` -> `messages` -> `notifications` -> `reports`).
    *   Step 3: Deletes rows created after the snapshot from mutable child domain tables in reverse topological order (`messages` -> `conversations` -> `reviews` -> `external_payments` -> `milestones` -> `agreements` -> `applications` -> `gigs` -> `portfolio_items` -> `user_skills` -> `reports` -> `notifications`), while keeping `public.audit_events`, `public.database_backups`, and the executing Admin's `auth.users` / `user_sessions` rows intact.
    *   Step 4: Logs `DATABASE_RESTORED` to `public.audit_events`.

--------------------------------------------------------------------------------

## Alternatives Considered

### Alternative A: 100% Custom Table-Based Auth (`public.profiles.password_hash` Without `auth.users`)

*   **Pros:** Eliminates any need to synchronize `auth.users` and `public.profiles` during registration, password resets, email changes, or Admin user creation.
*   **Cons:** Leaves `auth.uid()` null on every client request (`anon` role), which disables native PostgreSQL Row-Level Security policies, blocks authenticated Supabase Realtime channel subscriptions for direct chat and session revocation, and prevents user-scoped Supabase Storage bucket policies.
*   **Reason for Rejection:** Using Supabase Realtime, Storage, and RLS requires a valid GoTrue JWT (`auth.uid()`). Keeping `auth.users` as the canonical password and JWT authority while gating application state in `public.profiles` and `SECURITY DEFINER` RPCs preserves full RLS and Realtime functionality.

### Alternative B: External SMTP Email Delivery for OTP Verification

*   **Pros:** Delivers 6-digit verification codes to external third-party email inboxes (Gmail, Outlook, Yahoo).
*   **Cons:** Rejects or bounces made-up classroom test emails (`@gigormoc.ph`, `@ormoc.local`), enforces strict hourly sending limits on free tiers, and introduces external network latency during live defense evaluations.
*   **Reason for Rejection:** IAS 1 and AppDev final checking require rapid testing of multiple accounts, password resets, and email changes using made-up emails. Generating bcrypt-hashed 6-digit OTPs inside PostgreSQL and delivering them via the in-app `<ProjectMailInbox />` drawer satisfies all OTP lifecycle rules (`5m` expiry, max `3` attempts, `60s` cooldown, single-use) with zero external dependencies.

### Alternative C: Throwing PostgreSQL `RAISE EXCEPTION` on Failed Login or OTP Attempts

*   **Pros:** Allows client code to catch standard SQL error codes (`P0001`) when credentials or OTPs are invalid.
*   **Cons:** In PostgreSQL, raising an exception inside a function aborts the transaction and rolls back all writes performed during that call—erasing the `failed_attempts + 1` update, the `locked_until` timestamp, the `attempts_used + 1` counter, and the failure log in `public.audit_events`.
*   **Reason for Rejection:** Security state mutations and failure audit logs must persist on every failed attempt. Returning a committed JSONB status envelope (`{ ok: false, code, message, ... }`) guarantees that counters and audit logs are written to disk.

### Alternative D: Destructive Table Truncation During Database Backup Restore

*   **Pros:** Simplifies restore logic to `TRUNCATE ... CASCADE` followed by bulk `INSERT` from the JSONB snapshot.
*   **Cons:** Violates the append-only security constraint on `public.audit_events` (`REVOKE UPDATE, DELETE, TRUNCATE`), fails on foreign-key constraints between `audit_events` / `database_backups` and `profiles`, and destroys the active session of the Admin performing the restore.
*   **Reason for Rejection:** Storing `actor_user_id` and `created_by_admin_id` as loose UUIDs and executing a topological parent-first upsert followed by child-first pruning of mutable domain tables restores application state while keeping `audit_events`, `database_backups`, and the active Admin session intact.

### Alternative E: External LLM API Calls for Skill Suggestions & Profile Verification Queue

*   **Pros:** Can generate free-form text explanations for profile review or unstructured skill extraction.
*   **Cons:** Requires managing external API keys, incurs token quota limits and network failures during offline/local classroom grading, and introduces non-deterministic outputs.
*   **Reason for Rejection:** Neither feature requires an external LLM in the grading rubric. A deterministic SQL and TypeScript rule engine computes reproducible `0–100` legitimacy scores and catalog skill recommendations with zero external API keys or quota risk.

### Alternative F: Manual "Mark Agreement Completed" Button

*   **Pros:** Reduces backend state checks by letting the Client or Freelancer click a single completion button.
*   **Cons:** Allows agreements to close and reviews to be posted while milestones are still unapproved or while external payments remain unconfirmed or disputed.
*   **Reason for Rejection:** Evaluating agreement completion automatically inside `rpc_review_milestone` and `rpc_confirm_external_payment` guarantees that an agreement reaches `completed` if and only if every milestone is `approved` and `confirmed_received` payments equal `100%` of `total_amount_centavos`.

--------------------------------------------------------------------------------

## Non-Functional Requirements

*   **Security & Privacy (IAS 1 Checklists A–H):**
    *   **Password Hashing:** All passwords are hashed with bcrypt (`crypt(..., gen_salt('bf'))`). Plaintext passwords, password hashes, full OTPs, and session tokens are never written to `public.audit_events`.
    *   **PII Protection:** `date_of_birth` and `phone` are private and excluded from public profile queries (`rpc_get_public_profile`).
    *   **Append-Only Audit Trail:** `public.audit_events` revokes `UPDATE`, `DELETE`, and `TRUNCATE` from `anon`, `authenticated`, and `service_role`, enforced by an additional `BEFORE UPDATE OR DELETE` trigger that raises an unconditional error.
*   **Performance & Timer Accuracy:**
    *   All countdown timers (`5m` OTP expiry, `60s` OTP resend cooldown, `1m/5m/15m` login lockout, and `13m30s/15m00s` idle auto-logout) are computed from persisted wall-clock timestamps (`expires_at`, `resend_available_at`, `locked_until`, `last_active_at`) so backgrounded tabs or page reloads never cause drift.
*   **Rollout & Recovery:**
    *   Every execution of `rpc_admin_restore_backup` automatically creates a `pre_restore` snapshot in `public.database_backups` before mutating any domain table, allowing immediate rollback of an unintended restore.

--------------------------------------------------------------------------------

### Additional Resources

*   [AUTH_ONBOARDING_LOGIC.md](file:///c:/Users/denverjmliaz/.opencode/plan/AUTH_ONBOARDING_LOGIC.md) — Authoritative 9-screen Auth & Onboarding specification.
*   [MAIN_APP_LOGIC.md](file:///c:/Users/denverjmliaz/.opencode/plan/MAIN_APP_LOGIC.md) — Authoritative 34-screen Main Application, Settings & Admin specification.
*   [concepts_brief.md](./concepts_brief.md) — Synthesized multi-lens brainstorm brief.

### Future Improvements

*   **Receipt OCR Pre-Fill:** Optional client-side text extraction on uploaded GCash/Maya screenshot proofs to pre-fill the reference number field on `app/agreements/[id]/payments/report.tsx`.
*   **Barangay Map Filter:** Interactive Ormoc City barangay map view alongside the list filter on `app/(tabs)/gigs.tsx`.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

### Target Files to Create/Modify

#### 1. `./package.json`, `./tsconfig.json`, `./app.json`, and `./.env.example` (Create)

*   **Type / Scope**: Expo Router Project Configuration & TypeScript Setup
*   **Proposed Changes**: Initialize the Expo SDK 52+ workspace with `expo-router`, `react-native-safe-area-context`, `react-native-screens`, `@supabase/supabase-js`, `@react-native-async-storage/async-storage`, `expo-crypto`, `expo-image-picker`, and `lucide-react-native`. Configure strict TypeScript path aliases (`@/*`) and environment variable templates (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`) required to connect the mobile and web clients to Supabase.

#### 2. `./supabase/migrations/001_core_security_and_auth.sql` (Create)

*   **Type / Scope**: PostgreSQL Schema, RLS Policies, Triggers & Auth/Security RPCs
*   **Proposed Changes**: Enable `pgcrypto` and create `public.profiles`, `public.login_security_state`, `public.otp_challenges`, `public.project_inbox_messages`, `public.user_sessions`, `public.platform_admins`, `public.audit_events`, and `public.database_backups`. Revoke `UPDATE`, `DELETE`, and `TRUNCATE` on `public.audit_events` and attach `trg_audit_events_immutable` (`BEFORE UPDATE OR DELETE`) to enforce append-only logging. Define `SECURITY DEFINER` RPCs returning structured JSONB `{ ok, code, message, ... }`: `rpc_check_signup_availability`, `rpc_complete_signup_and_issue_otp`, `rpc_generate_otp`, `rpc_get_project_inbox_messages`, `rpc_verify_otp`, `rpc_generate_captcha`, `rpc_verify_credentials_and_gate`, `rpc_reset_password_with_otp`, `rpc_change_password`, `rpc_request_email_change`, `rpc_confirm_email_change`, `rpc_register_session`, `rpc_validate_session`, `rpc_revoke_session`, and `rpc_log_inactivity_logout`.

#### 3. `./supabase/migrations/002_marketplace_agreements_and_admin.sql` (Create)

*   **Type / Scope**: PostgreSQL Marketplace Schema, RLS Policies, Contract State Machine & Admin/Backup RPCs
*   **Proposed Changes**: Create `public.skills_catalog`, `public.user_skills`, `public.portfolio_items`, `public.gigs`, `public.applications`, `public.agreements`, `public.milestones`, `public.external_payments`, `public.reviews`, `public.conversations`, `public.messages`, `public.notifications`, and `public.reports`. Add database `CHECK` constraints for positive centavos, `revision_count <= 2`, rating `1..5`, and own-content rules (`client_id != freelancer_id`, `reviewer_id != reviewee_id`, `reporter_id != target_user_id`). Define `SECURITY DEFINER` RPCs: `rpc_complete_onboarding_step`, `rpc_switch_user_mode`, `rpc_create_or_update_gig`, `rpc_submit_application`, `rpc_accept_application`, `rpc_setup_milestones`, `rpc_submit_milestone`, `rpc_review_milestone` (enforcing automatic dispute escalation on failed 2nd revision and automatic agreement completion when all milestones are approved and 100% of contract centavos are confirmed received), `rpc_report_external_payment`, `rpc_confirm_external_payment`, `rpc_dispute_external_payment`, `rpc_submit_review`, `rpc_send_message`, `rpc_file_report`, `rpc_get_public_profile`, `rpc_admin_create_user`, `rpc_admin_manage_user`, `rpc_admin_review_verification`, `rpc_admin_create_backup`, and `rpc_admin_restore_backup`.

#### 4. `./supabase/seed.sql` (Create)

*   **Type / Scope**: Reference Catalog & Initial Admin Bootstrap SQL
*   **Proposed Changes**: Seed `public.skills_catalog` with local Ormoc City service categories and skills (Home Repair, Graphic Design, Web & IT Support, Event Photography, Academic Tutoring, Bookkeeping, Delivery & Errands, Catering) and create the initial `Super Admin` and `Admin` evaluator accounts in `auth.users`, `public.profiles`, and `public.platform_admins` so Admin grading (Checklists A, F, H) can begin immediately.

#### 5. `./lib/supabase.ts` (Create)

*   **Type / Scope**: TypeScript Supabase Client & Typed RPC Invoker Module
*   **Proposed Changes**: Configure the singleton Supabase client with platform-aware session persistence (`AsyncStorage` on native, `localStorage` on web) and export typed wrapper functions for every PostgreSQL RPC and Realtime channel subscription so UI screens never construct raw unvalidated queries.

#### 6. `./lib/currency.ts` (Create)

*   **Type / Scope**: Centavo Financial Utility Module
*   **Proposed Changes**: Provide `parsePhpToCentavos(input: string): bigint | null`, `formatCentavosToPhp(centavos: number | bigint): string`, and `validateMilestoneSum(milestoneCentavos: number[], contractTotalCentavos: number): { valid: boolean; deltaCentavos: number }` to prevent floating-point rounding discrepancies across gigs, proposals, milestones, and external payments.

#### 7. `./lib/verificationRules.ts` and `./lib/ormocBarangays.ts` (Create)

*   **Type / Scope**: Deterministic Legitimacy Scoring, Skill Recommender & Ormoc Barangay Reference Data
*   **Proposed Changes**: Export the list of Ormoc City barangays/districts (`District 1–29`, `Alegria`, `Alta Vista`, `Bagong Buhay`, `Bantigue`, `Cogon`, `Doña Feliza Z. Mejia`, `Don Felipe Larrazabal`, `Linao`, `Naungan`, `Punta`, `San Pablo`, `Tambulilid`, `Valencia`, etc.), the deterministic `calculateLegitimacyScore(profile, metrics)` rule evaluator (`0–100` score + rule breakdown array), and `suggestSkillsFromCatalog(selectedSkills, category, catalog)` for zero-LLM skill suggestions.

#### 8. `./context/AuthContext.tsx` (Create)

*   **Type / Scope**: React Context for Authentication, Session Tracking, Route Gating & Demo Inbox State
*   **Proposed Changes**: Maintain `session`, `profile`, `adminRole`, `currentSessionId`, `activeInboxEmail`, and `activeChallengeId`. Enforce client-side route redirection matching server access rules (`Guest` -> `Confirm Email` -> `Onboarding Step 1/2/3` -> `Main Tabs` or `Admin Dashboard`) and expose actions for login, signup, logout, session refresh, and OTP inbox focus.

#### 9. `./components/security/ProjectMailInbox.tsx` (Create)

*   **Type / Scope**: Global Self-Hosted OTP Push Banner & Pull-Down Mail Drawer Component
*   **Proposed Changes**: Poll and subscribe to `rpc_get_project_inbox_messages(activeInboxEmail, activeChallengeId)`. Render a top push notification banner when a new `signup_verification`, `password_reset`, or `email_change` 6-digit OTP is generated, plus an expandable pull-down drawer showing message subject, recipient email, 6-digit code, live `mm:ss` expiration countdown (`expires_at`), and one-tap **Copy / Auto-Fill OTP** buttons.

#### 10. `./components/security/VisualCaptcha.tsx` (Create)

*   **Type / Scope**: Self-Generated Visual Alphanumeric CAPTCHA Component
*   **Proposed Changes**: Fetch a server-generated 6-character challenge via `rpc_generate_captcha(identifier)` and render each character with individual rotation angles, vertical offsets, strike-through noise lines, and a refresh button so post-lockout logins require human visual verification without external API keys.

#### 11. `./components/security/InactivityGuard.tsx` (Create)

*   **Type / Scope**: Global 15-Minute Idle Timeout Tracker & Warning Modal (IAS 1 Part E)
*   **Proposed Changes**: Track touch, pointer, keyboard, and route-change timestamps across authenticated screens. Calculate elapsed idle time against wall-clock `Date.now()`. At `13 minutes 30 seconds` (`810s`), display a modal with a live 90-second countdown and a **"Stay Logged In"** button. At `15 minutes 00 seconds` (`900s`), invoke `rpc_log_inactivity_logout`, revoke the active session, and redirect to `/(auth)/login`. Expose `triggerEvaluatorIdleFastForward()` for live defense grading on `./app/settings/sessions.tsx`.

#### 12. `./components/security/SessionSyncGuard.tsx` (Create)

*   **Type / Scope**: Multi-Tab Logout, Session Revocation & Navigation History Guard
*   **Proposed Changes**: Listen to web `BroadcastChannel('gigormoc_auth_sync')`, `storage` events, and Supabase Realtime updates on `public.user_sessions` and `public.profiles`. When a session is revoked (via logout in another tab, password change/reset, or Admin lock/deactivation), immediately clear local auth state and call `router.replace('/(auth)/login')` so Back-button navigation cannot reopen protected screens.

#### 13. `./components/security/PasswordChecklist.tsx`, `./components/ui/ConfirmModal.tsx`, `./components/ui/EmptyStateCard.tsx`, and `./components/ui/StatusBadge.tsx` (Create)

*   **Type / Scope**: Reusable Security & Marketplace UI Primitives
*   **Proposed Changes**: Provide the live 5-rule password policy checklist with Show/Hide password toggles (`PasswordChecklist.tsx`), a standardized confirmation dialog required before sensitive actions (`ConfirmModal.tsx`), an honest empty-state card when tables contain zero rows (`EmptyStateCard.tsx`), and role/contract/payment status badges (`StatusBadge.tsx`).

#### 14. `./app/_layout.tsx` and `./app/index.tsx` (Create)

*   **Type / Scope**: Root Expo Router Layout & Initial Entry Redirector
*   **Proposed Changes**: Mount `AuthProvider`, `<ProjectMailInbox />`, `<InactivityGuard />`, and `<SessionSyncGuard />` at the root level, and route incoming users in `./app/index.tsx` based on authentication, `email_verified`, `platform_admins` membership, and `onboarding_completed`.

#### 15. `./app/(auth)/_layout.tsx`, `./app/(auth)/welcome.tsx`, `./app/(auth)/login.tsx`, `./app/(auth)/signup-step1.tsx`, `./app/(auth)/signup-step2.tsx`, `./app/(auth)/confirm-email.tsx`, and `./app/(auth)/forgot-password.tsx` (Create)

*   **Type / Scope**: Auth Route Group (Screens 1–6)
*   **Proposed Changes**:
    *   `_layout.tsx`: Redirect already-verified authenticated users away from guest auth screens.
    *   `welcome.tsx`: Public landing screen with entry actions for Login and Sign Up Step 1.
    *   `login.tsx`: Username-or-email + password login with Show/Hide toggle, remaining attempts alert (`2 attempts remaining`, `1 attempt remaining`), wall-clock lockout countdown timer (`01:00` / `05:00` / `15:00`), and conditional `<VisualCaptcha />` when `captcha_required = true`.
    *   `signup-step1.tsx`: Collect and validate unique username (`^[a-z0-9_]{3,20}$`), display name, unique made-up email, 5-rule password with live `<PasswordChecklist />`, confirm password, and Terms acceptance via `rpc_check_signup_availability`.
    *   `signup-step2.tsx`: Collect Date of Birth, enforce 18+ age gate, create account + dispatch 6-digit `signup_verification` OTP via `rpc_complete_signup_and_issue_otp`, and route to `confirm-email.tsx`.
    *   `confirm-email.tsx`: 6-digit OTP input wired to `<ProjectMailInbox />` Auto-Fill, live 5-minute expiry timer, remaining attempts counter (max 3), and 60-second resend cooldown button via `rpc_verify_otp` and `rpc_generate_otp`.
    *   `forgot-password.tsx`: 3-stage password recovery (Identify Account -> Verify 6-digit Project OTP -> Set New 5-Rule Password & Revoke All Sessions via `rpc_reset_password_with_otp`).

#### 16. `./app/(onboarding)/_layout.tsx`, `./app/(onboarding)/step1-mode.tsx`, `./app/(onboarding)/step2-skills.tsx`, and `./app/(onboarding)/step3-profile.tsx` (Create)

*   **Type / Scope**: Onboarding Route Group (Screens 7–9)
*   **Proposed Changes**:
    *   `_layout.tsx`: Require authenticated session with `email_verified = true`.
    *   `step1-mode.tsx`: Mandatory role selection (`Find Work` [`freelancer`] or `Hire Someone` [`client`]).
    *   `step2-skills.tsx`: Branch by selected mode—Freelancers select catalog/typed/rule-suggested skills; Clients select `Individual` vs `Business`, optional business name, and hiring interests.
    *   `step3-profile.tsx`: Upload optional avatar (JPG/PNG/WebP), choose Ormoc City barangay from `./lib/ormocBarangays.ts`, enter bio, compute initial legitimacy score, and mark `onboarding_completed = true`.

#### 17. `./app/(tabs)/_layout.tsx`, `./app/(tabs)/index.tsx`, `./app/(tabs)/gigs.tsx`, `./app/(tabs)/activity.tsx`, `./app/(tabs)/messages.tsx`, and `./app/(tabs)/profile.tsx` (Create)

*   **Type / Scope**: Main Bottom-Tab Shell (Screens 10–14)
*   **Proposed Changes**:
    *   `_layout.tsx`: Enforce authenticated, verified, non-admin onboarded access and render the 5 bottom tabs with unread notification/message badges.
    *   `index.tsx`: Role-aware Home Dashboard showing active agreements, pending payments/milestones, Ormoc gig recommendations (Freelancer) or applicant alerts & Post Gig CTA (Client).
    *   `gigs.tsx`: Role-aware Gigs tab—Freelancers search/filter open Ormoc gigs by category and barangay; Clients view and manage their posted gigs.
    *   `activity.tsx`: Track submitted proposals (Freelancer), active/completed agreements, and external payment statuses.
    *   `messages.tsx`: List 1-on-1 conversations with unread indicators and last message preview.
    *   `profile.tsx`: Display user profile summary, separate `freelancer_rating_avg` and `client_rating_avg` ("Reviews"), links to Profile/Settings screens, and a Logout button protected by `<ConfirmModal />` (`"Are you sure you want to log out?"`).

#### 18. `./app/gigs/post.tsx`, `./app/gigs/[id].tsx`, `./app/gigs/[id]/apply.tsx`, and `./app/gigs/[id]/applicants.tsx` (Create)

*   **Type / Scope**: Gigs Lifecycle Screens (Screens 15–18)
*   **Proposed Changes**:
    *   `post.tsx`: Client-only form to create or edit a gig with title, category, description, PHP budget converted to integer centavos, Ormoc barangay, and required skills.
    *   `[id].tsx`: Gig Details screen displaying budget in PHP, client reputation, barangay, and role-gated primary action (`Apply / Submit Proposal` for Freelancers; `Manage Applicants` and status controls for Client owner).
    *   `[id]/apply.tsx`: Freelancer-only proposal submission screen enforcing the own-content rule (`freelancer_id != client_id`), proposed rate in centavos, estimated days, and cover letter.
    *   `[id]/applicants.tsx`: Client-owner screen listing applicant proposals with links to public profiles, 1-on-1 chat, and an **Accept Proposal** button (with `<ConfirmModal />`) calling `rpc_accept_application`.

#### 19. `./app/agreements/[id].tsx`, `./app/agreements/[id]/milestones/setup.tsx`, `./app/agreements/[id]/milestones/[milestoneId]/submit.tsx`, `./app/agreements/[id]/milestones/[milestoneId]/review.tsx`, `./app/agreements/[id]/payments/report.tsx`, `./app/agreements/[id]/payments/[paymentId]/dispute.tsx`, and `./app/agreements/[id]/review.tsx` (Create)

*   **Type / Scope**: Agreements, Milestones, External Payments & Reviews Screens (Screens 19–25)
*   **Proposed Changes**:
    *   `[id].tsx`: Contract Hub restricted to the agreement's Client, Freelancer, and Admins. Displays milestone sequence, revision counters (`0/2`, `1/2`, `2/2`), external payment ledger (`reported_sent`, `confirmed_received`, `disputed`), and contextual action buttons.
    *   `[id]/milestones/setup.tsx`: Client-only milestone builder validating in real time and via `rpc_setup_milestones` that milestone centavos sum to `agreements.total_amount_centavos`.
    *   `[id]/milestones/[milestoneId]/submit.tsx`: Freelancer-only screen to submit deliverable notes and proof URL/attachment via `rpc_submit_milestone`.
    *   `[id]/milestones/[milestoneId]/review.tsx`: Client-only deliverable review screen calling `rpc_review_milestone`. Shows remaining revisions (`2 - revision_count`); when `revision_count == 2`, warns that rejecting the submission automatically escalates the agreement to `disputed` for Admin review.
    *   `[id]/payments/report.tsx`: Client-only external payment logger (`GCash`, `Maya`, `PayPal`, `Cash`, amount in centavos, reference number, proof upload) calling `rpc_report_external_payment`.
    *   `[id]/payments/[paymentId]/dispute.tsx`: Freelancer-only payment dispute form calling `rpc_dispute_external_payment`.
    *   `[id]/review.tsx`: Post-completion mutual review screen (`1–5` stars + comment) restricted to `completed` agreements within 14 days via `rpc_submit_review`.

#### 20. `./app/chat/[conversationId].tsx` and `./app/notifications.tsx` (Create)

*   **Type / Scope**: Real-Time Chat & System Notifications Screens (Screens 26–27)
*   **Proposed Changes**:
    *   `chat/[conversationId].tsx`: 1-on-1 real-time chat restricted to the two conversation participants via RLS and Supabase Realtime, with message sending via `rpc_send_message`.
    *   `notifications.tsx`: System notification center displaying contract, milestone, payment, and moderation alerts with deep-link routing and mark-as-read actions.

#### 21. `./app/profile/edit.tsx`, `./app/profile/skills.tsx`, `./app/profile/portfolio.tsx`, `./app/profile/[id].tsx`, and `./app/reports/new.tsx` (Create)

*   **Type / Scope**: Profile Management, Public Profile & Moderation Reporting Screens (Screens 28–32)
*   **Proposed Changes**:
    *   `profile/edit.tsx`: Edit display name, Ormoc barangay, bio, avatar, client business details, and submit profile for legitimacy badge verification.
    *   `profile/skills.tsx`: Freelancer-only skill catalog manager with deterministic skill recommendations.
    *   `profile/portfolio.tsx`: Freelancer-only portfolio item CRUD.
    *   `profile/[id].tsx`: Public Profile View powered by `rpc_get_public_profile`, displaying role-specific ratings ("Reviews"), skills, and portfolio while stripping private `date_of_birth`, `phone`, and `email`.
    *   `reports/new.tsx`: Moderation report form enforcing the own-content rule (`reporter_id != target_user_id`), category selection, minimum description length, and evidence URL via `rpc_file_report`.

#### 22. `./app/settings/mode.tsx`, `./app/settings/password.tsx`, `./app/settings/email.tsx`, and `./app/settings/sessions.tsx` (Create)

*   **Type / Scope**: Settings & Session Security Screens (Screens 33–36 — IAS 1 Parts B, C, E)
*   **Proposed Changes**:
    *   `settings/mode.tsx`: Role switcher (`Find Work` <-> `Hire Someone`) displaying live eligibility checks for the 7-day cooldown and active contract/payment/report blockers, protected by `<ConfirmModal />` and `rpc_switch_user_mode`.
    *   `settings/password.tsx`: Authenticated password change requiring current password, live 5-rule `<PasswordChecklist />`, Show/Hide toggles, and automatic revocation of all other active sessions via `rpc_change_password`.
    *   `settings/email.tsx`: Authenticated email change requiring current password + new unique email (`rpc_request_email_change`) followed by 6-digit Project OTP verification (`rpc_confirm_email_change`) before updating `profiles.email` and `auth.users.email`.
    *   `settings/sessions.tsx`: Lists tracked rows in `public.user_sessions` with device/IP/last-active metadata, individual and "Revoke All Other Sessions" buttons, plus the **"Evaluator Test: Fast-Forward Idle Timer to 13m 25s"** button for live grading of the 13m30s warning modal and 15m00s auto-logout.

#### 23. `./app/admin/_layout.tsx`, `./app/admin/dashboard.tsx`, `./app/admin/users.tsx`, `./app/admin/users/create.tsx`, `./app/admin/users/[id].tsx`, `./app/admin/verification.tsx`, `./app/admin/log-trail.tsx`, and `./app/admin/backups.tsx` (Create)

*   **Type / Scope**: Admin & Super Admin Governance Portal (Screens 37–43 — IAS 1 Parts A, F, G, H)
*   **Proposed Changes**:
    *   `admin/_layout.tsx`: Server-verified `platform_admins` guard; blocks regular users and logs `UNAUTHORIZED_ACCESS_BLOCKED` to `public.audit_events`.
    *   `admin/dashboard.tsx`: Dedicated Admin Metrics Dashboard showing user counts, active lockouts, open disputes/reports, recent audit events, backup status, and navigation cards.
    *   `admin/users.tsx`: Searchable and filterable User Directory (by username, email, display name, role, active status, and lock state).
    *   `admin/users/create.tsx`: Admin User & Admin Creation form calling `rpc_admin_create_user` (validating unique username/email, 5-rule password, 18+ DOB, and initial role without overwriting the Admin's session).
    *   `admin/users/[id].tsx`: User Detail & Moderation screen supporting profile edits, Activate/Deactivate (`is_active`), Manual Lock/Unlock (`is_admin_locked`), 1-click Reset of Temporary 3-Strike Lockout (`unlock_temp_lockout`), Role Assignment (`freelancer`, `client`, `admin`, `super_admin` gated to Super Admin), and Moderation Report resolution, all with `<ConfirmModal />` prompts.
    *   `admin/verification.tsx`: Super Admin-only Deterministic Legitimacy Verification Queue displaying each queued user's `0–100` rule breakdown (`./lib/verificationRules.ts`) with Approve, Request Update, and Reject actions via `rpc_admin_review_verification`.
    *   `admin/log-trail.tsx`: Read-only, append-only Security Log Trail viewer displaying **User**, **Activity**, **Date/Time**, **Affected Module**, **IP Address**, and **Result**, with search and module/result/date filters and zero edit or delete controls.
    *   `admin/backups.tsx`: Database Backup & Recovery console displaying scheduled, manual, and pre-restore snapshots with SHA-256 checksums and per-table row counts, a **Create Manual Backup** action (`rpc_admin_create_backup`), JSON snapshot download/export, and a **Restore Backup** action (`rpc_admin_restore_backup`) protected by `<ConfirmModal />` + Admin password re-verification.

#### 24. `./tests/currency.test.ts`, `./tests/verificationRules.test.ts`, and `./tests/security_and_marketplace_rpcs.test.ts` (Create)

*   **Type / Scope**: Automated Unit & Integration Verification Suite
*   **Proposed Changes**: Test centavo parsing and milestone sum validation (`currency.test.ts`), deterministic `0–100` legitimacy scoring and catalog skill recommendations (`verificationRules.test.ts`), and end-to-end RPC invariants (`security_and_marketplace_rpcs.test.ts`: 18+ DOB gate, 6-digit OTP 5m expiry / 3-attempt invalidation / 60s cooldown / single-use, 3-strike `1m -> 5m -> 15m` login lockout persistence + CAPTCHA gate, password reset session revocation, failed 2nd-revision auto-dispute, deterministic agreement completion, append-only `audit_events` enforcement, and non-destructive backup/restore).

### Verification Plan

*   **Compilation/Build**: `npx tsc --noEmit` and `npx expo export --platform web` must complete with zero TypeScript or bundler errors.
*   **Unit Tests**: `npm test` executing `./tests/currency.test.ts` and `./tests/verificationRules.test.ts`.
*   **Static Analysis & Linting**: `npx expo lint` verifying route exports, hook dependencies, and TypeScript strictness across all 43 screen files.
*   **Test Coverage Requirement**: 100% coverage of IAS 1 Checklists A–H security RPC gates and centavo financial helpers (`./lib/currency.ts`, `./lib/verificationRules.ts`, and `./tests/security_and_marketplace_rpcs.test.ts`).
*   **E2E/Integration**: Execute `./tests/security_and_marketplace_rpcs.test.ts` against the Supabase PostgreSQL database to verify that failed login/OTP attempts commit to disk, `UPDATE`/`DELETE` on `public.audit_events` fail with permission/trigger errors, milestone sum mismatches and 3rd revisions are rejected/escalated, and `rpc_admin_restore_backup` restores domain state while preserving `public.audit_events` and `public.database_backups`.

--------------------------------------------------------------------------------

<!-- Provenance: Indicates initial structural drafting via EGM. -->

*Drafted with EGM*
