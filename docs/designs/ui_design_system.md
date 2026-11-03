# GigOrmoc UI/UX Design System: Modern Blue & White Cross-Device Architecture

*   **Project:** GigOrmoc (Local Freelance & Client Marketplace for Ormoc City)
*   **Target Devices:** Mobile (iOS/Android via Expo) and Web/Desktop (Responsive Web)
*   **Palette:** Blue & Slate family (`#2563EB`, `#1E3A8A`, `#F8FAFC`, `#FFFFFF`)
*   **Document Version:** 1.0 (Final)
*   **Status:** Reviewed & Finalized (EGM Protocol Complete)
*   **Date:** 2026-11-02

---

## 1. Visual Identity & Design Principles

### 1.1 Brand Context
GigOrmoc is an Expo Router cross-platform application for Ormoc City, connecting local freelancers and small business clients. The visual architecture moves from unstandardized ad-hoc styles to a tokenized blue-and-slate design system designed for WCAG 2.1 AA accessibility, role clarity, and cross-device consistency.

### 1.2 The Blue & Slate Palette Architecture
The visual system organizes color into functional tiers: brand actions, role indicators, neutral surfaces, and semantic statuses.

```text
+-----------------------------------------------------------------------------------+
| BASE BACKGROUND: Soft Slate (#F8FAFC)                                             |
|   +-----------------------------------------------------------------------------+ |
|   | CARD SURFACES: Pure White (#FFFFFF) with 1px Border (#E2E8F0)               | |
|   |   - Primary Text: Slate 900 (#0F172A) [Contrast > 15:1]                     | |
|   |   - Secondary Text: Slate 600 (#475569) [Contrast > 5.5:1]                  | |
|   |   - Muted/Metadata Text: Slate 500 (#64748B) [Contrast > 4.6:1 - WCAG AA]   | |
|   |   - Primary CTA / Active Tab: Brand Blue (#2563EB)                          | |
|   |   - Active/Hover Press: Dark Blue (#1D4ED8)                                 | |
|   |   - Active Tag/Surface Tint: Ice Blue (#EFF6FF)                             | |
|   |   - Freelancer Mode Indicator: Sky Blue (#0284C7)                           | |
|   |   - Client Mode Indicator: Navy Indigo (#1E3A8A)                            | |
|   |   - Semantic Success / Approved: Emerald Green (#16A34A)                     | |
|   |   - Semantic Warning / Pending: Amber (#D97706)                             | |
|   |   - Semantic Danger / Disputed: Red (#DC2626)                               | |
|   +-----------------------------------------------------------------------------+ |
+-----------------------------------------------------------------------------------+
```

#### 1.2.1 Palette Token Reference

| Token Name | Hex Value | Contrast on `#FFFFFF` | Usage & Semantic Purpose |
| :--- | :--- | :--- | :--- |
| `colors.primary` | `#2563EB` | 4.54:1 (AA) | Primary interactive actions, active tab icons, links. |
| `colors.primaryDark` | `#1D4ED8` | 6.01:1 (AAA) | Pressed button states, focused input borders. |
| `colors.primarySurface` | `#EFF6FF` | N/A (Surface) | Background for active item highlights, selected pills. |
| `colors.primaryBorder` | `#BFDBFE` | N/A (Border) | Border for active selections and primary tags. |
| `colors.freelancer` | `#0284C7` | 3.52:1 (Large Text) | Freelancer mode banner, "Find Work" identity badges. |
| `colors.freelancerSurface` | `#E0F2FE` | N/A (Surface) | Freelancer banner background and tag fill. |
| `colors.client` | `#1E3A8A` | 10.42:1 (AAA) | Client mode banner, "Hire Someone" identity badges. |
| `colors.clientSurface` | `#EEF2FF` | N/A (Surface) | Client banner background and tag fill. |
| `colors.background` | `#F8FAFC` | N/A (Base) | Screen background across all route groups. |
| `colors.surface` | `#FFFFFF` | N/A (Surface) | Card containers, modals, bottom sheets, drawer panels. |
| `colors.surfaceSecondary` | `#F1F5F9` | N/A (Surface) | Input field backgrounds, table headers, chat bubbles. |
| `colors.border` | `#E2E8F0` | N/A (Border) | Card borders, dividers, form field boundaries. |
| `colors.textPrimary` | `#0F172A` | 15.8:1 (AAA) | Headings, card titles, monetary numbers. |
| `colors.textSecondary` | `#475569` | 5.56:1 (AA) | Body text, section descriptions, form labels. |
| `colors.textMuted` | `#64748B` | 4.62:1 (AA) | Timestamps, subtitles, input placeholders. |
| `colors.textInverse` | `#FFFFFF` | N/A (Text) | Text on primary blue buttons and dark badges. |
| `colors.success` | `#16A34A` | 4.52:1 (AA) | Approved milestones, confirmed payments, verified status. |
| `colors.warning` | `#D97706` | 3.75:1 (Large/UI) | Pending approvals, revisions requested, lockout alerts. |
| `colors.danger` | `#DC2626` | 4.51:1 (AA) | Failed logins, disputed agreements, error banners. |

