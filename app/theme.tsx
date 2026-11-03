import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { Platform, TextStyle, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';

/**
 * Gigormoc design tokens.
 *
 * Distinct dual-role personalities:
 *  - freelancer ("find_work"): Electric Cobalt + Emerald Mint accents, energetic, built for discovering gigs
 *  - client ("hire"):          Executive Deep Ormoc Navy + Warm Amber/Gold accents, steady, built for managing hires
 * Screens read colors from useAppTheme(); the palette switches with profile.active_mode.
 */

type Palette = {
  primary: string;
  primaryDark: string;
  primarySoft: string;
  primaryText: string; // text/icon color placed on top of `primary`
  accent: string;
  roleAccent: string;
  roleAccentSoft: string;
  heroBg: string; // large header surfaces
  heroText: string;
  heroMuted: string;
  heroChip: string; // translucent chip on hero
};

const freelancerPalette: Palette = {
  primary: '#2563EB',
  primaryDark: '#1D4ED8',
  primarySoft: '#EFF6FF',
  primaryText: '#FFFFFF',
  accent: '#10B981',
  roleAccent: '#059669',
  roleAccentSoft: '#ECFDF5',
  heroBg: '#1D4ED8',
  heroText: '#FFFFFF',
  heroMuted: '#BFDBFE',
  heroChip: 'rgba(255,255,255,0.14)',
};

const clientPalette: Palette = {
  primary: '#1E3A8A',
  primaryDark: '#0B1445',
  primarySoft: '#EEF2FF',
  primaryText: '#FFFFFF',
  accent: '#F59E0B',
  roleAccent: '#B45309', // WCAG AA 4.5:1 compliant contrast with white text
  roleAccentSoft: '#FFFBEB',
  heroBg: '#0B1445',
  heroText: '#FFFFFF',
  heroMuted: '#C7D2FE',
  heroChip: 'rgba(255,255,255,0.12)',
};

const base = {
  bg: '#F1F5F9',
  background: '#F1F5F9',
  canvas: '#F1F5F9',
  surface: '#FFFFFF',
  surfaceAlt: '#F8FAFC',
  surfaceSubtle: '#F1F5F9',
  surfaceRaised: '#FFFFFF',
  insetBg: '#F8FAFC',
  insetBorder: '#E2E8F0',
  cardHeaderBg: '#FFFFFF',
  focusRing: 'rgba(37, 99, 235, 0.24)',
  text: '#0F172A',
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textTertiary: '#94A3B8',
  muted: '#64748B',
  border: '#E2E8F0',
  borderSubtle: '#F1F5F9',
  borderDefault: '#E2E8F0',
  borderStrong: '#94A3B8',
  // Brand extras used by the first screen and highlights
  ink: '#0F172A', // solid deep ink
  spark: '#D97706', // warm highlight (ratings, "new" dots)
  sparkSoft: '#FEF3C7',
  violet: '#6366F1',
  success: '#16A34A',
  successSoft: '#F0FDF4',
  successText: '#15803D',
  warning: '#D97706',
  warningSoft: '#FFFBEB',
  warningText: '#B45309',
  primaryContrast: '#FFFFFF',
  danger: '#DC2626',
  dangerSoft: '#FEF2F2',
  dangerText: '#B91C1C',
  overlay: 'rgba(15, 23, 42, 0.60)',
};

export type AppMode = 'freelancer' | 'client';

const buildTheme = (mode: AppMode) => ({
  mode,
  isClient: mode === 'client',
  isFreelancer: mode === 'freelancer',
  modeLabel: mode === 'client' ? 'Hiring' : 'Freelancing',
  colors: {
    ...base,
    bg: '#F1F5F9',
    background: '#F1F5F9',
    canvas: '#F1F5F9',
    ...(mode === 'client' ? clientPalette : freelancerPalette),
  },
  spacing: {
    xxs: 2,
    xs: 4,
    s: 8,
    sm: 12,
    m: 16,
    md: 16,
    l: 24,
    lg: 24,
    xl: 32,
    xxl: 48,
    xxxl: 64,
  },
  // Radii: clean, purposeful steps without exaggerated blob corners.
  radii: {
    xs: 4,
    sm: 6,
    chip: 8,
    md: 10,
    input: 10,
    button: 12,
    lg: 12,
    card: 12,
    xl: 16,
    sheet: 16,
    pill: 9999,
    full: 9999,
  },
  // Responsive helpers: content never stretches past `maxWidth` on web/tablet.
  layout: {
    maxWidth: 1120,
    contentMaxWidth: 1120,
    formMaxWidth: 680,
    authMaxWidth: 460,
    wideBreakpoint: 900,
    desktopBreakpoint: 1024,
    splitMainRatio: 0.65,
    splitRailRatio: 0.35,
  },
  // Gradients replaced with flat solid pairs (house rule: no gradients)
  gradients: {
    brand: mode === 'client' ? '#1E3A8A' : '#2563EB',
    ink: '#0F172A',
    sunrise: '#D97706',
    brandColors: (mode === 'client' ? ['#1E3A8A', '#1E3A8A'] : ['#2563EB', '#2563EB']) as [string, string],
    inkColors: ['#0F172A', '#0F172A'] as [string, string],
    sunriseColors: ['#D97706', '#D97706'] as [string, string],
    primary: (mode === 'client' ? ['#1E3A8A', '#1E3A8A'] : ['#2563EB', '#2563EB']) as [string, string],
    accent: (mode === 'client' ? ['#B45309', '#B45309'] : ['#059669', '#059669']) as [string, string],
    hero: (mode === 'client' ? ['#0B1445', '#0B1445'] : ['#1D4ED8', '#1D4ED8']) as [string, string],
    surface: ['#FFFFFF', '#FFFFFF'] as [string, string],
    emerald: ['#16A34A', '#16A34A'] as [string, string],
    danger: ['#DC2626', '#DC2626'] as [string, string],
  },
  glass: {
    surface: '#FFFFFF',
    surfaceSubtle: '#FFFFFF',
    border: '#E2E8F0',
    borderSubtle: '#F1F5F9',
    highlight: '#FFFFFF',
    darkSurface: '#0F172A',
    darkBorder: '#334155',
  },
  type: {
    display: { fontSize: 30, lineHeight: 36, fontWeight: '800' as const, letterSpacing: -0.5, fontVariant: ['tabular-nums'] as TextStyle['fontVariant'] },
    title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const, letterSpacing: -0.3, fontVariant: ['tabular-nums'] as TextStyle['fontVariant'] },
    heading: { fontSize: 17, lineHeight: 23, fontWeight: '700' as const, letterSpacing: -0.2, fontVariant: ['tabular-nums'] as TextStyle['fontVariant'] },
    subheading: { fontSize: 15, lineHeight: 21, fontWeight: '600' as const, letterSpacing: -0.1 },
    body: { fontSize: 15, lineHeight: 22, fontWeight: '400' as const, fontVariant: ['tabular-nums'] as TextStyle['fontVariant'] },
    bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' as const, fontVariant: ['tabular-nums'] as TextStyle['fontVariant'] },
    small: { fontSize: 13, lineHeight: 18, fontWeight: '500' as const, letterSpacing: 0 },
    caption: { fontSize: 12, lineHeight: 16, fontWeight: '600' as const, letterSpacing: 0.2 },
  },
  // Flat elevation system: crisp 1px borders replace resting blur shadows & glows
  shadow: {
    flat: {
      borderWidth: 1,
      borderColor: '#E2E8F0',
    } as any,
    card: {
      borderWidth: 1,
      borderColor: '#E2E8F0',
      elevation: 0,
      shadowOpacity: 0,
    } as any,
    neoGlass: {
      borderWidth: 1,
      borderColor: '#E2E8F0',
      elevation: 0,
      shadowOpacity: 0,
    } as any,
    raised: {
      borderWidth: 1,
      borderColor: '#CBD5E1',
      elevation: 1,
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.04,
      shadowRadius: 2,
    } as any,
    glow: {
      borderWidth: 1,
      borderColor: mode === 'client' ? '#1E3A8A' : '#2563EB',
      elevation: 0,
      shadowOpacity: 0,
    } as any,
    stickyDock: {
      borderTopWidth: 1,
      borderTopColor: '#E2E8F0',
      elevation: 0,
      shadowOpacity: 0,
    } as any,
  },
});

