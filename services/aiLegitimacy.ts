import { supabase } from '../lib/supabase';
import { Profile } from './auth';
import { offlineSyncService } from './offlineSync';

interface LegitimacyCriterion {
  id: string;
  label: string;
  weight: number;
  passed: boolean;
  notes: string;
}

interface LegitimacyEvaluation {
  score: number; // 0 - 100
  meetsCriteria: boolean;
  recommendation: 'recommend_approval' | 'needs_more_profile_info' | 'below_threshold';
  aiSummary: string;
  checklist: LegitimacyCriterion[];
  evaluatedAt: string;
}

export const aiLegitimacyService = {
  /**
   * On-device / hybrid AI screening engine.
   * Evaluates criteria and generates a full audit summary for Super Admin review.
   */
  evaluateAccount(profile: Profile): LegitimacyEvaluation {
    const checklist: LegitimacyCriterion[] = [];
    let totalScore = 0;

    // 1. Identity & Profile Completeness (35 pts max)
    const hasName = Boolean(profile.display_name && profile.display_name.trim().length >= 3);
    const hasAvatar = Boolean(profile.avatar_path);
    const hasBio = Boolean(profile.bio && profile.bio.trim().length >= 20);
    const hasArea = Boolean(profile.area && profile.area.trim().length > 0);
    const hasContact = Boolean(profile.preferred_contact && profile.preferred_contact.trim().length > 0);

    const identityPassed = hasName && (hasBio || hasAvatar) && (hasArea || hasContact);
    const identityPoints =
      (hasName ? 10 : 0) +
      (hasAvatar ? 10 : 0) +
      (hasBio ? 5 : 0) +
      (hasArea ? 5 : 0) +
      (hasContact ? 5 : 0);
    totalScore += identityPoints;

    checklist.push({
      id: 'identity_completeness',
      label: 'Identity & Profile Completeness',
      weight: 35,
      passed: identityPassed,
      notes: `${identityPoints}/35 pts — Name: ${hasName ? 'Yes' : 'No'}, Avatar: ${hasAvatar ? 'Uploaded' : 'None'}, Bio: ${hasBio ? 'Set' : 'Empty'}, Contact: ${hasContact ? 'Configured' : 'Missing'}.`,
    });

    // 2. Role-specific Activity / Readiness (35 pts max)
    if (profile.active_mode === 'hire' || profile.client_type) {
      // Client checks
      const hasClientType = Boolean(profile.client_type);
      const hasBusinessOrHiring = Boolean(
        (profile.business_name && profile.business_name.trim().length > 0) ||
        (profile.about_hiring && profile.about_hiring.trim().length > 0)
      );

      const clientPoints =
        (hasClientType ? 15 : 0) +
        (hasBusinessOrHiring ? 15 : 0) +
        5; // baseline credit for onboarding
      totalScore += clientPoints;

      checklist.push({
        id: 'client_readiness',
        label: 'Client Hiring Details & Credibility',
        weight: 35,
        passed: hasClientType || hasBusinessOrHiring,
        notes: `${clientPoints}/35 pts — Client Type: ${profile.client_type || 'Individual'}, Hiring Info: ${hasBusinessOrHiring ? 'Complete' : 'Needs more details'}.`,
      });
    } else {
      // Freelancer checks
      const hasWorkTypes = Array.isArray(profile.work_types) && profile.work_types.length > 0;
      const hasExp = Boolean(profile.experience_years);
      const hasRate = Boolean(profile.starting_rate_note && profile.starting_rate_note.trim().length > 0);

      const freelancerPoints =
        (hasWorkTypes ? 15 : 0) +
        (hasExp ? 10 : 0) +
        (hasRate ? 5 : 0) +
        5;
      totalScore += freelancerPoints;

      checklist.push({
        id: 'freelancer_readiness',
        label: 'Freelancer Skills & Qualifications',
        weight: 35,
        passed: hasWorkTypes && (hasExp || hasRate),
        notes: `${freelancerPoints}/35 pts — Work Categories: ${profile.work_types?.length || 0} selected, Experience: ${profile.experience_years || 'Not specified'}.`,
      });
    }

    // 3. Community Reputation & Standing (30 pts max)
    const isNotSuspended = profile.status === 'active';
    const ratingAvg =
      profile.active_mode === 'hire' ? profile.client_rating_avg : profile.freelancer_rating_avg;
    const ratingOk = ratingAvg === 0 || ratingAvg >= 3.5;

    let repPoints = 0;
    if (isNotSuspended) repPoints += 20;
    if (ratingOk) repPoints += 10;
    totalScore += repPoints;

    checklist.push({
      id: 'standing_and_trust',
      label: 'Platform Standing & Feedback',
      weight: 30,
      passed: isNotSuspended && ratingOk,
      notes: `${repPoints}/30 pts — Account Status: ${profile.status}, Rating Standing: ${ratingAvg > 0 ? ratingAvg.toFixed(1) + ' ★' : 'New Account (Clean Record)'}.`,
    });

    const meetsCriteria = totalScore >= 70;
    let recommendation: LegitimacyEvaluation['recommendation'] = 'below_threshold';
    let aiSummary = '';

    if (totalScore >= 80) {
      recommendation = 'recommend_approval';
      aiSummary = `AI Screening passed with high confidence (${totalScore}%). Profile satisfies completeness, qualification details, and clean community record. Recommended for Super Admin badge confirmation.`;
    } else if (totalScore >= 70) {
      recommendation = 'recommend_approval';
      aiSummary = `AI Screening passed criteria threshold (${totalScore}%). Core identity and role credentials are provided. Human Super Admin review recommended for final confirmation.`;
    } else {
      recommendation = 'needs_more_profile_info';
      aiSummary = `AI Screening score is ${totalScore}%, below the 70% threshold. Recommend user add profile avatar, bio details, and complete qualification fields before badge approval.`;
    }

    return {
      score: totalScore,
      meetsCriteria,
      recommendation,
      aiSummary,
      checklist,
      evaluatedAt: new Date().toISOString(),
    };
  },

  /**
   * Evaluates the account and submits the AI report to the Super Admin review queue.
   */
  async submitForReview(profile: Profile): Promise<LegitimacyEvaluation> {
    const evaluation = this.evaluateAccount(profile);

    try {
      // 1. Submit through secure SECURITY DEFINER RPC
      const { error } = await supabase.rpc('submit_profile_verification', {
        p_score: evaluation.score,
        p_report: evaluation,
      });

      if (error) {
        console.warn('submit_profile_verification RPC failed, caching locally:', error.message);
      }
    } catch {
      // Offline fallback
      offlineSyncService.setKnownOffline(true);
    }

    // 2. Cache in local storage for offline Super Admin inspection
    const updatedProfile = {
      ...profile,
      verification_status: 'ai_flagged',
      ai_legitimacy_score: evaluation.score,
      ai_legitimacy_report: evaluation,
    };
    await offlineSyncService.cacheProfile(updatedProfile);

    // Add to local verification queue
    const currentQueue = await offlineSyncService.getCachedVerificationQueue();
    const existingIndex = currentQueue.findIndex((q: any) => q.id === profile.id);
    if (existingIndex >= 0) {
      currentQueue[existingIndex] = updatedProfile;
    } else {
      currentQueue.push(updatedProfile);
    }
    await offlineSyncService.cacheVerificationQueue(currentQueue);

    return evaluation;
  },
};
