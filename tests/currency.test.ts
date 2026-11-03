import { describe, it, expect } from 'vitest';
import { parsePhpToCentavos, formatCentavosToPhp, validateMilestoneSum } from '../lib/currency';

describe('Currency Utility Module (lib/currency.ts)', () => {
  describe('parsePhpToCentavos', () => {
    it('parses basic integer and decimal strings', () => {
      expect(parsePhpToCentavos('500')).toBe(50000);
      expect(parsePhpToCentavos('500.00')).toBe(50000);
      expect(parsePhpToCentavos('1250.75')).toBe(125075);
      expect(parsePhpToCentavos('0.50')).toBe(50);
    });

    it('parses strings with currency symbols, commas, and spaces', () => {
      expect(parsePhpToCentavos('₱500')).toBe(50000);
      expect(parsePhpToCentavos('PHP 1,250.50')).toBe(125050);
      expect(parsePhpToCentavos('  ₱ 5,000.00  ')).toBe(500000);
      expect(parsePhpToCentavos('1,000,000.00')).toBe(100000000);
    });

    it('rejects invalid, negative, or empty inputs', () => {
      expect(parsePhpToCentavos('')).toBeNull();
      expect(parsePhpToCentavos('abc')).toBeNull();
      expect(parsePhpToCentavos('-500')).toBeNull();
      expect(parsePhpToCentavos('0')).toBeNull();
      expect(parsePhpToCentavos('0.00')).toBeNull();
      expect(parsePhpToCentavos('500.123')).toBeNull(); // More than 2 decimal digits
    });
  });

  describe('formatCentavosToPhp', () => {
    it('formats centavos into Philippine Peso format', () => {
      expect(formatCentavosToPhp(50000)).toMatch(/500\.00/);
      expect(formatCentavosToPhp(500000)).toMatch(/5,000\.00/);
      expect(formatCentavosToPhp(75)).toMatch(/0\.75/);
      expect(formatCentavosToPhp(0)).toMatch(/0\.00/);
    });

    it('handles negative or invalid values gracefully', () => {
      expect(formatCentavosToPhp(-100)).toBe('₱0.00');
    });
  });

  describe('validateMilestoneSum', () => {
    it('returns valid: true when milestone sum exactly matches contract total', () => {
      const milestones = [200000, 300000]; // 2,000 + 3,000 = 5,000 PHP
      const contractTotal = 500000;
      const res = validateMilestoneSum(milestones, contractTotal);
      expect(res.valid).toBe(true);
      expect(res.deltaCentavos).toBe(0);
      expect(res.totalMilestones).toBe(500000);
    });

    it('returns valid: false when milestones are under the total', () => {
      const milestones = [200000, 200000];
      const contractTotal = 500000;
      const res = validateMilestoneSum(milestones, contractTotal);
      expect(res.valid).toBe(false);
      expect(res.deltaCentavos).toBe(-100000);
    });

    it('returns valid: false when milestones exceed the total', () => {
      const milestones = [300000, 300000];
      const contractTotal = 500000;
      const res = validateMilestoneSum(milestones, contractTotal);
      expect(res.valid).toBe(false);
      expect(res.deltaCentavos).toBe(100000);
    });

    it('rejects empty arrays or invalid values', () => {
      expect(validateMilestoneSum([], 500000).valid).toBe(false);
      expect(validateMilestoneSum([-100, 500100], 500000).valid).toBe(false);
    });
  });
});
