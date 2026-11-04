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
        // 1. Try rpc_submit_application first (IAS 1 redesign)
        try {
          const { data, error } = await supabase.rpc('rpc_submit_application', {
            p_gig_id: params.gigId,
            p_cover_letter: params.message,
            p_proposed_rate_centavos: params.proposedPrice,
            p_estimated_days: params.estimatedDays,
          });

          if (!error) {
            if (data && typeof data === 'object' && (data as any).ok === false) {
              const err: any = new Error((data as any).message || 'Failed to submit application.');
              err.code = (data as any).code;
              throw err;
            }
            return String((data as any)?.application_id || reqId);
          }
          if (error.code !== 'PGRST202' && !error.message?.includes('not find')) {
            throw error;
          }
        } catch (err: any) {
          if (err?.code && err?.code !== 'PGRST202') throw err;
        }

        // 2. Try legacy submit_application RPC
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
        // 1. If accepting, try rpc_accept_application first
        if (action === 'accept') {
          try {
            const { data, error } = await supabase.rpc('rpc_accept_application', {
              p_application_id: applicationId,
              p_terms_summary: 'Accepted proposal. Initial terms agreed.',
            });

            if (!error) {
              if (data && typeof data === 'object' && (data as any).ok === false) {
                const err: any = new Error((data as any).message || 'Failed to accept application.');
                err.code = (data as any).code;
                throw err;
              }
              return String((data as any)?.agreement_id || null);
            }
            if (error.code !== 'PGRST202' && !error.message?.includes('not find')) {
              throw error;
            }
          } catch (err: any) {
            if (err?.code && err?.code !== 'PGRST202') throw err;
          }
        }

        // 2. If declining, update applications table directly or call RPC
        if (action === 'decline') {
          try {
            await supabase
              .from('applications')
              .update({ status: 'rejected' })
              .eq('id', applicationId);
            return null;
          } catch {}
        }

        // 3. Fallback to respond_to_application
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
      // 1. Try modern schema columns first
      try {
        const { data, error } = await supabase
          .from('applications')
          .select(`
            id,
            gig_id,
            freelancer_id,
            cover_letter,
            proposed_rate_centavos,
            estimated_days,
            status,
            created_at,
            freelancer:profiles(
              id,
              display_name,
              avatar_url,
              avatar_path,
              freelancer_rating_avg,
              freelancer_rating_count,
              freelancer_completed_gigs,
              is_legit_verified
            )
          `)
          .eq('gig_id', gigId)
          .order('created_at', { ascending: false });

        if (!error && data) {
          return data.map((row: any) => ({
            id: row.id,
            gig_id: row.gig_id,
            freelancer_id: row.freelancer_id,
            proposed_price: Number(row.proposed_rate_centavos || 0),
            estimated_days: row.estimated_days || 1,
            message: row.cover_letter || '',
            status: row.status,
            status_reason: null,
            gig_title_snapshot: null,
            counter_price: null,
            created_at: row.created_at,
            updated_at: row.created_at,
            freelancer: row.freelancer
              ? {
                  id: row.freelancer.id,
                  display_name: row.freelancer.display_name,
                  avatar_path: row.freelancer.avatar_url || row.freelancer.avatar_path || null,
                  freelancer_rating_avg: row.freelancer.freelancer_rating_avg || 0,
                  freelancer_rating_count: row.freelancer.freelancer_rating_count || 0,
                  freelancer_completed_gigs: row.freelancer.freelancer_completed_gigs || 0,
                  is_legit_verified: Boolean(row.freelancer.is_legit_verified),
                }
              : undefined,
          })) as ApplicationItem[];
        }
      } catch (err) {
        console.warn('getGigApplicants primary query warning:', err);
      }

      // 2. Fallback to legacy query
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
          created_at,
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
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData?.session?.user ?? (await supabase.auth.getUser()).data.user;
      if (!user) return [];

      // 1. Try modern schema
      try {
        const { data, error } = await supabase
          .from('applications')
          .select(`
            id,
            gig_id,
            freelancer_id,
            cover_letter,
            proposed_rate_centavos,
            estimated_days,
            status,
            created_at,
            gig:gigs(
              id,
              title,
              budget_centavos,
              budget_type,
              location_barangay,
              created_at,
              client_id,
              client:profiles!gigs_client_id_fkey(
                id,
                display_name,
                avatar_url,
                avatar_path
              )
            )
          `)
          .eq('freelancer_id', user.id)
          .order('created_at', { ascending: false });

        if (!error && data) {
          return data.map((row: any) => ({
            id: row.id,
            gig_id: row.gig_id,
            freelancer_id: row.freelancer_id,
            proposed_price: Number(row.proposed_rate_centavos || 0),
            estimated_days: row.estimated_days || 1,
            message: row.cover_letter || '',
            status: row.status,
            status_reason: null,
            gig_title_snapshot: row.gig?.title || null,
            counter_price: null,
            created_at: row.created_at,
            updated_at: row.created_at,
            gig: row.gig
              ? {
                  id: row.gig.id,
                  title: row.gig.title,
                  price_min: Number(row.gig.budget_centavos || 0),
                  price_max: Number(row.gig.budget_centavos || 0),
                  work_type: row.gig.budget_type || 'fixed',
                  deadline: row.gig.created_at,
                  client_id: row.gig.client_id,
                  client: row.gig.client
                    ? {
                        id: row.gig.client.id,
                        display_name: row.gig.client.display_name,
                        avatar_path: row.gig.client.avatar_url || row.gig.client.avatar_path || null,
                      }
                    : undefined,
                }
              : undefined,
          })) as ApplicationItem[];
        }
      } catch (err) {
        console.warn('getMyApplications primary query warning:', err);
      }

      // 2. Fallback to legacy schema
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
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData?.session?.user ?? (await supabase.auth.getUser()).data.user;
      if (!user) return [];

      // 1. Try modern schema
      try {
        const { data, error } = await supabase
          .from('agreements')
          .select(`
            id,
            gig_id,
            client_id,
            freelancer_id,
            total_amount_centavos,
            terms_summary,
            status,
            completed_at,
            created_at,
            gig:gigs(
              id,
              title,
              budget_type
            ),
            client:profiles!agreements_client_id_fkey(
              id,
              display_name,
              avatar_url,
              avatar_path,
              is_legit_verified
            ),
            freelancer:profiles!agreements_freelancer_id_fkey(
              id,
              display_name,
              avatar_url,
              avatar_path,
              is_legit_verified
            )
          `)
          .or(`client_id.eq.${user.id},freelancer_id.eq.${user.id}`)
          .order('created_at', { ascending: false });

        if (!error && data) {
          return data.map((row: any) => ({
            id: row.id,
            gig_id: row.gig_id,
            client_id: row.client_id,
            freelancer_id: row.freelancer_id,
            agreed_price: Number(row.total_amount_centavos || 0),
            deadline: row.completed_at || row.created_at,
            status: row.status,
            completed_at: row.completed_at || null,
            created_at: row.created_at,
            updated_at: row.created_at,
            gig: row.gig
              ? {
                  id: row.gig.id,
                  title: row.gig.title,
                  work_type: row.gig.budget_type || 'fixed',
                }
              : undefined,
            client: row.client
              ? {
                  id: row.client.id,
                  display_name: row.client.display_name,
                  avatar_path: row.client.avatar_url || row.client.avatar_path || null,
                  is_legit_verified: Boolean(row.client.is_legit_verified),
                }
              : undefined,
            freelancer: row.freelancer
              ? {
                  id: row.freelancer.id,
                  display_name: row.freelancer.display_name,
                  avatar_path: row.freelancer.avatar_url || row.freelancer.avatar_path || null,
                  is_legit_verified: Boolean(row.freelancer.is_legit_verified),
                }
              : undefined,
          })) as AgreementItem[];
        }
      } catch (err) {
        console.warn('getMyAgreements primary query warning:', err);
      }

      // 2. Fallback to legacy schema
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
    // 1. Try modern schema
    try {
      const { data, error } = await supabase
        .from('agreements')
        .select(`
          id,
          gig_id,
          client_id,
          freelancer_id,
          total_amount_centavos,
          terms_summary,
          status,
          completed_at,
          created_at,
          gig:gigs(
            id,
            title,
            budget_type
          ),
          client:profiles!agreements_client_id_fkey(
            id,
            display_name,
            avatar_url,
            avatar_path,
            is_legit_verified
          ),
          freelancer:profiles!agreements_freelancer_id_fkey(
            id,
            display_name,
            avatar_url,
            avatar_path,
            is_legit_verified
          )
        `)
        .eq('id', agreementId)
        .maybeSingle();

      if (!error && data) {
        const row = data as any;
        return {
          id: row.id,
          gig_id: row.gig_id,
          client_id: row.client_id,
          freelancer_id: row.freelancer_id,
          agreed_price: Number(row.total_amount_centavos || 0),
          deadline: row.completed_at || row.created_at,
          status: row.status,
          completed_at: row.completed_at || null,
          created_at: row.created_at,
          updated_at: row.created_at,
          gig: row.gig
            ? {
                id: row.gig.id,
                title: row.gig.title,
                work_type: row.gig.budget_type || 'fixed',
              }
            : undefined,
          client: row.client
            ? {
                id: row.client.id,
                display_name: row.client.display_name,
                avatar_path: row.client.avatar_url || row.client.avatar_path || null,
                is_legit_verified: Boolean(row.client.is_legit_verified),
              }
            : undefined,
          freelancer: row.freelancer
            ? {
                id: row.freelancer.id,
                display_name: row.freelancer.display_name,
                avatar_path: row.freelancer.avatar_url || row.freelancer.avatar_path || null,
                is_legit_verified: Boolean(row.freelancer.is_legit_verified),
              }
            : undefined,
        };
      }
    } catch {}

    // 2. Fallback to legacy schema
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
      const raw = (data || {}) as any;
      return {
        current_mode: raw.current_mode ?? null,
        can_switch: raw.can_switch ?? raw.eligible ?? false,
        cooldown_remaining_days: raw.cooldown_remaining_days ?? raw.cooldown_days ?? 0,
        blockers: Array.isArray(raw.blockers)
          ? raw.blockers
          : Array.isArray(raw.blocking_reasons)
          ? raw.blocking_reasons
          : [],
        pending_gigs_count: raw.pending_gigs_count ?? raw.active_gigs_count ?? 0,
        pending_apps_count: raw.pending_apps_count ?? raw.active_apps_count ?? 0,
      };
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
      // 1. Try rpc_switch_user_mode first (IAS 1 redesign)
      try {
        const { data, error } = await supabase.rpc('rpc_switch_user_mode', {
          p_target_mode: targetMode,
        });
        if (!error) {
          if (data && typeof data === 'object' && (data as any).ok === false) {
            const err: any = new Error((data as any).message || 'Failed to switch mode.');
            err.code = (data as any).code;
            throw err;
          }
          return;
        }
        const isIgnorable =
          error.code === 'PGRST202' ||
          error.code === '42703' ||
          error.message?.includes('not find') ||
          error.message?.includes('does not exist');
        if (!isIgnorable) {
          throw error;
        }
      } catch (err: any) {
        const isIgnorable =
          err?.code === 'PGRST202' ||
          err?.code === '42703' ||
          err?.message?.includes('not find') ||
          err?.message?.includes('does not exist');
        if (!isIgnorable) throw err;
      }

      // 2. Try switch_mode
      try {
        const { data, error } = await supabase.rpc('switch_mode', {
          p_target_mode: targetMode,
          p_confirm: confirm,
        });

        if (!error) {
          if (data && typeof data === 'object' && (data as any).ok === false) {
            const err: any = new Error((data as any).message || 'Failed to switch mode.');
            err.code = (data as any).code;
            throw err;
          }
          return;
        }
        const isIgnorable =
          error.code === 'PGRST202' ||
          error.code === '42703' ||
          error.message?.includes('not find') ||
          error.message?.includes('does not exist');
        if (!isIgnorable) {
          throw error;
        }
      } catch (rpcErr: any) {
        const isIgnorable =
          rpcErr?.code === 'PGRST202' ||
          rpcErr?.code === '42703' ||
          rpcErr?.message?.includes('not find') ||
          rpcErr?.message?.includes('does not exist');
        if (!isIgnorable) throw rpcErr;
      }

      // 3. Fallback: update profile active_mode directly
      const { data: authData } = await supabase.auth.getUser();
      const user = authData?.user;
      if (!user) throw new Error('Not authenticated');

      const dbMode = targetMode === 'hire' ? 'hire' : 'find_work';
      const { error: updateErr } = await supabase
        .from('profiles')
        .update({
          active_mode: dbMode,
          last_mode_switch_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (updateErr) {
        throw updateErr;
      }
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
