import { Platform, useWindowDimensions } from 'react-native';
import type { ViewStyle } from 'react-native';

export const colors = {
  // Brand Blues
  primary: '#2563EB',
  primaryDark: '#1D4ED8',
  primarySurface: '#EFF6FF',
  primaryBorder: '#BFDBFE',

  // Ormoc Bay Deep Coastal Navy & Gold Accents
  heroNavy: '#0B192C',
  heroNavyMid: '#132A4A',
  heroSurface: '#0F2942',
  heroAccent: '#38BDF8',
  gold: '#F59E0B',
  goldDark: '#B45309',
  goldSurface: '#FEF3C7',
  goldBorder: '#FDE68A',

  // Unique Ormoc City Brand Palette (Queen Pineapple, Bay & Leyte Heritage)
  ormocNavy: '#081426',
  ormocNavyDeep: '#040C18',
  ormocNavyLight: '#162D50',
  ormocGold: '#F59E0B',
  ormocGoldLight: '#FBBF24',
  ormocGoldDark: '#B45309',
  ormocGoldSurface: '#FFFBEB',
  ormocGoldBorder: '#FDE68A',
  ormocEmerald: '#059669',
  ormocEmeraldLight: '#10B981',
  ormocEmeraldSurface: '#ECFDF5',
  ormocEmeraldBorder: '#A7F3D0',
  surfaceWarm: '#FAFBFC',
  surfaceCard: '#FFFFFF',
  borderWarm: '#E5E7EB',

  // Role Accents
  freelancer: '#0284C7',
  freelancerSurface: '#E0F2FE',
  freelancerBorder: '#BAE6FD',
  client: '#1E3A8A',
  clientSurface: '#EEF2FF',
  clientBorder: '#C7D2FE',

  // Neutral Surfaces & Borders
  background: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceSecondary: '#F1F5F9',
  surfaceElevated: '#FFFFFF',
  border: '#E2E8F0',
  borderLight: '#F1F5F9',

  // Typography
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#64748B',
  textInverse: '#FFFFFF',

  // Semantic Statuses
  success: '#16A34A',
  successSurface: '#DCFCE7',
  successBorder: '#BBF7D0',
  warning: '#D97706',
  warningSurface: '#FEF3C7',
  warningBorder: '#FDE68A',
  danger: '#DC2626',
  dangerSurface: '#FEE2E2',
  dangerBorder: '#FECACA',
} as const;

export type ColorToken = keyof typeof colors;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  '2xl': 32,
  '3xl': 40,
} as const;

export const typography = {
  xs: 11,
  sm: 13,
  base: 15,
  md: 16,
  lg: 18,
  xl: 20,
  xxl: 24,
  '2xl': 28,
  '3xl': 32,

  // Text style descriptors for cross-device consistency
  display: { fontSize: 30, fontWeight: '800' as const, letterSpacing: -0.6 },
  h1: { fontSize: 24, fontWeight: '800' as const, letterSpacing: -0.4 },
  h2: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.3 },
  h3: { fontSize: 18, fontWeight: '700' as const, letterSpacing: -0.2 },
  body: { fontSize: 15 },
  bodyBold: { fontSize: 15, fontWeight: '700' as const },
  bodySmall: { fontSize: 13 },
  caption: { fontSize: 13 },
  captionBold: { fontSize: 13, fontWeight: '700' as const },
  badge: { fontSize: 11, fontWeight: '700' as const },
  button: { fontSize: 15, fontWeight: '700' as const },
} as const;

export const borderRadius = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  '2xl': 16,
  '3xl': 20,
  full: 9999,
} as const;

