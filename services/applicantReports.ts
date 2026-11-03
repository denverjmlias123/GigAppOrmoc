import { supabase } from '../lib/supabase';
import { applicationsService, ApplicationItem } from './applications';
import { gigsService } from './gigs';
import { offlineSyncService } from './offlineSync';

export interface ClientApplicantSummary {
  totalGigs: number;
  totalApplicants: number;
  pendingCount: number;
  acceptedCount: number;
  declinedCount: number;
  acceptanceRate: number; // percentage 0-100
  gigBreakdowns: {
    gigId: string;
    gigTitle: string;
    status: string;
    totalApplicants: number;
    pendingCount: number;
    acceptedCount: number;
    declinedCount: number;
  }[];
  allApplicants: (ApplicationItem & { gigTitle: string })[];
}

export interface FreelancerApplicationSummary {
  totalApplied: number;
  pendingCount: number;
  acceptedCount: number;
  declinedCount: number;
  counteredCount: number;
  successRate: number; // percentage 0-100
  applications: ApplicationItem[];
}

export const applicantReportsService = {
  async getClientReport(clientId: string): Promise<ClientApplicantSummary> {
    try {
      const gigs = await gigsService.getMyGigs(clientId);
      if (gigs.length === 0) {
        return {
          totalGigs: 0,
          totalApplicants: 0,
          pendingCount: 0,
          acceptedCount: 0,
          declinedCount: 0,
          acceptanceRate: 0,
          gigBreakdowns: [],
          allApplicants: [],
        };
      }

      const gigMap = new Map(gigs.map((g) => [g.id, g]));
      const breakdownMap = new Map(
        gigs.map((g) => [
          g.id,
          {
            gigId: g.id,
            gigTitle: g.title,
            status: g.status,
            totalApplicants: 0,
            pendingCount: 0,
            acceptedCount: 0,
            declinedCount: 0,
          },
        ])
      );

      const gigIds = gigs.map((g) => g.id);
      const { data, error } = await supabase
        .from('applications')
        .select(`
          id,
          gig_id,
          freelancer_id,
          proposed_price,
          estimated_days,
          message,
          status,
          status_reason,
          gig_title_snapshot,
          counter_price,
          created_at,
          updated_at,
          freelancer:profiles(
            id,
            display_name,
            avatar_path,
            freelancer_rating_avg,
            freelancer_rating_count,
            freelancer_completed_gigs,
            is_legit_verified
          )
        `)
        .in('gig_id', gigIds)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const allApplicants: (ApplicationItem & { gigTitle: string })[] = [];
      let totalApplicants = 0;
      let pendingCount = 0;
      let acceptedCount = 0;
      let declinedCount = 0;

      for (const app of (data || []) as any[]) {
        const gig = gigMap.get(app.gig_id);
        const gigTitle = gig?.title || app.gig_title_snapshot || 'Gig';
        allApplicants.push({ ...app, gigTitle });
        totalApplicants++;

        const breakdown = breakdownMap.get(app.gig_id);
        if (breakdown) breakdown.totalApplicants++;

        if (app.status === 'accepted') {
          acceptedCount++;
          if (breakdown) breakdown.acceptedCount++;
        } else if (app.status === 'declined') {
          declinedCount++;
          if (breakdown) breakdown.declinedCount++;
        } else {
          pendingCount++;
          if (breakdown) breakdown.pendingCount++;
        }
      }

      const acceptanceRate =
        totalApplicants > 0 ? Math.round((acceptedCount / totalApplicants) * 100) : 0;

      const report: ClientApplicantSummary = {
        totalGigs: gigs.length,
        totalApplicants,
        pendingCount,
        acceptedCount,
        declinedCount,
        acceptanceRate,
        gigBreakdowns: Array.from(breakdownMap.values()),
        allApplicants,
      };

      await offlineSyncService.cacheItem(`@offline_client_report_${clientId}`, report);
      return report;
    } catch (err) {
      const cached = await offlineSyncService.getCachedItem<ClientApplicantSummary>(
        `@offline_client_report_${clientId}`
      );
      if (cached) return cached;
      throw err;
    }
  },

  async getFreelancerReport(): Promise<FreelancerApplicationSummary> {
    try {
      const apps = await applicationsService.getMyApplications();

      let pendingCount = 0;
      let acceptedCount = 0;
      let declinedCount = 0;
      let counteredCount = 0;

      apps.forEach((app) => {
        if (app.status === 'accepted') {
          acceptedCount++;
        } else if (app.status === 'declined') {
          declinedCount++;
        } else if (app.status === 'countered') {
          counteredCount++;
          pendingCount++;
        } else {
          pendingCount++;
        }
      });

      const totalApplied = apps.length;
      const successRate = totalApplied > 0 ? Math.round((acceptedCount / totalApplied) * 100) : 0;

      const report: FreelancerApplicationSummary = {
        totalApplied,
        pendingCount,
        acceptedCount,
        declinedCount,
        counteredCount,
        successRate,
        applications: apps,
      };

      await offlineSyncService.cacheItem('@offline_freelancer_report', report);
      return report;
    } catch (err) {
      const cached = await offlineSyncService.getCachedItem<FreelancerApplicationSummary>(
        '@offline_freelancer_report'
      );
      if (cached) return cached;
      throw err;
    }
  },
};