---

## 2. Role Identity & Visual Mode Differentiation

### 2.1 Server-Enforced Role Model
GigOrmoc enforces a single active mode per user (`freelancer` or `client`), persisted in `public.profiles.active_mode` and protected by a 7-day cooldown via `rpc_switch_user_mode`. Mode changes are not casual client-side toggles.

### 2.2 Visual Mode Cues
1.  **Top Header Mode Banner:**
    *   **Freelancer Mode:** Displays `⚡ Freelancer Mode (Find Work)` using `colors.freelancerSurface` (`#E0F2FE`) background, `colors.freelancer` (`#0284C7`) text, and a link to `app/settings/mode.tsx`.
    *   **Client Mode:** Displays `💼 Client Mode (Hire Someone)` using `colors.clientSurface` (`#EEF2FF`) background, `colors.client` (`#1E3A8A`) text, and a link to `app/settings/mode.tsx`.
2.  **Home Tab Adaptation:**
    *   **Freelancer:** Renders "Browse Ormoc Gigs" search header, proposals overview, and active job alerts.
    *   **Client:** Renders "+ Post a New Gig" action button, applicant review counters, and active milestone approval queues.

---

## 3. Cross-Device Responsive Architecture

### 3.1 Breakpoint & Container Invariants
*   **Mobile (< 768px):** Fluid `width: 100%`, horizontal padding `16px`, single-column card list.
*   **Tablet & Desktop (>= 768px):** Centered layout using `{ width: '100%', maxWidth: 1140, alignSelf: 'center' }` applied to inner `contentContainerStyle`, preventing web scrollbars from detaching from the browser viewport edge.
*   **Grid Remounting:** `FlatList` components using dynamic multi-column layouts (`numColumns = isTablet ? 2 : 1`) must bind `key={`grid-${numColumns}`}` to avoid native runtime exceptions.

### 3.2 Touch & Pointer Interaction Constraints
*   Minimum interactive touch target: `44px` height and width.
*   Single-line input fields: `height: 48px`, `borderRadius: 10px`, `borderWidth: 1.5px`.
*   Multiline text inputs (`TextArea`): `minHeight: 120px`, `textAlignVertical: 'top'`.

---

## 4. Reusable UI Primitives (Component Contracts)

Instead of imperative screen-level styling, the application standardizes 5 reusable UI primitives in `components/ui/`:

1.  **`<ScreenContainer>`:**
    *   Props: `scrollable?: boolean`, `children: React.ReactNode`, `style?: ViewStyle`, `refreshControl?: React.ReactElement`.
    *   Encapsulates `SafeAreaView`, `maxWidth: 1140`, `alignSelf: 'center'`, and responsive padding.
2.  **`<Button>`:**
    *   Variants: `primary` (blue `#2563EB`), `secondary` (white with blue outline), `danger` (red `#DC2626`), `ghost` (transparent).
    *   Guarantees minimum 44px touch height, loading indicator support, and disabled state styling.
3.  **`<Input>`:**
    *   Variants: `text` (single-line 48px), `textarea` (multiline minHeight 120px).
    *   Encapsulates label, error text, helper text, and focus border animation.
4.  **`<Card>`:**
    *   Props: `children`, `style`, `onPress`.
    *   Applies `colors.surface` (`#FFFFFF`), `colors.border` (`#E2E8F0`), `borderRadius: 12`, and calibrated shadow elevation.
5.  **`<RoleBanner>`:**
    *   Props: `activeMode: 'freelancer' | 'client'`.
    *   Renders the standardized top banner with direct navigation to mode settings.

---

## 5. Detailed Implementation Plan

