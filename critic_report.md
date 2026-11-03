# Stage 7: Critic Review Report (Design, Structural & Style)

*   **Document Audited:** [`docs/designs/ui_design_system.md`](file:///c:/Users/denverjmliaz/Documents/GigOrmocProject/GigOrmocApp/docs/designs/ui_design_system.md)
*   **Target Scope:** `FeatureRange` (lines 1..199)
*   **Reviewers:** `egm-design` (Design Critic), `egm-structural` (Document Architect), `egm-style` (Technical Copy Editor)
*   **Standards Applied:** Feature Spec Standard, Architectural Robustness, Layout Symmetry, Technical Precision
*   **Date:** 2026-11-02

---

## Executive Summary

The Critic Review identified critical architectural, accessibility, structural, and stylistic defects across `FeatureRange`. The specification has 3 Blockers that will cause runtime crashes or accessibility compliance failures, 11 Major issues spanning role contradiction, arithmetic mismatches, multiline input clipping, and marketing language, and 10 Nits.

---

## Consolidated Findings

### 🔴 Blockers

#### 1. WCAG 2.1 AA Contrast Failures on Essential Text and Interactive Tokens (`egm-design`)
*   **Affected Scope:** Section 1.2 (lines 20, 39–64)
*   **Technical Rationale:** The document asserts WCAG 2.1 AA compliance, but `colors.textMuted` (`#94A3B8`) on white (`#FFFFFF`) or soft slate (`#F8FAFC`) has a contrast ratio of only **~2.4:1**, far below the mandatory **4.5:1** threshold for body text and metadata. Under direct sunlight in mobile outdoor usage in Ormoc, this text is illegible. Similarly, `colors.primaryLight` (`#3B82F6`) on white surfaces has only **~2.8:1** contrast, failing the **3:1** minimum for graphical and interactive elements.
*   **Required Fix:** Darken `colors.textMuted` to `#64748B` (~4.6:1) or `#475569` (~5.5:1). Reserve decorative border tokens strictly for borders and separate them from typography tokens.

#### 2. Architectural Contradiction Between Dynamic Dual-Mode Switching and 7-Day Cooldown (`egm-design`, `egm-comprehension`)
*   **Affected Scope:** Section 2 (lines 67–82) vs. Section 4.7 (line 196)
*   **Technical Rationale:** Section 2 designs an instantaneous in-app workspace switcher ("Users toggle between freelancer and client", top header mode chip, dynamic home screen layouts, and colored mode banners). Conversely, Section 4.7 mandates a "Mode switch confirmation screen with 7-day cooldown reminder." If an account is locked into a single mode for 7 days, the dynamic header mode toggle, instantaneous home tab swapping, and dual-role navigation are invalid.
*   **Required Fix:** Clearly define the architectural model: regular users operate in a single active role with a server-enforced 7-day cooldown, but the UI must clearly display their *current active mode* banner while providing a settings link to initiate a formal mode switch.

#### 3. React Native Dynamic Grid Breakpoint Crashes and Layout Invalidity (`egm-design`)
*   **Affected Scope:** Section 3.1 (lines 89–94)
*   **Technical Rationale:** The spec dictates a responsive multi-column grid ("1 column on Mobile; 2 columns on Tablet (>= 768px); 3 columns on Desktop (>= 1024px)") and centering via `marginHorizontal: 'auto'`.
    1. In React Native / Expo, `FlatList` cannot dynamically change `numColumns` at runtime (e.g., on tablet orientation change or browser window resize) without throwing a fatal exception: `Cannot change number of columns dynamically on a FlatList`.
    2. Native React Native Yoga engines do not natively support CSS Grid, and `marginHorizontal: 'auto'` can fail or be ignored on native platforms unless combined with flexbox centering primitives (`alignSelf: 'center'`).
*   **Required Fix:** Mandate that `FlatList` dynamically updates its `key` prop when columns change (`key={`grid-${numColumns}`}`) to force remounting. Replace `marginHorizontal: 'auto'` with `{ width: '100%', maxWidth: 1140, alignSelf: 'center' }`.

---

### 🟡 Major Findings

#### 4. Semantic Color Collision: `colors.success` Overloaded with `colors.freelancer` (`egm-design`, `egm-style`, `egm-comprehension`)
*   **Affected Scope:** Section 1.2 (lines 57–61)
*   **Technical Rationale:** Line 61 assigns `colors.success` to `#0284C7` (Sky Blue), identical to `colors.freelancer`, with a conditional note `"(or #059669 where cash-positive)"`. Overloading the role accent color as a success indicator creates severe cognitive confusion: users cannot tell if a sky blue badge designates a Freelancer entity or an Approved/Paid milestone. Conditional token definitions ("or `#059669`") break deterministic design token usage.
*   **Required Fix:** Decouple status feedback completely from role branding. Retain `#0284C7` exclusively for `colors.freelancer`, and assign `colors.success` strictly to an accessible semantic green (`#059669` / `#16A34A`).

#### 5. Screen Count Arithmetic Mismatch (`egm-structural`)
*   **Affected Scope:** Section 4 Heading and Subsections (lines 112, 114, 134, 153, 165, 177, 185, 191)
*   **Technical Rationale:** The top-level heading declares `## 4. Screen-by-Screen Redesign Specifications (43 Screens)`. However, the sum of screens declared across subsections 4.1 through 4.7 is **44 Screens** (9 + 5 + 4 + 7 + 2 + 7 + 10 = 44). The structural header metadata contradicts the subsection declarations.
*   **Required Fix:** Audit and reconcile the exact route inventory across the app to ensure headings and totals match canonical route files.

#### 6. Under-Specified Screen Count & Shorthand Notation in Section 4.4 (`egm-structural`)
*   **Affected Scope:** Section 4.4 (lines 165–176)
*   **Technical Rationale:** Subsection 4.4 is titled `### 4.4 Agreements & Milestone Execution (7 Screens)`, but lists only 6 screens. The 7th screen (`app/agreements/[id]/review.tsx`) is omitted. Additionally, lines 172 and 174 lapse into relative ellipsis notation (`.../submit.tsx`) instead of canonical Expo Router file paths.
*   **Required Fix:** Explicitly list all 7 agreement routes using canonical file paths.

#### 7. Structural Parity Degradation via Wildcard Lumping (`egm-structural`)
*   **Affected Scope:** Sections 4.6 and 4.7 (lines 185–197)
*   **Technical Rationale:** While sections 4.1–4.3 explicitly enumerate individual screen routes, sections 4.6 and 4.7 collapse specifications into broad directory wildcards (`app/admin/*`, `app/profile/*`, `app/settings/*`), omitting discrete route filenames.
*   **Required Fix:** Explicitly list all screen files across Admin (7 screens) and Settings/Profile (10 screens).

#### 8. Inflexible Global Form Field Height for Multiline Text Inputs (`egm-design`)
*   **Affected Scope:** Section 3.1 (lines 96–97), Section 4.3 (lines 154, 161)
*   **Technical Rationale:** Line 97 mandates: "Form fields have `height: 48px`, `borderRadius: 10px`, `borderWidth: 1.5px`...". Applying a rigid 48px height across all form inputs breaks multiline fields (Gig Description, Application Cover Note, Bio, Milestone Submission Notes), causing clipped text and scroll errors.
*   **Required Fix:** Differentiate single-line inputs (`height: 48px`) from multiline `TextArea` components (`minHeight: 120px`, `textAlignVertical: 'top'`), and mandate `KeyboardAvoidingView` containers.

#### 9. Milestone Sum Centavo Deadlock and Missing Terminal Revision State (`egm-design`)
*   **Affected Scope:** Section 4.4 (lines 170–174)
*   **Technical Rationale:** Dividing contract amounts into multiple milestones creates rounding discrepancies (e.g., ₱1,000 / 3 = ₱333.33 * 3 = ₱999.99). A strict `sum === 100%` check without automatic centavo remainder allocation blocks submission. Additionally, the spec displays a revision counter ("Revision 1 of 2") but defines no terminal state when 2 revisions are exhausted.
*   **Required Fix:** Specify automatic centavo remainder distribution and define the terminal action when the 2-revision cap is exceeded (transitioning agreement status to `disputed`).

#### 10. Subjective Historical Commentary and Fluff Descriptors (`egm-style`)
*   **Affected Scope:** Lines 20, 99
*   **Technical Rationale:** Line 20 asserts that the visual system "moves away from generic greens and plain grays to an authoritative, modern blue-and-white theme," and Line 99 states it "replaced harsh flat borders with modern subtle elevation." Technical specifications must define target states factually rather than editorializing on prior implementations.
*   **Required Fix:** Replace subjective commentary with objective technical statements.

#### 11. Marketing Nomenclature and Paint-Swatch Color Descriptions (`egm-style`)
*   **Affected Scope:** Lines 1, 5, 24–32, 41, 117, 121, 123, 124
*   **Technical Rationale:** Phrasing such as "Royal Ocean Blue", "Electric Cobalt", "Ice Blue Tint", "Soft Slate-White", and "Crisp Pure White" obscures technical precision.
*   **Required Fix:** Identify visual elements strictly by functional design token names (`colors.primary`, `colors.surface`) and hex values (`#2563EB`, `#FFFFFF`).

#### 12. Repetitive Filler Adjective ("Clean") (`egm-style`)
*   **Affected Scope:** Lines 16, 87, 117, 121, 127, 130, 138, 155
*   **Technical Rationale:** The word "clean" appears 8 times as a placeholder for technical specifications without conveying concrete spacing, padding, layout bounds, or typographic hierarchy.
*   **Required Fix:** Replace instances of "clean" with explicit spacing, padding, and layout parameters.

---

### 🟢 Nit Findings

*   **13. In-House Server CAPTCHA Accessibility (`egm-design`):** Line 121 specifies a server-generated visual CAPTCHA box without defining the required audio fallback for WCAG 1.1.1 accessibility compliance.
*   **14. Platform-Divergent Shadow Elevation (`egm-design`):** Wrap shadow definitions in a platform-aware helper (`Platform.select`) that maps to CSS `boxShadow` on Web and calibrated `elevation` on Android.
*   **15. Leaked Development/Demo Tooling (`egm-design`):** Line 128 documents a "Project Demo Mail banner notification". Explicitly mark this as `[DEV_ONLY / MOCK_HARNESS]`.
*   **16. Missing Section Numbering (`egm-structural`):** Line 200 drops numbering (`## Detailed Implementation Plan` instead of `## 5. Detailed Implementation Plan`).
*   **17. Singleton Subsection (`egm-structural`):** Section 3 contains only `3.1 Layout Invariants` without a balancing `3.2`.
*   **18. Unnumbered H4 Header (`egm-structural`):** Line 37 `#### Palette Token Reference` omits dot numbering (`#### 1.2.1`).
*   **19. Fenced Code Block Language Missing (`egm-structural`):** Line 22 ASCII layout block opens with bare triple backticks without a language identifier (`text`).
*   **20. Inconsistent Table Delimiter Padding (`egm-structural`):** Lines 44–50 omit whitespace around pipe delimiters.
*   **21. Recurring Buzzword "Modern" (`egm-style`):** Subjective non-verifiable claims ("modern blue-and-white theme").
*   **22. Subjective Qualifier "Subtle" (`egm-style`):** Replace vague phrases like "subtle elevation" with explicit token values.
*   **23. Non-Standard Process Jargon (`egm-style`):** Remove "Stress-Test Requirement" from the Section 2 heading.
*   **24. Imprecise Heading "Touch & Pointer Disciplines" (`egm-style`):** Rename to "Touch & Pointer Interaction Constraints".
