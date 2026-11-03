# Drift Detection Report

**Date:** 2026-11-02  
**Target:** `docs/designs/gigormoc_marketplace_and_security.md`  

## gigormoc_marketplace_and_security.md

*   **Notification Schema & Deep-Linking Divergence (`app/notifications.tsx` vs. `public.notifications`):**
    *   **Design/Schema:** `public.notifications` defines `notification_type text NOT NULL` and `target_route text` (e.g. `'/agreements/' || v_agr.id`).
    *   **Code Implementation:** `app/notifications.tsx` declared `interface NotificationItem` with `type: string` and `data?: { agreement_id?: string; gig_id?: string }`, ignoring `target_route` and `notification_type`. Tapping notifications failed to navigate, and notification icons always defaulted to fallback gray icons.
*   **Startup Profile Race Condition (`context/AuthContext.tsx` & `app/index.tsx`):**
    *   **Design:** Authenticated users with active sessions are automatically restored and routed to the home feed `/(tabs)` or admin portal `app/admin/dashboard.tsx`.
    *   **Code Implementation:** `supabase.auth.getSession()` called `fetchProfileAndAdmin(initialSession.user.id)` asynchronously without `await`, setting `setIsLoading(false)` synchronously before the profile query returned. `app/index.tsx` evaluated `if (!session || !profile)` while `isLoading === false` and `profile === null`, immediately kicking users back to `/(auth)/welcome`.
*   **GoTrue `auth.users.email_confirmed_at` Desynchronization (`rpc_verify_otp`):**
    *   **Design:** Verifying the 6-digit in-app OTP on signup marks the user as confirmed for subsequent authentication.
    *   **Code Implementation:** `rpc_verify_otp` in `supabase/migrations/001_core_security_and_auth.sql` updated `public.profiles SET email_verified = true`, but omitted `UPDATE auth.users SET email_confirmed_at = now()`. Supabase GoTrue Auth checks `auth.users.email_confirmed_at` during `supabase.auth.signInWithPassword`, causing subsequent sign-ins to be blocked with `Email not confirmed`.
*   **Expo Web Routing Output Strategy (`app.json`):**
    *   **Design:** Cross-platform web support via Expo Router single-page architecture.
    *   **Code Implementation:** `app.json` was initially configured with `"output": "static"`, which enforced static pre-rendering on Node.js requiring missing server runtime modules (`expo-font/build/server`) and failing on dynamic route paths (`[id]`). Corrected to `"output": "single"` for Expo Router web bundling.
*   **`react-native-web` 0.19.13 Vendor Packaging Defect:**
    *   **Design:** Use standard `react-native-web` for browser compilation.
    *   **Code Implementation:** The published `react-native-web@0.19.13` npm package only included `.flow` files in `dist/vendor/react-native/` (e.g. `LayoutAnimation/index.js.flow`) while compiled `.js` files were located in `src/vendor/react-native/`, causing Metro bundler to fail on exports of `LayoutAnimation`, `FlatList`, and `PanResponder` until synchronized.
*   **Milestone Completion Boundary Invariant (`002_marketplace_agreements_and_admin.sql`):**
    *   **Design:** Agreements complete when all milestones are approved and external payments meet or exceed the total contract value.
    *   **Code Implementation:** `internal_check_agreement_completion` checked `IF v_paid_centavos = v_agr.total_amount_centavos`, which failed to trigger completion if payments slightly exceeded total or if multiple overpayments occurred. Should be `v_paid_centavos >= v_agr.total_amount_centavos`.