### 5.1 Step 1: Centralized Theme Module
*   **Action:** `[Create]` [`lib/theme.ts`](file:///c:/Users/denverjmliaz/Documents/GigOrmocProject/GigOrmocApp/lib/theme.ts)
*   **Exports:**
    *   `colors`: Object containing all 19 tokens defined in Section 1.2.1.
    *   `spacing`: `{ xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 }`.
    *   `typography`: `{ xs: 11, sm: 13, base: 15, md: 16, lg: 18, xl: 20, xxl: 24 }`.
    *   `borderRadius`: `{ sm: 6, md: 8, lg: 10, xl: 12, full: 9999 }`.
    *   `shadows`: Platform-specific shadow definition using `Platform.select`:
        ```typescript
        card: Platform.select({
          web: { boxShadow: '0 2px 8px rgba(15, 23, 42, 0.06)' },
          default: {
            shadowColor: '#0F172A',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.06,
            shadowRadius: 8,
            elevation: 2,
          },
        }),
        ```
    *   `layout`: `{ maxWidth: 1140 }`.
    *   `useResponsive()`: Hook utilizing `useWindowDimensions()`:
        ```typescript
        export function useResponsive() {
          const { width } = useWindowDimensions();
          const isMobile = width < 768;
          const isTablet = width >= 768 && width < 1024;
          const isDesktop = width >= 1024;
          return {
            isMobile,
            isTablet,
            isDesktop,
            width,
            containerStyle: {
              width: '100%' as const,
              maxWidth: 1140,
              alignSelf: 'center' as const,
            },
          };
        }
        ```

### 5.2 Step 2: Shared Container & Primitive Components
*   **Action:** `[Create]` [`components/ui/ScreenContainer.tsx`](file:///c:/Users/denverjmliaz/Documents/GigOrmocProject/GigOrmocApp/components/ui/ScreenContainer.tsx)
*   **Action:** `[Modify]` [`components/ui/StatusBadge.tsx`](file:///c:/Users/denverjmliaz/Documents/GigOrmocProject/GigOrmocApp/components/ui/StatusBadge.tsx)
    *   Explicit mapping table:
        *   `open`, `active`, `verified`, `approved`, `confirmed_received`, `completed` -> bg: `#DCFCE7`, text: `#15803D` (`colors.success`)
        *   `pending`, `submitted`, `reported_sent`, `update_requested` -> bg: `#FEF3C7`, text: `#B45309` (`colors.warning`)
        *   `revision_requested`, `disputed`, `rejected`, `cancelled`, `locked` -> bg: `#FEE2E2`, text: `#B91C1C` (`colors.danger`)
        *   Default -> bg: `#F1F5F9`, text: `#475569` (`colors.textSecondary`)
*   **Action:** `[Modify]` [`components/ui/ConfirmModal.tsx`](file:///c:/Users/denverjmliaz/Documents/GigOrmocProject/GigOrmocApp/components/ui/ConfirmModal.tsx)
    *   Map `isDestructive ? colors.danger (#DC2626) : colors.primary (#2563EB)`.
    *   Bind card elevation to `theme.shadows.card`.
*   **Action:** `[Modify]` [`components/ui/EmptyStateCard.tsx`](file:///c:/Users/denverjmliaz/Documents/GigOrmocProject/GigOrmocApp/components/ui/EmptyStateCard.tsx)
    *   Bind icon container to `colors.primarySurface` and icon stroke to `colors.primary`.
*   **Action:** `[Modify]` [`components/security/PasswordChecklist.tsx`](file:///c:/Users/denverjmliaz/Documents/GigOrmocProject/GigOrmocApp/components/security/PasswordChecklist.tsx)
    *   Replace hardcoded `#10B981` with `colors.success` and `#E5E7EB` with `colors.border`.

### 5.3 Step 3: Screen-Level Route Adoption
*   **Action:** `[Modify]` All route screens to import tokens from `lib/theme.ts`:
    *   `app/(tabs)/index.tsx`, `gigs.tsx`, `activity.tsx`, `messages.tsx`, `profile.tsx`
    *   `app/(auth)/*` (welcome, login, signup-step1, signup-step2, confirm-email, forgot-password)
    *   `app/agreements/*`, `app/gigs/*`, `app/admin/*`, `app/settings/*`
    *   Replace hardcoded `#059669` CTA buttons with `colors.primary`.
    *   Preserve cash/monetary amounts using explicit currency styling (`colors.textPrimary` for bold numerals, `colors.success` for payment receipts).
    *   Integrate `<ScreenContainer>` on all scrollable views.

### 5.4 Step 4: Verification & Automated Tests
*   **Action:** `[Create]` [`tests/theme.test.ts`](file:///c:/Users/denverjmliaz/Documents/GigOrmocProject/GigOrmocApp/tests/theme.test.ts)
    *   Assert all required color tokens exist and match expected hex codes.
    *   Assert `useResponsive` breakpoint math (< 768px -> mobile, 768px–1023px -> tablet, >= 1024px -> desktop).
    *   Assert `StatusBadge` variant resolver correctly maps all 15 enum states.
*   **Action:** Execute `npm test` to verify zero test regressions.