export const shadows = {
  card: Platform.select({
    web: {
      boxShadow: '0 4px 14px rgba(15, 23, 42, 0.06), 0 1px 3px rgba(15, 23, 42, 0.04)',
    },
    default: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.07,
      shadowRadius: 10,
      elevation: 3,
    },
  }),
  cardHover: Platform.select({
    web: {
      boxShadow: '0 8px 22px rgba(37, 99, 235, 0.14), 0 2px 6px rgba(15, 23, 42, 0.06)',
    },
    default: {
      shadowColor: '#1E3A8A',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.14,
      shadowRadius: 14,
      elevation: 5,
    },
  }),
  hero: Platform.select({
    web: {
      boxShadow: '0 14px 32px rgba(11, 25, 44, 0.22)',
    },
    default: {
      shadowColor: '#0B192C',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.22,
      shadowRadius: 18,
      elevation: 8,
    },
  }),
  modal: Platform.select({
    web: {
      boxShadow: '0 20px 40px rgba(15, 23, 42, 0.22)',
    },
    default: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.2,
      shadowRadius: 24,
      elevation: 12,
    },
  }),
  sm: Platform.select({
    web: {
      boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)',
    },
    default: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 3,
      elevation: 1,
    },
  }),
  md: Platform.select({
    web: {
      boxShadow: '0 4px 12px rgba(15, 23, 42, 0.07)',
    },
    default: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.07,
      shadowRadius: 8,
      elevation: 3,
    },
  }),
  lg: Platform.select({
    web: {
      boxShadow: '0 10px 24px rgba(15, 23, 42, 0.12)',
    },
    default: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.12,
      shadowRadius: 16,
      elevation: 6,
    },
  }),
} as const;

export const layout = {
  maxWidth: 1140,
} as const;

export interface CategoryVisualMeta {
  label: string;
  color: string;
  surface: string;
  border: string;
  badgeText: string;
  shortTag: string;
}

export const categoryPalette: Record<string, CategoryVisualMeta> = {
  'Home Repair': {
    label: 'Home Repair',
    color: '#EA580C',
    surface: '#FFF7ED',
    border: '#FED7AA',
    badgeText: '#C2410C',
    shortTag: 'Trades & Repair',
  },
  'Graphic Design': {
    label: 'Graphic Design',
    color: '#7C3AED',
    surface: '#F5F3FF',
    border: '#DDD6FE',
    badgeText: '#6D28D9',
    shortTag: 'Creative Studio',
  },
  'Web & IT Support': {
    label: 'Web & IT Support',
    color: '#2563EB',
    surface: '#EFF6FF',
    border: '#BFDBFE',
    badgeText: '#1D4ED8',
    shortTag: 'Tech & Digital',
  },
  'Event Photography': {
    label: 'Event Photography',
    color: '#DB2777',
    surface: '#FDF2F8',
    border: '#FBCFE8',
    badgeText: '#BE185D',
    shortTag: 'Media & Events',
  },
  'Academic Tutoring': {
    label: 'Academic Tutoring',
    color: '#0284C7',
    surface: '#F0F9FF',
    border: '#BAE6FD',
    badgeText: '#0369A1',
    shortTag: 'Education',
  },
  'Bookkeeping & Admin': {
    label: 'Bookkeeping & Admin',
    color: '#0D9488',
    surface: '#F0FDFA',
    border: '#99F6E4',
    badgeText: '#0F766E',
    shortTag: 'Business Ops',
  },
  'Delivery & Errands': {
    label: 'Delivery & Errands',
    color: '#16A34A',
    surface: '#F0FDF4',
    border: '#BBF7D0',
    badgeText: '#15803D',
    shortTag: 'Local Logistics',
  },
  'Catering & Culinary': {
    label: 'Catering & Culinary',
    color: '#D97706',
    surface: '#FFFBEB',
    border: '#FDE68A',
    badgeText: '#B45309',
    shortTag: 'Food & Events',
  },
};

