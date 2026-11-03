import { supabase } from '../lib/supabase';
import { runOnce } from '../lib/singleFlight';
import { offlineSyncService } from './offlineSync';

export interface ApplicationItem {
  id: string;
  gig_id: string;
  freelancer_id: string;
  proposed_price: number; // in centavos
  estimated_days: number;
  message: string;
  status: 'applied' | 'accepted' | 'declined' | 'countered' | 'withdrawn';
  status_reason?: string | null;
  gig_title_snapshot?: string | null;
  counter_price?: number | null;
  created_at: string;
  updated_at: string;
  freelancer?: {
    id: string;
    display_name: string;
    avatar_path: string | null;
    freelancer_rating_avg: number;
    freelancer_rating_count: number;
    freelancer_completed_gigs: number;
    is_legit_verified?: boolean;
  };
  gig?: {
    id: string;
    title: string;
    price_min: number;
    price_max: number;
    work_type: string;
    deadline: string;
    client_id?: string;
    client?: {
      id: string;
      display_name: string;
      avatar_path: string | null;
    };
  };
}

export interface AgreementItem {
  id: string;
  gig_id: string;
  client_id: string;
  freelancer_id: string;
  agreed_price: number; // in centavos
  deadline: string;
  status: 'active' | 'completed' | 'cancelled' | 'disputed';
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
  gig?: {
    id: string;
    title: string;
    work_type: string;
  };
  client?: {
    id: string;
    display_name: string;
    avatar_path: string | null;
    is_legit_verified?: boolean;
  };
  freelancer?: {
    id: string;
    display_name: string;
    avatar_path: string | null;
    is_legit_verified?: boolean;
  };
}

export interface ModeSwitchStatus {
  current_mode: 'find_work' | 'hire' | null;
  can_switch: boolean;
  cooldown_remaining_days: number;
  blockers: string[];
  pending_gigs_count: number;
  pending_apps_count: number;
}

