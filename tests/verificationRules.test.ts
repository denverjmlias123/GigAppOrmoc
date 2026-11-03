import { describe, it, expect } from 'vitest';
import { calculateLegitimacyScore, suggestSkillsFromCatalog, CatalogSkillItem } from '../lib/verificationRules';
import { isOrmocBarangay, ORMOC_BARANGAYS } from '../lib/ormocBarangays';

describe('Verification & Ormoc Barangay Rules (lib/verificationRules.ts)', () => {
  describe('ORMOC_BARANGAYS', () => {
    it('contains all 88 official Ormoc City barangays and districts', () => {
      expect(ORMOC_BARANGAYS.length).toBe(88);
      expect(ORMOC_BARANGAYS).toContain('Valencia');
      expect(ORMOC_BARANGAYS).toContain('Tambulilid');
      expect(ORMOC_BARANGAYS).toContain('District 1');
      expect(ORMOC_BARANGAYS).toContain('District 29');
      expect(ORMOC_BARANGAYS).toContain('Cogon Combado');
    });

    it('validates official Ormoc City barangays accurately', () => {
      expect(isOrmocBarangay('valencia')).toBe(true);
      expect(isOrmocBarangay('  Tambulilid  ')).toBe(true);
      expect(isOrmocBarangay('District 15')).toBe(true);
      expect(isOrmocBarangay('Manila')).toBe(false);
      expect(isOrmocBarangay('Cebu City')).toBe(false);
      expect(isOrmocBarangay('')).toBe(false);
      expect(isOrmocBarangay(null)).toBe(false);
    });
  });

  describe('calculateLegitimacyScore', () => {
    it('awards 100 points to a fully complete, verified, and established freelancer profile', () => {
      const result = calculateLegitimacyScore(
        {
          email_verified: true, // 20 pts
          avatar_url: 'https://example.com/avatar.jpg', // 10 pts
          bio: 'Professional freelance graphic designer based in Ormoc City with over 5 years of commercial experience.', // >= 50 chars: 10 pts
          area_barangay: 'Valencia', // 15 pts
          active_mode: 'freelancer',
        },
        {
          skillsCount: 4, // >= 3: 15 pts
          portfolioCount: 2, // >= 1: 10 pts
          completedAgreementsCount: 3, // >= 1: 10 pts
          actionedReportsCount: 0, // 10 pts
        }
      );

      expect(result.score).toBe(100);
      expect(result.badgeEligible).toBe(true);
      expect(result.breakdown.length).toBe(5);
    });

    it('awards correct baseline points for a clean new user profile', () => {
      const result = calculateLegitimacyScore(
        {
          email_verified: true, // 20 pts
          avatar_url: null, // 0 pts
          bio: 'Short bio', // < 50 chars: 0 pts
          area_barangay: 'Tambulilid', // 15 pts
          active_mode: 'freelancer',
        },
        {
          skillsCount: 1, // 5 pts (1/3 of 15)
          portfolioCount: 0, // 0 pts
          completedAgreementsCount: 0, // 0 agreements + 0 reports: 5 pts clean starter baseline
          actionedReportsCount: 0, // 10 pts
        }
      );

      // Total expected: 20 + 0 + 15 + 5 + 15 = 55
      expect(result.score).toBe(55);
      expect(result.badgeEligible).toBe(false);
    });

    it('calculates client completeness correctly', () => {
      const result = calculateLegitimacyScore(
        {
          email_verified: true, // 20 pts
          avatar_url: 'https://example.com/logo.png', // 10 pts
          bio: 'Ormoc City boutique cafe and bakery looking for local designers, photographers, and catering assistants.', // 10 pts
          area_barangay: 'District 4', // 15 pts
          active_mode: 'client',
          client_type: 'business',
          business_name: 'Ormoc Daily Cafe', // 10 pts
          hiring_interests: ['Graphic Design', 'Photography'], // 15 pts
        },
        {
          completedAgreementsCount: 1, // 10 pts
          actionedReportsCount: 0, // 10 pts
        }
      );

      // Total expected: 20 + 20 + 15 + 25 + 20 = 100
      expect(result.score).toBe(100);
      expect(result.badgeEligible).toBe(true);
    });

    it('docks points when moderation disputes have been actioned against the user', () => {
      // Case A: 2 violations with 2 completed agreements -> docks 10 pts for clean standing, keeps 10 pts for completed agreements
      const resultWithAgreements = calculateLegitimacyScore(
        {
          email_verified: true,
          avatar_url: 'https://example.com/avatar.jpg',
          bio: 'Long detailed bio that satisfies the fifty character requirement for testing purposes.',
          area_barangay: 'Cogon Combado',
          active_mode: 'freelancer',
        },
        {
          skillsCount: 3,
          portfolioCount: 1,
          completedAgreementsCount: 2,
          actionedReportsCount: 2, // Violations present: docks clean record portion (10 pts)
        }
      );

      // Expected: 20 + 20 + 15 + 25 + 10 = 90
      expect(resultWithAgreements.score).toBe(90);
      const trustRuleA = resultWithAgreements.breakdown.find((b) => b.ruleId === 'TRUST_AND_MODERATION');
      expect(trustRuleA?.pointsAwarded).toBe(10);

      // Case B: 2 violations with 0 completed agreements -> awards 0 pts for trust rule
      const resultNoAgreements = calculateLegitimacyScore(
        {
          email_verified: true,
          avatar_url: 'https://example.com/avatar.jpg',
          bio: 'Long detailed bio that satisfies the fifty character requirement for testing purposes.',
          area_barangay: 'Cogon Combado',
          active_mode: 'freelancer',
        },
        {
          skillsCount: 3,
          portfolioCount: 1,
          completedAgreementsCount: 0,
          actionedReportsCount: 2,
        }
      );

      // Expected: 20 + 20 + 15 + 25 + 0 = 80
      expect(resultNoAgreements.score).toBe(80);
      const trustRuleB = resultNoAgreements.breakdown.find((b) => b.ruleId === 'TRUST_AND_MODERATION');
      expect(trustRuleB?.pointsAwarded).toBe(0);
    });
  });

  describe('suggestSkillsFromCatalog', () => {
    const catalog: CatalogSkillItem[] = [
      { id: '1', name: 'Logo & Brand Identity', category: 'Graphic Design', keywords: ['branding', 'logo', 'vector'] },
      { id: '2', name: 'Social Media Graphics', category: 'Graphic Design', keywords: ['canva', 'facebook', 'ads'] },
      { id: '3', name: 'Computer Repair', category: 'Web & IT Support', keywords: ['laptop', 'pc', 'reformat'] },
      { id: '4', name: 'WordPress Website Setup', category: 'Web & IT Support', keywords: ['website', 'domain', 'hosting'] },
    ];

    it('prioritizes skills in the active category', () => {
      const suggestions = suggestSkillsFromCatalog([], 'Graphic Design', '', catalog);
      expect(suggestions.length).toBe(2);
      expect(suggestions[0].category).toBe('Graphic Design');
      expect(suggestions[1].category).toBe('Graphic Design');
    });

    it('filters out already selected skills', () => {
      const suggestions = suggestSkillsFromCatalog(['Logo & Brand Identity'], 'Graphic Design', '', catalog);
      expect(suggestions.some((s) => s.name === 'Logo & Brand Identity')).toBe(false);
      expect(suggestions[0].name).toBe('Social Media Graphics');
    });

    it('matches and scores by search query token overlap', () => {
      const suggestions = suggestSkillsFromCatalog([], '', 'laptop repair', catalog);
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].name).toBe('Computer Repair');
    });
  });
});