export type Theme = ReturnType<typeof buildTheme>;
export type AppTheme = Theme;

export const lightFreelancerTheme = buildTheme('freelancer');
export const clientTheme = buildTheme('client');

// Static default (used before a profile exists, and by non-React callers).
export const theme = lightFreelancerTheme;

export const ThemeContext = createContext<Theme>(theme);

export const useAppTheme = () => useContext(ThemeContext);

export const useResponsiveLayout = () => {
  const { width, height } = useWindowDimensions();
  let insets = { top: 0, bottom: 0, left: 0, right: 0 };
  try {
    insets = useSafeAreaInsets();
  } catch {
    // Fallback when rendered outside SafeAreaProvider
  }
  const isWeb = Platform.OS === 'web';
  const isPhone = width < 640;
  const isTablet = width >= 640 && width < 1024;
  const isDesktop = width >= 1024;
  const isWide = width >= 900;

  return {
    width,
    height,
    isWeb,
    isPhone,
    isTablet,
    isDesktop,
    isWide,
    insets,
    contentMaxWidth: 1120,
    formMaxWidth: 680,
    authMaxWidth: 460,
    cardGap: isPhone ? 12 : 16,
    gridColumns: isDesktop ? 3 : isTablet ? 2 : 1,
    topSpace: isWeb ? 24 : Math.max(insets.top + 10, 48),
    bottomSpace: isWeb ? 24 : Math.max(insets.bottom + 12, 20),
    topPad: isWeb ? 24 : Math.max(insets.top + 10, 48),
    bottomPad: isWeb ? 24 : Math.max(insets.bottom + 12, 20),
    pagePadding: isPhone ? 16 : 24,
  };
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const { profile } = useAuth();
  const mode: AppMode = profile?.active_mode === 'hire' ? 'client' : 'freelancer';
  const value = useMemo(() => (mode === 'client' ? clientTheme : lightFreelancerTheme), [mode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export default theme;