export const applicationsService = {
  async submitApplication(params: {
    gigId: string;
    proposedPrice: number; // in centavos
    estimatedDays: number;
    message: string;
    requestId?: string;
  }): Promise<string> {
    return runOnce(
      `submit_application:${params.gigId}`,
      async (reqId) => {
        const baseArgs = {
          p_gig_id: params.gigId,
          p_proposed_price: params.proposedPrice,
          p_estimated_days: params.estimatedDays,
          p_message: params.message,
        };
        try {
          let { data, error } = await supabase.rpc('submit_application', {
            ...baseArgs,
            p_request_id: reqId,
          });
          if (error && error.code === 'PGRST202') {
            ({ data, error } = await supabase.rpc('submit_application', baseArgs));
          }

          if (error) throw error;
          return data as string;
        } catch (err: any) {
          const isNetworkIssue =
            err?.code === 'OFFLINE' ||
            err?.code === 'TIMEOUT' ||
            err?.message?.toLowerCase().includes('network') ||
            err?.message?.toLowerCase().includes('fetch');

          if (isNetworkIssue) {
            // Queue for offline sync
            const tempId = `off_${Date.now()}`;
            await offlineSyncService.queueAction('submit_application', {
              gigId: params.gigId,
              proposedPrice: params.proposedPrice,
              estimatedDays: params.estimatedDays,
              message: params.message,
            }, reqId);
            return tempId;
          }
          throw err;
        }
      },
      { requestId: params.requestId }
    );
  },

  async respondToApplication(
    applicationId: string,
    action: 'accept' | 'decline' | 'counter',
    counterPrice?: number,
    requestId?: string
  ): Promise<string | null> {
    return runOnce(
      `respond_to_application:${applicationId}:${action}`,
      async (reqId) => {
        const baseArgs = {
          p_application_id: applicationId,
          p_action: action,
          p_counter_price: counterPrice || null,
        };
        try {
          let { data, error } = await supabase.rpc('respond_to_application', {
            ...baseArgs,
            p_request_id: reqId,
          });
          if (error && error.code === 'PGRST202') {
            ({ data, error } = await supabase.rpc('respond_to_application', baseArgs));
          }

          if (error) throw error;
          return data as string | null;
        } catch (err: any) {
          const isNetworkIssue =
            err?.code === 'OFFLINE' ||
            err?.code === 'TIMEOUT' ||
            err?.message?.toLowerCase().includes('network') ||
            err?.message?.toLowerCase().includes('fetch');

          if (isNetworkIssue) {
            await offlineSyncService.queueAction('respond_to_application', {
              applicationId,
              action,
              counterPrice,
            }, reqId);
            return action === 'accept' ? `off_agr_${Date.now()}` : null;
          }
          throw err;
        }
      },
      { requestId }
    );
  },

  async respondToCounter(
    applicationId: string,
    action: 'accept' | 'decline' | 'withdraw',
    requestId?: string
  ): Promise<string | null> {
    return runOnce(
      `respond_to_counter:${applicationId}:${action}`,
      async (reqId) => {
        const baseArgs = {
          p_application_id: applicationId,
          p_action: action,
        };
        let { data, error } = await supabase.rpc('respond_to_counter', {
          ...baseArgs,
          p_request_id: reqId,
        });
        if (error && error.code === 'PGRST202') {
          ({ data, error } = await supabase.rpc('respond_to_counter', baseArgs));
        }

        if (error) throw error;
        return data as string | null;
      },
      { requestId }
    );
  },

  async getGigApplicants(gigId: string): Promise<ApplicationItem[]> {
    const fetchRemote = async () => {
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
        .eq('gig_id', gigId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as any[];
    };

    const getCached = async () => {
      return offlineSyncService.getCachedGigApplicants(gigId);
    };

    const { data } = await offlineSyncService.withOfflineFallback(
      fetchRemote,
      getCached,
      async (res) => {
        await offlineSyncService.cacheGigApplicants(gigId, res);
      }
    );
    return data;
  },

  async getMyApplications(): Promise<ApplicationItem[]> {
    const fetchRemote = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

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
          gig:gigs(
            id,
            title,
            price_min,
            price_max,
            work_type,
            deadline,
            client_id,
            client:profiles!gigs_client_id_fkey(
              id,
              display_name,
              avatar_path
            )
          )
        `)
        .eq('freelancer_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as any[];
    };

    const getCached = async () => {
      return offlineSyncService.getCachedMyApplications();
    };

    const { data } = await offlineSyncService.withOfflineFallback(
      fetchRemote,
      getCached,
      async (res) => {
        await offlineSyncService.cacheMyApplications(res);
      }
    );
    return data;
  },

  async getMyAgreements(): Promise<AgreementItem[]> {
    const fetchRemote = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from('agreements')
        .select(`
          id,
          gig_id,
          client_id,
          freelancer_id,
          agreed_price,
          deadline,
          status,
          created_at,
          updated_at,
          gig:gigs(
            id,
            title,
            work_type
          ),
          client:profiles!agreements_client_id_fkey(
            id,
            display_name,
            avatar_path,
            is_legit_verified
          ),
          freelancer:profiles!agreements_freelancer_id_fkey(
            id,
            display_name,
            avatar_path,
            is_legit_verified
          )
        `)
        .or(`client_id.eq.${user.id},freelancer_id.eq.${user.id}`)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as any[];
    };

    const getCached = async () => {
      return offlineSyncService.getCachedMyAgreements();
    };

    const { data } = await offlineSyncService.withOfflineFallback(
      fetchRemote,
      getCached,
      async (res) => {
        await offlineSyncService.cacheMyAgreements(res);
      }
    );
    return data;
  },

  async getAgreementDetail(agreementId: string): Promise<AgreementItem | null> {
    const { data, error } = await supabase
      .from('agreements')
      .select(`
        id,
        gig_id,
        client_id,
        freelancer_id,
        agreed_price,
        deadline,
        status,
        created_at,
        updated_at,
        gig:gigs(
          id,
          title,
          work_type
        ),
        client:profiles!agreements_client_id_fkey(
          id,
          display_name,
          avatar_path,
          is_legit_verified
        ),
        freelancer:profiles!agreements_freelancer_id_fkey(
          id,
          display_name,
          avatar_path,
          is_legit_verified
        )
      `)
      .eq('id', agreementId)
      .maybeSingle();

    if (error || !data) return null;
    return data as any;
  },

  async getModeSwitchStatus(): Promise<ModeSwitchStatus> {
    try {
      const { data, error } = await supabase.rpc('get_mode_switch_status');
      if (error) throw error;
      return data as ModeSwitchStatus;
    } catch {
      return {
        current_mode: 'find_work',
        can_switch: false,
        cooldown_remaining_days: 0,
        blockers: ['Unable to verify switch status. Try again.'],
        pending_gigs_count: 0,
        pending_apps_count: 0,
      };
    }
  },

  async switchMode(targetMode: 'find_work' | 'hire', confirm: boolean = true): Promise<void> {
    return runOnce(`switch_mode:${targetMode}`, async () => {
      const { error } = await supabase.rpc('switch_mode', {
        p_target_mode: targetMode,
        p_confirm: confirm,
      });

      if (error) throw error;
    });
  },

  subscribeToGigApplicants(gigId: string, onChange: () => void) {
    try {
      const channel = supabase
        .channel(`gig-applicants:${gigId}:${Date.now()}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'applications', filter: `gig_id=eq.${gigId}` },
          () => onChange()
        )
        .subscribe();
      return () => {
        try {
          supabase.removeChannel(channel);
        } catch {}
      };
    } catch {
      return () => {};
    }
  },
};
