Status: resolved

# Goldfish Annotated Review Report

**Target:** `docs/designs/gigormoc_marketplace_and_security.md` (`1..1026 (full file)`)

## Prioritized Findings & AI Suggestions

### [Issue 1] [`egm-design`, `egm-zoom-out`] - Severity: High
*   **Affected Scope:** [Lines 325-354, 766-773](docs/designs/gigormoc_marketplace_and_security.md#L766-L773) (`#### 2.3 Entity Relationship Diagram (ERD)` & `#### 3.3 Admin Governance, Audit Trail & Backup/Restore RPCs`)
*   **Discrepancy Description:** In `rpc_admin_restore_backup` (Lines 771–772), Step 2 upserts 16 tables (`profiles`, `login_security_state`, `platform_admins`, `skills_catalog`, `user_skills`, `portfolio_items`, `gigs`, `applications`, `agreements`, `milestones`, `external_payments`, `reviews`, `conversations`, `messages`, `notifications`, `reports`), but Step 3 only prunes post-snapshot rows from 12 child tables—omitting `platform_admins`, `login_security_state`, `skills_catalog`, and `profiles`. Furthermore, `rpc_admin_create_backup` and `rpc_admin_restore_backup` do not snapshot or synchronize `auth.users` (`id`, `email`, `encrypted_password`, `raw_user_meta_data`). Per Stage 8 (`egm-zoom-out`), this should be resolved declaratively using a single canonical topological table list rather than duplicating per-table SQL procedures.
*   **Rationale:** Omitting `platform_admins`, `login_security_state`, `skills_catalog`, and `profiles` from Step 3 leaves post-backup users and admin privilege grants in the database after a restore, and restoring `public.profiles.email` without restoring `auth.users` credentials breaks hybrid authentication.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Defining one canonical 17-table topological list (`auth.users` minimal credential projection + `auth.identities` followed by the 16 `public` domain tables) and applying it forward for Step 2 upserts and in reverse for Step 3 post-snapshot pruning (while excluding the executing Admin's `user_id` and active session) guarantees complete state restoration and hybrid auth consistency.
*   ***Proposed Edit:***
    *   Location: `#### 3.3 Admin Governance, Audit Trail & Backup/Restore RPCs` (`Lines 766-773`)
    *   Change: Define the canonical 17-table topological list (`auth.users` [`id`, `email`, `encrypted_password`, `raw_user_meta_data`, `email_confirmed_at`] + `auth.identities` -> `profiles` -> `login_security_state` -> `platform_admins` -> `skills_catalog` -> `user_skills` -> `portfolio_items` -> `gigs` -> `applications` -> `agreements` -> `milestones` -> `external_payments` -> `reviews` -> `conversations` -> `messages` -> `notifications` -> `reports`). Specify that `rpc_admin_create_backup` serializes this 17-table list into `snapshot_payload`, and `rpc_admin_restore_backup` upserts the list in forward topological order in Step 2 and prunes post-snapshot rows across the exact same list in reverse topological order in Step 3 while excluding the executing Admin's `user_id` and active `user_sessions` row.

### [Issue 2] [`egm-implementation-readiness`, `egm-codebase-details`, `egm-comprehension`, `egm-zoom-out`] - Severity: High
*   **Affected Scope:** [Lines 339, 692-774, 852-861, 981, 994, 1004-1005](docs/designs/gigormoc_marketplace_and_security.md#L692-L774) (`#### 2.3 ERD`, `### 3. Security, Contract & Admin RPC Specifications`, and `## Detailed Implementation Plan` Items 2, 3, 21, 22, 23)
*   **Discrepancy Description:**
    1. Fourteen RPCs listed in Detailed Implementation Plan Items 2 and 3 (`rpc_register_session`, `rpc_validate_session`, `rpc_revoke_session`, `rpc_log_inactivity_logout`, `rpc_complete_onboarding_step`, `rpc_create_or_update_gig`, `rpc_submit_application`, `rpc_submit_milestone`, `rpc_send_message`, `rpc_file_report`, `rpc_get_public_profile`, `rpc_admin_review_verification`, plus ellipsis signatures `rpc_report_external_payment(...)`, `rpc_admin_create_user(...)`, and `rpc_admin_manage_user(...)`) omit their parameter lists, validation rules, and return shapes.
    2. `admin/users/[id].tsx` (Line 1004) requires Moderation Report resolution (`pending -> reviewed | dismissed | action_taken`), `profile/edit.tsx` (Line 981) requires submitting a profile for verification, and `admin/verification.tsx` (Line 1005) includes `"Request Update"`, which is missing from `profiles.verification_status` (`'unsubmitted | pending | verified | rejected'`).
    3. Per Stage 5 & Stage 8 (`egm-zoom-out`), Section 3 should state architectural contracts and input/output envelopes concisely rather than embedding raw inline SQL code blocks.
*   **Rationale:** Under the Zero-Decision Rule, every RPC and enum state required by the 43 screens must have an unambiguous signature, validation contract, and audit event name.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Adding `'update_requested'` to `profiles.verification_status` and specifying concise, complete parameter signatures, validation rules, audit events, and return shapes for all RPCs (including `rpc_submit_verification_request` and `rpc_admin_resolve_report`) eliminates all implementer guesswork while keeping Section 3 at architectural altitude.
*   ***Proposed Edit:***
    *   Location: `Line 339`, `### 3. Security, Contract & Admin RPC Specifications` (`Lines 692-774`), and `## Detailed Implementation Plan` Items 2, 3, 21, 22, 23 (`Lines 852-861, 981, 994, 1004-1005`)
    *   Change: Update `PROFILES.verification_status` to `"unsubmitted | pending | update_requested | verified | rejected"`, replace inline SQL literals in Section 3 with architectural contract descriptions, and add complete signatures and contracts for all 31 RPCs across `001_core_security_and_auth.sql` and `002_marketplace_agreements_and_admin.sql` (`rpc_register_session`, `rpc_validate_session`, `rpc_revoke_session`, `rpc_log_inactivity_logout`, `rpc_complete_onboarding_step`, `rpc_create_or_update_gig`, `rpc_submit_application`, `rpc_submit_milestone`, `rpc_report_external_payment`, `rpc_send_message`, `rpc_file_report`, `rpc_get_public_profile`, `rpc_submit_verification_request`, `rpc_admin_create_user`, `rpc_admin_manage_user`, `rpc_admin_review_verification`, `rpc_admin_resolve_report`, and `rpc_admin_ensure_scheduled_backup`).

### [Issue 3] [`egm-implementation-readiness`, `egm-codebase-details`, `egm-comprehension`, `egm-design`, `egm-zoom-out`] - Severity: High
*   **Affected Scope:** [Lines 95-103, 376, 699-728, 852-870, 882-886, 917-928](docs/designs/gigormoc_marketplace_and_security.md#L95-L103) (`### 1. System Architecture & Hybrid Auth Model`, `#### 2.3 ERD OTP_CHALLENGES`, `#### 3.1`, and `## Detailed Implementation Plan` Items 2, 3, 4, 8, 15)
*   **Discrepancy Description:**
    1. **Unstated Client-to-GoTrue Handshake:** The exact call sequence between the client, `SECURITY DEFINER` RPCs, and `supabase.auth.signInWithPassword` during Sign Up Step 2 and Login is not written out, and calling `supabase.auth.signUp()` before checking 18+ DOB would create an `auth.users` row before the age check runs.
    2. **Server-Side Session/Lockout Enforcement:** A client holding or obtaining a GoTrue JWT could query RLS or domain RPCs unless a single database-level session/lockout predicate is enforced.
    3. **GoTrue Direct-Insert Column Contract:** Direct SQL inserts into `auth.users` and `auth.identities` (in `seed.sql`, `rpc_register_and_issue_otp`, and `rpc_admin_create_user`) will cause GoTrue `signInWithPassword` 500 errors unless GoTrue's required non-null columns (`instance_id`, `aud`, `role`, `email_confirmed_at`, and empty-string `''` token columns) are populated.
    4. **Forgot Password Stage 2 -> Stage 3 OTP Transition:** `forgot-password.tsx` verifies the OTP in Stage 2 (`rpc_verify_otp`) and resets the password in Stage 3 (`rpc_reset_password_with_otp`); without a `'verified'` intermediate status on `otp_challenges`, Stage 3 either fails because Stage 2 already marked the OTP `'used'` or allows replay.
*   **Rationale:** Explicit handshake steps, GoTrue column invariants, a single `STABLE` session guard predicate, and a two-step `'active' -> 'verified' -> 'used'` OTP transition for password reset are required for end-to-end authentication reliability.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Documenting the 3-step Sign Up and Login handshakes, defining `public.is_authenticated_session_valid()`, specifying the GoTrue direct-insert columns, and adding `'verified'` to `otp_challenges.status` resolves all four authentication and security gaps cleanly.
*   ***Proposed Edit:***
    *   Location: `### 1. System Architecture & Hybrid Auth Model` (`Lines 95-105`), `OTP_CHALLENGES` ERD (`Line 376`), `#### 3.1` (`Lines 699-728`), and Items 2, 3, 4, 8, 15 (`Lines 852-886, 917-928`)
    *   Change:
        1. Document the Sign Up Step 2 handshake (`rpc_register_and_issue_otp(p_username, p_display_name, p_email, p_password, p_dob)` validates 18+ DOB first, then atomically inserts `auth.users` + `auth.identities` + `public.profiles` + `public.login_security_state` and issues the 6-digit `signup_verification` OTP, followed by client `supabase.auth.signInWithPassword` and `rpc_register_session`) and the Login handshake (`rpc_verify_credentials_and_gate` -> `supabase.auth.signInWithPassword` -> `rpc_register_session`).
        2. Define `public.is_authenticated_session_valid()` (`SECURITY DEFINER STABLE`) verifying `profiles.is_active = true`, `profiles.is_admin_locked = false`, `coalesce(login_security_state.locked_until <= now(), true)`, and an unrevoked `user_sessions` row for `auth.uid()` with `last_active_at >= now() - interval '15 minutes'`.
        3. Specify the mandatory GoTrue v2+ columns for direct `auth.users` + `auth.identities` inserts (`instance_id = '00000000-0000-0000-0000-000000000000'`, `aud = 'authenticated'`, `role = 'authenticated'`, `email_confirmed_at = now()`, `confirmation_token = ''`, `recovery_token = ''`, `email_change_token_new = ''`, `email_change = ''`).
        4. Add `'verified'` to `OTP_CHALLENGES.status` (`active | verified | used | invalidated | expired`) so `rpc_verify_otp` transitions `password_reset` challenges to `'verified'` in Stage 2 and `rpc_reset_password_with_otp` consumes `'verified' -> 'used'` in Stage 3.

### [Issue 4] [`egm-implementation-readiness`, `egm-codebase-details`, `egm-comprehension`, `egm-zoom-out`] - Severity: High
*   **Affected Scope:** [Lines 877-881](docs/designs/gigormoc_marketplace_and_security.md#L877-L881) (`#### 7. ../../lib/verificationRules.ts and ../../lib/ormocBarangays.ts (Create)`)
*   **Discrepancy Description:** Item 7 requires exporting `calculateLegitimacyScore(profile, metrics)` (`0–100` score + rule breakdown array), `suggestSkillsFromCatalog(selectedSkills, category, queryText, catalog)`, and `ORMOC_BARANGAYS`, and Item 24 requires unit-testing them, but the exact point weights summing to `100`, TypeScript interfaces, skill ranking rules, and full barangay list (currently ending with `"etc."`) are omitted.
*   **Rationale:** Without exact point weights, interfaces, ranking logic, and the static barangay array, implementers and unit tests cannot produce deterministic results.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Specifying the 5-rule additive breakdown totaling `100` points (per Stage 8 guardrail), the deterministic category + keyword skill ranking formula, and the complete static `ORMOC_BARANGAYS` array makes `lib/verificationRules.ts` and `lib/ormocBarangays.ts` 100% deterministic.
*   ***Proposed Edit:***
    *   Location: `#### 7. ../../lib/verificationRules.ts and ../../lib/ormocBarangays.ts (Create)` (`Lines 877-881`)
    *   Change: Specify:
        1. `calculateLegitimacyScore(profile, metrics)` 5-rule additive rubric summing to `100`: Rule 1 `email_verified` (`20 pts`), Rule 2 `profile_media_and_bio` (`10 pts` non-empty `avatar_url` + `10 pts` `bio.trim().length >= 50`), Rule 3 `valid_ormoc_barangay` (`15 pts` `ORMOC_BARANGAYS.includes(area_barangay)`), Rule 4 `role_completeness` (`25 pts`: for `freelancer`, `15 pts` if `skillsCount >= 3` + `10 pts` if `portfolioCount >= 1`; for `client`, `10 pts` if `client_type` is `'individual' | 'business'` and business name present when `'business'` + `15 pts` if `hiring_interests.length >= 1`), and Rule 5 `trust_and_moderation_record` (`20 pts`: `10 pts` if `actionedReportsCount === 0` + `10 pts` if `completedAgreementsCount >= 1` [or `5 pts` clean baseline for new accounts with `0` completed agreements]).
        2. `suggestSkillsFromCatalog(selectedSkills, category, queryText, catalog)` deterministic ranking: filter out `selectedSkills`, score each catalog item (`+3` if `item.category === category`, `+2` for each keyword in `item.keywords` matching a lowercase token in `queryText` or existing selected skills' categories), return items with `score > 0` sorted by `score DESC, name ASC` (limit 8).
        3. Complete static `ORMOC_BARANGAYS` array (`District 1` through `District 29`, `Airport`, `Alegria`, `Alta Vista`, `Bagong`, `Bagong Buhay`, `Bantigue`, `Batuan`, `Cabintan`, `Cabulihan`, `Can-adieng`, `Can-untog`, `Catmon`, `Cogon Combado`, `Curva`, `Danao`, `Dayhagan`, `Dolores`, `Domonar`, `Don Felipe Larrazabal`, `Doña Feliza Z. Mejia`, `Donghol`, `hibunawon`, `Hugpa`, `Ipil`, `Lao`, `Libertad`, `Linao`, `Luna`, `Mabini`, `Macabug`, `Magaswi`, `Mahayag`, `Mahayahay`, `Margen`, `Mas-in`, `Milagro`, ` Monterico`, `Nasunogan`, `Naungan`, `Nueva Sociedad`, `Patag`, `Punta`, `Quezon Jr.`, `Rufina M. Tan`, `Sabang Bao`, `Salvacion`, `San Antonio`, `San Isidro`, `San Jose`, `San Juan`, `San Pablo`, `San Vicente`, `Santo Niño`, `Sumangga`, `Tambulilid`, `Tongonan`, `Valencia`) with no `"etc."`.

### [Issue 5] [`egm-codebase-details`, `egm-implementation-readiness`] - Severity: High
*   **Affected Scope:** [Lines 847-851, 1009-1021](docs/designs/gigormoc_marketplace_and_security.md#L847-L851) (`#### 1. ../../package.json...`, `#### 24. ../../tests/*`, and `### Verification Plan`)
*   **Discrepancy Description:** Item 1 omits `react-native-svg` (mandatory peer dependency for `lucide-react-native`), Expo Router web/navigation packages (`react-dom`, `react-native-web`, `@expo/metro-runtime`, `expo-linking`, `expo-constants`, `expo-status-bar`, `react-native-gesture-handler`), and the test runner (`vitest`) + `package.json` scripts (`test`, `typecheck`, `lint`). Additionally, Item 24 summarizes tests in a single sentence rather than enumerating concrete happy-path and negative/edge test cases.
*   **Rationale:** Missing peer/web dependencies break `npx expo export --platform web`, and missing `vitest` configuration breaks `npm test`.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Adding the required runtime/peer dependencies, `vitest` devDependency, and `package.json` scripts in Item 1 and enumerating the specific test cases in Item 24 makes the build and verification commands executable out of the box.
*   ***Proposed Edit:***
    *   Location: `#### 1` (`Lines 847-851`) and `#### 24` (`Lines 1009-1013`)
    *   Change: Add `react-native-svg`, `react-dom`, `react-native-web`, `@expo/metro-runtime`, `expo-linking`, `expo-constants`, `expo-status-bar`, `react-native-gesture-handler`, devDependencies (`vitest`, `typescript`, `@types/react`), and scripts (`"test": "vitest run"`, `"typecheck": "tsc --noEmit"`, `"lint": "expo lint"`) to Item 1, and enumerate the concrete unit and integration test cases across `currency.test.ts`, `verificationRules.test.ts`, and `security_and_marketplace_rpcs.test.ts` in Item 24.

### [Issue 6] [`egm-design`] - Severity: Medium
*   **Affected Scope:** [Lines 707-708](docs/designs/gigormoc_marketplace_and_security.md#L707-L708) (`#### 3.1 Authentication, OTP, Lockout & CAPTCHA RPCs`)
*   **Discrepancy Description:** `rpc_get_project_inbox_messages(p_recipient_email text DEFAULT NULL, p_challenge_id uuid DEFAULT NULL)` returns messages matching either `auth.uid()` OR `p_recipient_email` / `p_challenge_id` during unauthenticated flows, which would allow an unauthenticated caller to query `p_recipient_email` alone without `p_challenge_id`.
*   **Rationale:** Requiring both `p_challenge_id` (non-expired UUID returned when initiating signup or password reset) and matching `p_recipient_email` when `auth.uid() IS NULL` prevents unauthenticated enumeration of inbox messages by email address alone.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Tightening the unauthenticated branch of `rpc_get_project_inbox_messages` preserves the evaluator demo UX (since `signup-step2.tsx` and `forgot-password.tsx` store `activeChallengeId` + `activeInboxEmail` in `AuthContext`) while preventing email-only OTP scraping.
*   ***Proposed Edit:***
    *   Location: `#### 3.1` Bullet 4 (`rpc_get_project_inbox_messages`, `Lines 707-708`)
    *   Change: Specify that when `auth.uid() IS NOT NULL`, `rpc_get_project_inbox_messages` returns recent messages for `user_id = auth.uid()`; when `auth.uid() IS NULL`, it requires **both** a non-null `p_challenge_id` and matching `lower(recipient_email) = lower(p_recipient_email)` for an unconsumed challenge with `expires_at > now()` and `purpose IN ('signup_verification', 'password_reset')`.

### [Issue 7] [`egm-design`] - Severity: Medium
*   **Affected Scope:** [Lines 743-752](docs/designs/gigormoc_marketplace_and_security.md#L743-L752) (`#### 3.2 Marketplace, Contract & Mode-Switch RPCs`)
*   **Discrepancy Description:** `internal_check_agreement_completion(agreement_id)` requires `SUM(confirmed_received payments) == agreements.total_amount_centavos`, but `rpc_report_external_payment` does not prevent reporting duplicate or over-budget milestone payments.
*   **Rationale:** If duplicate or excessive payments are reported and confirmed, the sum exceeds `total_amount_centavos` and prevents the strict `==` completion transition from firing.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Enforcing in `rpc_report_external_payment` that `p_amount_centavos` equals the target milestone's `amount_centavos`, that no active (`reported_sent` or `confirmed_received`) payment already exists for that milestone, and that total active/confirmed payments for the agreement do not exceed `total_amount_centavos` guarantees the centavo ledger cannot over-report.
*   ***Proposed Edit:***
    *   Location: `#### 3.2` Bullet 4 (`rpc_report_external_payment`, `Lines 749-752`)
    *   Change: Specify full signature `rpc_report_external_payment(p_agreement_id uuid, p_milestone_id uuid, p_payment_method text, p_amount_centavos bigint, p_reference_number text, p_proof_url text DEFAULT NULL)` and require that `p_amount_centavos == milestones.amount_centavos`, no row in `external_payments` for `p_milestone_id` already has `status IN ('reported_sent', 'confirmed_received')`, and `SUM(amount_centavos) WHERE status IN ('reported_sent', 'confirmed_received') <= agreements.total_amount_centavos`.

### [Issue 8] [`egm-design`, `egm-structural`] - Severity: Medium
*   **Affected Scope:** [Lines 815-828](docs/designs/gigormoc_marketplace_and_security.md#L815-L828) (`## Non-Functional Requirements`)
*   **Discrepancy Description:** `feature-spec-standard.md` requires an explicit `## Risks & Mitigations` (`Risks & Limits`) section calling out architectural constraints, failure modes, security trade-offs, and scalability limits.
*   **Rationale:** Documenting the operational bounds of single-row JSONB backups, in-database bcrypt cost factors, and classroom demo controls ensures transparent engineering trade-offs.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Adding `## Risks & Mitigations` immediately before `## Non-Functional Requirements` satisfies the Feature Spec Standard and addresses all three operational risks raised by `egm-design`.
*   ***Proposed Edit:***
    *   Location: Before `## Non-Functional Requirements` (`Line 817`)
    *   Change: Insert `## Risks & Mitigations` covering: (1) Single-row JSONB snapshot size ceiling (`< 50,000` total rows target scale, mitigated by retaining the latest 30 `scheduled` snapshots and excluding `audit_events` / `database_backups` from nested snapshots); (2) In-database `pgcrypto` bcrypt CPU cost (mitigated by using cost factor `gen_salt('bf', 8)` for short-lived 5-minute OTP/CAPTCHA hashes and `gen_salt('bf', 10)` for user passwords, bounded by 3-strike lockouts and 60s cooldowns); and (3) Classroom evaluator demo scope for `<ProjectMailInbox />` and `<VisualCaptcha />`.

### [Issue 9] [`egm-implementation-readiness`, `egm-codebase-details`] - Severity: Medium
*   **Affected Scope:** [Lines 852-861](docs/designs/gigormoc_marketplace_and_security.md#L852-L861) (`#### 2. ../../supabase/migrations/001_core_security_and_auth.sql` and `#### 3. ../../supabase/migrations/002_marketplace_agreements_and_admin.sql`)
*   **Discrepancy Description:** Items 2 and 3 omit the explicit per-table Row-Level Security (RLS) policy rules, the `ALTER PUBLICATION supabase_realtime ADD TABLE ...` statements for the 5 Realtime tables, and the creation + RLS policies for the 3 Supabase Storage buckets (`avatars`, `deliverables`, `payment-proofs`).
*   **Rationale:** Without explicit RLS rules, Realtime publication registration, and Storage bucket setup in the migrations, Realtime subscriptions will not fire and file uploads or public/private table reads will fail.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Adding the per-table RLS summary, `supabase_realtime` publication registration (`project_inbox_messages`, `user_sessions`, `profiles`, `messages`, `notifications`), and `storage.buckets` + `storage.objects` policies to Items 2 and 3 makes the database migrations self-contained.
*   ***Proposed Edit:***
    *   Location: `#### 2` (`Lines 852-856`) and `#### 3` (`Lines 857-861`)
    *   Change: Add the explicit RLS rules (requiring `public.is_authenticated_session_valid()`, restricting direct `SELECT` on `public.profiles` to `id = auth.uid()` or `platform_admins` while public profile lookups use `rpc_get_public_profile`, restricting `audit_events` and `database_backups` `SELECT` to `platform_admins`, and scoping `conversations`/`messages` to `client_id = auth.uid() OR freelancer_id = auth.uid()`), `ALTER PUBLICATION supabase_realtime ADD TABLE` for the 5 Realtime tables, and `storage.buckets` / `storage.objects` policies for `avatars`, `deliverables`, and `payment-proofs`.

### [Issue 10] [`egm-implementation-readiness`, `egm-codebase-details`] - Severity: Medium
*   **Affected Scope:** [Lines 843-1021](docs/designs/gigormoc_marketplace_and_security.md#L843-L1021) (`## Detailed Implementation Plan`)
*   **Discrepancy Description:** Items 1–24 in `## Detailed Implementation Plan` are presented as a single flat list without logical phase boundaries or intermediate build/test checkpoints.
*   **Rationale:** `implementation-readiness-standard.md` requires organizing implementation steps into incremental phases where each phase leaves the project in a verifiable state.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Grouping Items 1–24 into 5 incremental phases with a concrete verification checkpoint at the end of each phase satisfies the Implementation Readiness Standard without altering the 24 file groups.
*   ***Proposed Edit:***
    *   Location: `## Detailed Implementation Plan` (`Lines 843-1013`)
    *   Change: Organize Items 1–24 under 5 phase subheadings (`Phase 1: Workspace Configuration, Database Migrations, Seed & Core Libraries [Items 1–7]`, `Phase 2: Auth Context, Global Security Guards & Auth/Onboarding Screens [Items 8–16]`, `Phase 3: Main Bottom-Tab Shell, Gigs & Milestone Agreements Lifecycle [Items 17–19]`, `Phase 4: Real-Time Chat, Notifications, Profile, Reports & Security Settings [Items 20–22]`, and `Phase 5: Admin Governance Portal & Automated Test Suite [Items 23–24]`) with a build/verification checkpoint at the end of each phase.

### [Issue 11] [`egm-comprehension`, `egm-zoom-out`, `egm-implementation-readiness`, `egm-codebase-details`] - Severity: Medium
*   **Affected Scope:** [Lines 766-767, 862-866, 1007](docs/designs/gigormoc_marketplace_and_security.md#L862-L866) (`#### 3.3`, `#### 4. ../../supabase/seed.sql`, and `#### 23. ../../app/admin/backups.tsx`)
*   **Discrepancy Description:** Item 4 (`seed.sql`) does not specify the exact seeded `Super Admin` and `Admin` usernames, emails, and passwords, and Section 3.3 / Item 23 do not specify what triggers `'scheduled'` database backups in local/classroom environments.
*   **Rationale:** Evaluators and automated tests need deterministic bootstrap Admin credentials, and `'scheduled'` backups need a zero-infrastructure trigger that works without external cron daemons.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Specifying the exact seeded Admin accounts (`superadmin@gigormoc.ph` / `SuperAdmin@123!` and `admin@gigormoc.ph` / `AdminPass@123!`), an initial seeded `'scheduled'` backup snapshot, and an idempotent `rpc_admin_ensure_scheduled_backup()` check invoked on Admin Dashboard/Backups load (creating a daily `'scheduled'` snapshot if none exists in the past 24 hours) resolves both gaps with zero external infrastructure.
*   ***Proposed Edit:***
    *   Location: `#### 3.3` (`Line 766`), `#### 4. ../../supabase/seed.sql` (`Lines 862-866`), and `#### 23` (`Lines 1001, 1007`)
    *   Change: Document the deterministic seed credentials (`superadmin` / `superadmin@gigormoc.ph` / `SuperAdmin@123!` and `admin` / `admin@gigormoc.ph` / `AdminPass@123!`), 24 Ormoc skills across 8 categories, and initial `'scheduled'` backup row in Item 4, and add `rpc_admin_ensure_scheduled_backup()` in Section 3.3 and Item 23.

### [Issue 12] [`egm-codebase-details`, `egm-zoom-out`] - Severity: Medium
*   **Affected Scope:** [Lines 867-875](docs/designs/gigormoc_marketplace_and_security.md#L867-L875) (`#### 5. ../../lib/supabase.ts` and `#### 6. ../../lib/currency.ts`)
*   **Discrepancy Description:** `parsePhpToCentavos(input: string)` returns `bigint | null` while `validateMilestoneSum` accepts `number[]`, and passing a JS `bigint` into `@supabase/supabase-js` `.rpc()` throws `TypeError: Do not know how to serialize a BigInt`. Additionally, exporting 30+ individual pass-through wrapper functions in `lib/supabase.ts` creates unnecessary boilerplate.
*   **Rationale:** Standardizing TypeScript centavo utilities on safe integer `number` (`Number.isSafeInteger`, accurate up to PHP 90 trillion) and using a single generic typed `callRpc<T>(fnName, params)` dispatcher in `lib/supabase.ts` prevents runtime `BigInt` JSON serialization crashes and eliminates wrapper bloat.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Safe integers (`number`) serialize natively in `JSON.stringify` for PostgreSQL `bigint` parameters and return values, and `callRpc<T>` provides full TypeScript safety with minimal code.
*   ***Proposed Edit:***
    *   Location: `#### 5. ../../lib/supabase.ts` (`Lines 867-871`) and `#### 6. ../../lib/currency.ts` (`Lines 872-876`)
    *   Change: Update `lib/supabase.ts` to export a single generic typed dispatcher `callRpc<T>(fnName: RpcName, params?: Record<string, unknown>): Promise<RpcEnvelope<T>>` plus Realtime subscription helpers, and standardize `lib/currency.ts` on safe integer `number` (`parsePhpToCentavos(input: string): number | null`, `formatCentavosToPhp(centavos: number): string`, `validateMilestoneSum(milestoneCentavos: number[], contractTotalCentavos: number): { valid: boolean; deltaCentavos: number }`).

### [Issue 13] [`egm-design`] - Severity: Low
*   **Affected Scope:** [Lines 721-726](docs/designs/gigormoc_marketplace_and_security.md#L721-L726) (`#### 3.1 Authentication, OTP, Lockout & CAPTCHA RPCs`)
*   **Discrepancy Description:** In `rpc_verify_credentials_and_gate`, `active_captcha_hash` is rotated when the CAPTCHA check fails and cleared when the password matches, but is not invalidated when the CAPTCHA check succeeds and the subsequent password check fails.
*   **Rationale:** Invalidating `active_captcha_hash` on every credential verification attempt forces a fresh CAPTCHA challenge if the password check fails.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** One-sentence update to `rpc_verify_credentials_and_gate` prevents CAPTCHA replay across post-lockout password guesses.
*   ***Proposed Edit:***
    *   Location: `#### 3.1` Bullet 7 (`rpc_verify_credentials_and_gate`, `Lines 721-725`)
    *   Change: Specify that `active_captcha_hash` is cleared (`NULL`) on every credential check after CAPTCHA evaluation (including when the CAPTCHA matches and the password fails) so each post-lockout login attempt requires a fresh single-use CAPTCHA code.

### [Issue 14] [`egm-zoom-out`] - Severity: Low
*   **Affected Scope:** [Lines 902-906](docs/designs/gigormoc_marketplace_and_security.md#L902-L906) (`#### 12. ../../components/security/SessionSyncGuard.tsx (Create)`)
*   **Discrepancy Description:** `SessionSyncGuard.tsx` proposes listening to three overlapping channels simultaneously: web `BroadcastChannel('gigormoc_auth_sync')`, window `storage` events, and Supabase Realtime updates on `public.user_sessions` and `public.profiles`.
*   **Rationale:** `@supabase/supabase-js` already synchronizes `localStorage` auth state across same-origin browser tabs via `onAuthStateChange`.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Pairing `supabase.auth.onAuthStateChange` (plus `BroadcastChannel('gigormoc_auth_sync')` on web) with the Supabase Realtime subscription on `public.user_sessions` and `public.profiles` removes redundant manual `window.storage` event listeners.
*   ***Proposed Edit:***
    *   Location: `#### 12. ../../components/security/SessionSyncGuard.tsx (Create)` (`Lines 902-906`)
    *   Change: Replace the `storage` event listener description with `supabase.auth.onAuthStateChange` paired with `BroadcastChannel('gigormoc_auth_sync')` (web) and Supabase Realtime subscriptions on `public.user_sessions` and `public.profiles`.

### [Issue 15] [`egm-structural`] - Severity: Low
*   **Affected Scope:** [Lines 760, 828-845](docs/designs/gigormoc_marketplace_and_security.md#L828-L845) (`#### 3.3`, `### Additional Resources`, `### Future Improvements`, and `## Detailed Implementation Plan`)
*   **Discrepancy Description:** `### Additional Resources` (Line 830) and `### Future Improvements` (Line 836) use H3 headings after a top-level section divider instead of H2 headings; `#### 3.3` omits the SQL migration filename suffix used in `#### 3.1` and `#### 3.2`; and `DetailedRange` uses `../../` relative paths without a brief note explaining they are relative to `docs/designs/`.
*   **Rationale:** Maintaining strict H1 -> H2 -> H3 -> H4 hierarchy, symmetric H4 titles, and an explicit path-prefix note improves document readability and template compliance.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Straightforward structural cleanup across three headings and one introductory note.
*   ***Proposed Edit:***
    *   Location: `Line 760`, `Lines 830-836`, and `Line 845`
    *   Change: Append `` (`001_core_security_and_auth.sql` & `002_marketplace_agreements_and_admin.sql`) `` to `#### 3.3`, promote `## Additional Resources` and `## Future Improvements` to H2, and add a one-line note under `### Target Files to Create/Modify` stating that `../../` paths are relative to `docs/designs/gigormoc_marketplace_and_security.md` (resolving to the repository root).

### [Issue 16] [`egm-style`] - Severity: Low
*   **Affected Scope:** [Lines 19, 39, 52, 787, 795, 813, 824, 880, 910, 924, 984, 1001, 1012](docs/designs/gigormoc_marketplace_and_security.md#L19-L52) (`FeatureRange` and `DetailedRange` prose)
*   **Discrepancy Description:** Minor style and copy-editing issues flagged by `egm-style` across Stages 7 and 9: hyperbolic `"endless"` (Line 19), redundant `"simulating fake"` (Line 39), 74-word run-on sentence in CUJ 1 `When` (Line 52), redundant `"external third-party"` (Line 787), overly absolute `"guarantees that"` / `"never cause drift"` (Lines 795, 813, 824), `"zero-LLM skill suggestions"` (Line 880), subjective `"an honest empty-state card"` (Line 910), colloquial `"unique made-up email"` (Line 924), promotional `"powered by rpc_get_public_profile"` (Line 984), filler `"Dedicated"` (Line 1001), and shorthand `"non-destructive backup/restore"` (Line 1012).
*   **Rationale:** Replacing informal, hyperbolic, or redundant phrasing with objective technical language aligns the specification with the Style & Copy-Editing Standard.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Direct wording replacements tighten the prose without changing technical behavior.
*   ***Proposed Edit:***
    *   Location: `Lines 19, 39, 52, 787, 795, 813, 824, 880, 910, 924, 984, 1001, 1012`
    *   Change: Replace `"endless unpaid revisions"` with `"uncapped unpaid revisions"`; `"simulating fake wallet balances"` with `"simulating wallet balances"`; split CUJ 1 `When` into a numbered 4-step sequence; replace `"external third-party email inboxes"` with `"external email inboxes"`; replace `"guarantees that"` with `"ensures that"`; replace `"never cause drift"` with `"do not accumulate client-side timer drift"`; replace `"zero-LLM skill suggestions"` with `"deterministic catalog-based skill suggestions"`; replace `"an honest empty-state card when tables contain zero rows"` with `"a standard empty-state placeholder rendered when queries return zero rows (without fallback mock data)"`; replace `"unique made-up email"` with `"unique syntactically valid email address (external SMTP deliverability not required)"`; replace `"powered by rpc_get_public_profile"` with `"populated via rpc_get_public_profile"`; remove `"Dedicated"` on Line 1001; and replace `"non-destructive backup/restore"` on Line 1012 with `"backup/restore preserving audit_events and database_backups"`.