export function getCategoryMeta(category?: string | null): CategoryVisualMeta {
  if (!category) {
    return {
      label: 'General Service',
      color: colors.primary,
      surface: colors.primarySurface,
      border: colors.primaryBorder,
      badgeText: colors.primaryDark,
      shortTag: 'Ormoc Gig',
    };
  }
  return (
    categoryPalette[category] || {
      label: category,
      color: colors.primary,
      surface: colors.primarySurface,
      border: colors.primaryBorder,
      badgeText: colors.primaryDark,
      shortTag: 'Local Service',
    }
  );
}

export interface PaymentRailMeta {
  id: 'gcash' | 'maya' | 'paypal' | 'cash';
  label: string;
  shortCode: string;
  tagline: string;
  color: string;
  surface: string;
  border: string;
  textColor: string;
}

export const paymentRails: Record<string, PaymentRailMeta> = {
  gcash: {
    id: 'gcash',
    label: 'GCash',
    shortCode: 'GC',
    tagline: 'Instant PH Mobile Wallet',
    color: '#0057FF',
    surface: '#EBF2FF',
    border: '#99BDFF',
    textColor: '#0041C2',
  },
  maya: {
    id: 'maya',
    label: 'Maya',
    shortCode: 'MY',
    tagline: 'Digital Bank & Wallet',
    color: '#059669',
    surface: '#ECFDF5',
    border: '#A7F3D0',
    textColor: '#065F46',
  },
  paypal: {
    id: 'paypal',
    label: 'PayPal',
    shortCode: 'PP',
    tagline: 'Global Online Transfer',
    color: '#1E3A8A',
    surface: '#EEF2FF',
    border: '#C7D2FE',
    textColor: '#1E3A8A',
  },
  cash: {
    id: 'cash',
    label: 'Cash (In-Person)',
    shortCode: '₱',
    tagline: 'Ormoc Barangay Hand-off',
    color: '#D97706',
    surface: '#FEF3C7',
    border: '#FDE68A',
    textColor: '#92400E',
  },
};

export function getPaymentRailMeta(method?: string | null): PaymentRailMeta {
  const key = (method || 'gcash').toLowerCase();
  return paymentRails[key] || paymentRails.gcash;
}

export interface TrustTierMeta {
  label: string;
  color: string;
  surface: string;
  border: string;
  isVerified: boolean;
}

export function getTrustTier(score?: number | null): TrustTierMeta {
  const s = score ?? 0;
  if (s >= 85) {
    return {
      label: 'Top Trusted Ormocanon',
      color: '#15803D',
      surface: '#DCFCE7',
      border: '#BBF7D0',
      isVerified: true,
    };
  }
  if (s >= 70) {
    return {
      label: 'Verified Ormoc Member',
      color: colors.primary,
      surface: colors.primarySurface,
      border: colors.primaryBorder,
      isVerified: true,
    };
  }
  if (s >= 40) {
    return {
      label: 'Established Member',
      color: colors.freelancer,
      surface: colors.freelancerSurface,
      border: colors.freelancerBorder,
      isVerified: false,
    };
  }
  return {
    label: 'Building Trust',
    color: colors.warning,
    surface: colors.warningSurface,
    border: colors.warningBorder,
    isVerified: false,
  };
}

export function formatRelativeTime(isoString?: string | null): string {
  if (!isoString) return 'Recently';
  try {
    const date = new Date(isoString);
    const diffSecs = Math.floor((Date.now() - date.getTime()) / 1000);
    if (isNaN(diffSecs)) return 'Recently';
    if (diffSecs < 60) return 'Just now';
    if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
    if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;
    if (diffSecs < 604800) return `${Math.floor(diffSecs / 86400)}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return 'Recently';
  }
}

export interface ResponsiveLayout {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  width: number;
  containerStyle: ViewStyle;
}

export function useResponsive(): ResponsiveLayout {
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
      width: '100%',
      maxWidth: layout.maxWidth,
      alignSelf: 'center',
    },
  };
}

export const theme = {
  colors,
  spacing,
  typography,
  borderRadius,
  shadows,
  layout,
  categoryPalette,
  paymentRails,
} as const;

export default theme;
