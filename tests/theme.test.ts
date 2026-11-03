import { describe, it, expect } from 'vitest';
import {
  colors,
  spacing,
  typography,
  borderRadius,
  layout,
  theme,
  getCategoryMeta,
  getPaymentRailMeta,
  getTrustTier,
  formatRelativeTime,
} from '../lib/theme';

describe('Design System: lib/theme.ts', () => {
  it('exports valid brand and role color tokens', () => {
    expect(colors.primary).toBe('#2563EB');
    expect(colors.primaryDark).toBe('#1D4ED8');
    expect(colors.primarySurface).toBe('#EFF6FF');
    expect(colors.freelancer).toBe('#0284C7');
    expect(colors.client).toBe('#1E3A8A');
    expect(colors.background).toBe('#F8FAFC');
    expect(colors.surface).toBe('#FFFFFF');
    expect(colors.textPrimary).toBe('#0F172A');
    expect(colors.textMuted).toBe('#64748B');
    expect(colors.heroNavy).toBe('#0B192C');
    expect(colors.gold).toBe('#F59E0B');
  });

  it('exports semantic status colors strictly decoupled from brand role', () => {
    expect(colors.success).toBe('#16A34A');
    expect(colors.warning).toBe('#D97706');
    expect(colors.danger).toBe('#DC2626');
    expect(colors.success).not.toBe(colors.freelancer);
  });

  it('exports numerical spacing and typography scales', () => {
    expect(spacing.xs).toBe(4);
    expect(spacing.md).toBe(12);
    expect(spacing.lg).toBe(16);
    expect(spacing.xxl).toBe(32);

    expect(typography.xs).toBe(11);
    expect(typography.base).toBe(15);
    expect(typography.lg).toBe(18);
    expect(typography.xxl).toBe(24);
  });

  it('exports layout boundaries matching design specification', () => {
    expect(layout.maxWidth).toBe(1140);
  });

  it('exports default theme object with all keys', () => {
    expect(theme.colors).toBeDefined();
    expect(theme.spacing).toBeDefined();
    expect(theme.typography).toBeDefined();
    expect(theme.borderRadius).toBeDefined();
    expect(theme.shadows).toBeDefined();
    expect(theme.layout).toBeDefined();
    expect(theme.categoryPalette).toBeDefined();
    expect(theme.paymentRails).toBeDefined();
  });

  it('verifies borderRadius and shadow definitions', () => {
    expect(borderRadius.sm).toBe(6);
    expect(borderRadius.md).toBe(8);
    expect(borderRadius.xl).toBe(12);
    expect(borderRadius['2xl']).toBe(16);
    expect(borderRadius.full).toBe(9999);
    expect(theme.shadows.card).toBeDefined();
    expect(theme.shadows.hero).toBeDefined();
    expect(theme.shadows.modal).toBeDefined();
  });

  it('resolves Ormoc gig category visual metadata and payment rails', () => {
    const repairMeta = getCategoryMeta('Home Repair');
    expect(repairMeta.color).toBe('#EA580C');
    expect(repairMeta.shortTag).toBe('Trades & Repair');

    const gcashMeta = getPaymentRailMeta('gcash');
    expect(gcashMeta.label).toBe('GCash');
    expect(gcashMeta.shortCode).toBe('GC');

    const mayaMeta = getPaymentRailMeta('maya');
    expect(mayaMeta.label).toBe('Maya');

    const topTier = getTrustTier(90);
    expect(topTier.isVerified).toBe(true);
    expect(topTier.label).toContain('Ormocanon');

    expect(formatRelativeTime(new Date().toISOString())).toBe('Just now');
  });
});
