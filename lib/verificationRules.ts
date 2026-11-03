/**
 * GigOrmoc Deterministic Legitimacy Scoring & Catalog Skill Recommender
 * Operates 100% locally with zero external LLM API dependencies.
 */
import { isOrmocBarangay } from './ormocBarangays';

export interface UserProfileInput {
  email_verified: boolean;
  avatar_url?: string | null;
  bio?: string | null;
  area_barangay?: string | null;
  active_mode: 'freelancer' | 'client';
  client_type?: 'individual' | 'business' | null;
  business_name?: string | null;
  hiring_interests?: string[] | null;
}

export interface UserMetricsInput {
  skillsCount?: number;
  portfolioCount?: number;
  completedAgreementsCount?: number;
  actionedReportsCount?: number;
}

export interface RuleBreakdownItem {
  ruleId: string;
  name: string;
  pointsAwarded: number;
  maxPoints: number;
  isSatisfied: boolean;
  explanation: string;
}

export interface LegitimacyEvaluationResult {
  score: number;
  maxScore: number;
  breakdown: RuleBreakdownItem[];
  badgeEligible: boolean; // Score >= 70
}

/**
 * Calculates a deterministic 0-100 legitimacy score based on 5 additive criteria.
 */
export function calculateLegitimacyScore(
  profile: UserProfileInput,
  metrics: UserMetricsInput = {}
): LegitimacyEvaluationResult {
  const breakdown: RuleBreakdownItem[] = [];

  // Rule 1: Email Verification (20 pts)
  const isEmailVerified = Boolean(profile.email_verified);
  breakdown.push({
    ruleId: 'EMAIL_VERIFIED',
    name: 'Verified Email Address',
    pointsAwarded: isEmailVerified ? 20 : 0,
    maxPoints: 20,
    isSatisfied: isEmailVerified,
    explanation: isEmailVerified
      ? 'Account email has been confirmed via 6-digit OTP.'
      : 'Email is unverified.',
  });

  // Rule 2: Avatar & Descriptive Bio (20 pts)
  const hasAvatar = Boolean(profile.avatar_url && profile.avatar_url.trim().length > 0);
  const hasSubstantialBio = Boolean(profile.bio && profile.bio.trim().length >= 50);
  let rule2Points = 0;
  if (hasAvatar) rule2Points += 10;
  if (hasSubstantialBio) rule2Points += 10;

  breakdown.push({
    ruleId: 'AVATAR_AND_BIO',
    name: 'Profile Picture & Detailed Bio',
    pointsAwarded: rule2Points,
    maxPoints: 20,
    isSatisfied: hasAvatar && hasSubstantialBio,
    explanation: `Avatar: ${hasAvatar ? 'Uploaded (+10)' : 'Missing (0)'}, Bio >= 50 chars: ${
      hasSubstantialBio ? 'Provided (+10)' : 'Too short or missing (0)'
    }.`,
  });

  // Rule 3: Valid Ormoc City Barangay (15 pts)
  const hasValidBarangay = isOrmocBarangay(profile.area_barangay);
  breakdown.push({
    ruleId: 'ORMOC_BARANGAY',
    name: 'Ormoc City Residence / Base',
    pointsAwarded: hasValidBarangay ? 15 : 0,
    maxPoints: 15,
    isSatisfied: hasValidBarangay,
    explanation: hasValidBarangay
      ? `Verified Ormoc City location: ${profile.area_barangay}.`
      : 'Area must match an official Ormoc City barangay or district.',
  });

  // Rule 4: Role Completeness (25 pts)
  let rule4Points = 0;
  let rule4Satisfied = false;
  let rule4Explanation = '';

  if (profile.active_mode === 'freelancer') {
    const skillsCount = metrics.skillsCount ?? 0;
    const portfolioCount = metrics.portfolioCount ?? 0;
    const skillsPoints = skillsCount >= 3 ? 15 : Math.floor((skillsCount / 3) * 15);
    const portfolioPoints = portfolioCount >= 1 ? 10 : 0;
    rule4Points = skillsPoints + portfolioPoints;
    rule4Satisfied = skillsCount >= 3 && portfolioCount >= 1;
    rule4Explanation = `Skills (${skillsCount}/3 needed: +${skillsPoints}), Portfolio (${portfolioCount}/1 needed: +${portfolioPoints}).`;
  } else {
    // Client mode
    const isClientTypeValid =
      profile.client_type === 'individual' ||
      (profile.client_type === 'business' && Boolean(profile.business_name?.trim()));
    const typePoints = isClientTypeValid ? 10 : 0;
    const hiringInterestsCount = profile.hiring_interests?.length ?? 0;
    const hiringPoints = hiringInterestsCount >= 1 ? 15 : 0;
    rule4Points = typePoints + hiringPoints;
    rule4Satisfied = isClientTypeValid && hiringInterestsCount >= 1;
    rule4Explanation = `Client Type: ${isClientTypeValid ? 'Specified (+10)' : 'Missing/Incomplete (0)'}, Hiring Interests (${hiringInterestsCount}: +${hiringPoints}).`;
  }

  breakdown.push({
    ruleId: 'ROLE_COMPLETENESS',
    name: profile.active_mode === 'freelancer' ? 'Freelancer Skill & Portfolio Portfolio' : 'Client Profile Completeness',
    pointsAwarded: rule4Points,
    maxPoints: 25,
    isSatisfied: rule4Satisfied,
    explanation: rule4Explanation,
  });

  // Rule 5: Trust & Moderation History (20 pts)
  const actionedReports = metrics.actionedReportsCount ?? 0;
  const completedAgreements = metrics.completedAgreementsCount ?? 0;
  let rule5Points = 0;

  if (actionedReports === 0) {
    rule5Points += 10; // Clean moderation standing
  }

  if (completedAgreements >= 1) {
    rule5Points += 10; // Proven track record
  } else if (actionedReports === 0) {
    rule5Points += 5; // Clean starter baseline
  }

  breakdown.push({
    ruleId: 'TRUST_AND_MODERATION',
    name: 'Platform Trust & Moderation Record',
    pointsAwarded: rule5Points,
    maxPoints: 20,
    isSatisfied: rule5Points >= 15,
    explanation: `Disputes/Violations: ${actionedReports} (${actionedReports === 0 ? '+10' : '0'}), Completed Agreements: ${completedAgreements} (${completedAgreements >= 1 ? '+10' : '+5 clean baseline'}).`,
  });

  const totalScore = breakdown.reduce((sum, item) => sum + item.pointsAwarded, 0);

  return {
    score: Math.min(100, Math.max(0, totalScore)),
    maxScore: 100,
    breakdown,
    badgeEligible: totalScore >= 70,
  };
}

export interface CatalogSkillItem {
  id: string;
  name: string;
  category: string;
  keywords: string[];
}

/**
 * Deterministically ranks and recommends skills from the catalog based on
 * active category matching and search token overlap.
 */
export function suggestSkillsFromCatalog(
  selectedSkillNames: string[],
  activeCategory: string,
  queryText: string = '',
  catalog: CatalogSkillItem[],
  limit: number = 8
): CatalogSkillItem[] {
  if (!catalog || !Array.isArray(catalog)) {
    return [];
  }

  const selectedSet = new Set(selectedSkillNames.map((s) => s.trim().toLowerCase()));
  const queryTokens = queryText
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((t) => t.length > 1);

  const scored = catalog
    .filter((item) => !selectedSet.has(item.name.toLowerCase()))
    .map((item) => {
      let score = 0;

      // Category match gives +3
      if (item.category && item.category.toLowerCase() === activeCategory.toLowerCase()) {
        score += 3;
      }

      // Keyword overlap gives +2 per matched token
      const itemKeywords = (item.keywords || []).map((k) => k.toLowerCase());
      const itemNameLower = item.name.toLowerCase();

      for (const token of queryTokens) {
        if (itemNameLower.includes(token)) {
          score += 4;
        } else if (itemKeywords.some((k) => k.includes(token))) {
          score += 2;
        }
      }

      return { item, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.item.name.localeCompare(b.item.name);
    });

  return scored.slice(0, limit).map(({ item }) => item);
}
