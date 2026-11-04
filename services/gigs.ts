import { supabase } from '../lib/supabase';
import { runOnce } from '../lib/singleFlight';
import { GigSummary } from '../components/ui/GigCard';
import { Category } from './profile';
import { aiService } from './ai';
import { offlineSyncService } from './offlineSync';

export interface GigDetail extends GigSummary {
  description: string;
  requirements: string;
  category_id: string;
  secondary_category_ids?: string[];
  client_id: string;
  created_at: string;
  updated_at: string;
  client: {
    id: string;
    display_name: string;
    avatar_path: string | null;
    area: string | null;
    client_rating_avg: number;
    client_rating_count: number;
    client_completed_gigs: number;
  };
}

export interface CreateGigParams {
  title: string;
  description: string;
  requirements: string;
  category_id?: string | null;
  category_name?: string | null;
  secondary_category_ids?: string[];
  price_min: number; // in centavos
  price_max: number; // in centavos
  work_type: 'remote' | 'face_to_face' | 'hybrid';
  area?: string;
  application_deadline: string;
  deadline: string;
}

export interface SuggestedGigCategory {
  id: string;
  name: string;
  slug: string;
  similarity_score?: number;
  match_reason: string;
  source?: 'db' | 'ai';
}

export interface SimilarCategory {
  id: string;
  name: string;
  slug: string;
  similarity_score: number;
}

interface GetGigsFilter {
  categoryId?: string;
  workType?: 'remote' | 'face_to_face' | 'hybrid';
  searchQuery?: string;
}

export const gigsService = {
  subscribeToGigChanges(onChange: () => void, clientId?: string) {
    const topic = `gig-changes:${clientId || 'visible'}:${Date.now()}`;
    const change = supabase
      .channel(topic)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'gigs',
          ...(clientId ? { filter: `client_id=eq.${clientId}` } : {}),
        },
        () => onChange()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(change);
    };
  },

  async getGigs(filter?: GetGigsFilter): Promise<GigSummary[]> {
    // 1. Try modern database schema
    try {
      let query = supabase
        .from('gigs')
        .select(`
          id,
          client_id,
          title,
          category,
          description,
          budget_centavos,
          budget_type,
          location_barangay,
          required_skills,
          status,
          created_at,
          updated_at,
          client:profiles!gigs_client_id_fkey(
            id,
            display_name,
            avatar_url,
            area_barangay,
            legitimacy_score
          )
        `)
        .eq('status', 'open')
        .order('created_at', { ascending: false });

      if (filter?.categoryId) {
        query = query.eq('category', filter.categoryId);
      }

      if (filter?.workType) {
        query = query.eq('budget_type', filter.workType);
      }

      if (filter?.searchQuery && filter.searchQuery.trim()) {
        query = query.ilike('title', `%${filter.searchQuery.trim()}%`);
      }

      const { data: authData } = await supabase.auth.getUser();
      if (authData?.user?.id) {
        query = query.neq('client_id', authData.user.id);
      }

      const { data, error } = await query;
      if (!error && data) {
        return data.map((row: any) => ({
          id: row.id,
          title: row.title,
          category_name: row.category || 'General',
          price_min: Number(row.budget_centavos || 0),
          price_max: Number(row.budget_centavos || 0),
          work_type: row.budget_type || 'fixed',
          area: row.location_barangay || 'Ormoc City',
          application_deadline: row.created_at,
          deadline: row.created_at,
          status: row.status,
          client: row.client
            ? {
                display_name: row.client.display_name,
                avatar_path: row.client.avatar_url || null,
                client_rating_avg: 5.0,
                client_rating_count: 0,
              }
            : undefined,
        }));
      }
    } catch (modernErr) {
      console.warn('getGigs primary query warning:', modernErr);
    }

    // 2. Fallback to legacy query
    let query = supabase
      .from('gigs')
      .select(`
        id,
        title,
        price_min,
        price_max,
        work_type,
        area,
        application_deadline,
        deadline,
        status,
        category:categories(name),
        client:profiles!gigs_client_id_fkey(display_name, client_rating_avg, client_rating_count)
      `)
      .eq('status', 'open')
      .gt('application_deadline', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (filter?.categoryId) {
      query = query.eq('category_id', filter.categoryId);
    }

    if (filter?.workType) {
      query = query.eq('work_type', filter.workType);
    }

    if (filter?.searchQuery && filter.searchQuery.trim()) {
      query = query.ilike('title', `%${filter.searchQuery.trim()}%`);
    }

    // Own-content rule: exclude caller's own gigs from available work
    const { data: authData } = await supabase.auth.getUser();
    if (authData?.user?.id) {
      query = query.neq('client_id', authData.user.id);
    }

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map((row: any) => ({
      id: row.id,
      title: row.title,
      category_name: row.category?.name,
      price_min: row.price_min,
      price_max: row.price_max,
      work_type: row.work_type,
      area: row.area,
      application_deadline: row.application_deadline,
      deadline: row.deadline,
      status: row.status,
      client: row.client
        ? {
            display_name: row.client.display_name,
            client_rating_avg: row.client.client_rating_avg,
            client_rating_count: row.client.client_rating_count,
          }
        : undefined,
    }));
  },

  async getGig(id: string): Promise<GigDetail | null> {
    // 1. Try modern database schema
    try {
      const { data, error } = await supabase
        .from('gigs')
        .select(`
          id,
          client_id,
          title,
          category,
          description,
          budget_centavos,
          budget_type,
          location_barangay,
          required_skills,
          status,
          created_at,
          updated_at,
          client:profiles!gigs_client_id_fkey(
            id,
            display_name,
            avatar_url,
            area_barangay,
            bio,
            legitimacy_score
          )
        `)
        .eq('id', id)
        .maybeSingle();

      if (!error && data) {
        const row = data as any;
        return {
          id: row.id,
          client_id: row.client_id,
          title: row.title,
          description: row.description || '',
          requirements: Array.isArray(row.required_skills) ? row.required_skills.join(', ') : '',
          category_id: row.category || '',
          secondary_category_ids: Array.isArray(row.required_skills) ? row.required_skills : [],
          category_name: row.category || 'General',
          price_min: Number(row.budget_centavos || 0),
          price_max: Number(row.budget_centavos || 0),
          work_type: row.budget_type || 'fixed',
          area: row.location_barangay || 'Ormoc City',
          application_deadline: row.created_at,
          deadline: row.created_at,
          status: row.status,
          created_at: row.created_at,
          updated_at: row.updated_at,
          client: row.client
            ? {
                id: row.client.id || row.client_id,
                display_name: row.client.display_name || 'Client',
                avatar_path: row.client.avatar_url || null,
                area: row.client.area_barangay || null,
                client_rating_avg: 5.0,
                client_rating_count: 0,
                client_completed_gigs: 0,
              }
            : {
                id: row.client_id,
                display_name: 'Client',
                avatar_path: null,
                area: null,
                client_rating_avg: 5.0,
                client_rating_count: 0,
                client_completed_gigs: 0,
              },
        };
      }
    } catch (err) {
      console.warn('getGig primary query warning:', err);
    }

    // 2. Fallback to legacy query
    const { data, error } = await supabase
      .from('gigs')
      .select(`
        id,
        client_id,
        title,
        description,
        requirements,
        category_id,
        secondary_category_ids,
        price_min,
        price_max,
        work_type,
        area,
        application_deadline,
        deadline,
        status,
        created_at,
        updated_at,
        category:categories(name),
        client:profiles!gigs_client_id_fkey(
          id,
          display_name,
          avatar_path,
          area,
          client_rating_avg,
          client_rating_count,
          client_completed_gigs
        )
      `)
      .eq('id', id)
      .maybeSingle();

    if (error || !data) return null;

    const row = data as any;
    return {
      id: row.id,
      client_id: row.client_id,
      title: row.title,
      description: row.description,
      requirements: row.requirements,
      category_id: row.category_id,
      secondary_category_ids: row.secondary_category_ids || [],
      category_name: row.category?.name,
      price_min: row.price_min,
      price_max: row.price_max,
      work_type: row.work_type,
      area: row.area,
      application_deadline: row.application_deadline,
      deadline: row.deadline,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      client: row.client || {
        id: row.client_id,
        display_name: 'Unknown Client',
        avatar_path: null,
        area: null,
        client_rating_avg: 0,
        client_rating_count: 0,
        client_completed_gigs: 0,
      },
    };
  },

  async getMyGigs(clientId: string): Promise<GigSummary[]> {
    const fetchRemote = async () => {
      // 1. Try modern schema
      try {
        const { data, error } = await supabase
          .from('gigs')
          .select(`
            id,
            client_id,
            title,
            category,
            description,
            budget_centavos,
            budget_type,
            location_barangay,
            required_skills,
            status,
            created_at,
            updated_at
          `)
          .eq('client_id', clientId)
          .order('created_at', { ascending: false });

        if (!error && data) {
          return data.map((row: any) => ({
            id: row.id,
            title: row.title,
            category_name: row.category || 'General',
            price_min: Number(row.budget_centavos || 0),
            price_max: Number(row.budget_centavos || 0),
            work_type: row.budget_type || 'fixed',
            area: row.location_barangay || 'Ormoc City',
            application_deadline: row.created_at,
            deadline: row.created_at,
            status: row.status,
          }));
        }
      } catch (err) {
        console.warn('getMyGigs primary query warning:', err);
      }

      // 2. Fallback to legacy query
      const { data, error } = await supabase
        .from('gigs')
        .select(`
          id,
          title,
          price_min,
          price_max,
          work_type,
          area,
          application_deadline,
          deadline,
          status,
          category:categories(name)
        `)
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (data || []).map((row: any) => ({
        id: row.id,
        title: row.title,
        category_name: row.category?.name,
        price_min: row.price_min,
        price_max: row.price_max,
        work_type: row.work_type,
        area: row.area,
        application_deadline: row.application_deadline,
        deadline: row.deadline,
        status: row.status,
      }));
    };

    const getCached = async () => {
      return offlineSyncService.getCachedMyGigs();
    };

    const { data } = await offlineSyncService.withOfflineFallback(
      fetchRemote,
      getCached,
      async (res) => {
        await offlineSyncService.cacheMyGigs(res);
      }
    );
    return data;
  },

  async createDraftGig(params: CreateGigParams & { requestId?: string }): Promise<{ id: string }> {
    return runOnce(
      `create_draft_gig:${params.title.trim().toLowerCase()}`,
      async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated.');

        // 1. Try rpc_create_or_update_gig first (IAS 1 redesign)
        try {
          const { data, error } = await supabase.rpc('rpc_create_or_update_gig', {
            p_gig_id: null,
            p_title: params.title.trim(),
            p_category: (params.category_name || params.category_id || 'General').trim(),
            p_description: params.description.trim(),
            p_budget_centavos: params.price_min || params.price_max || 10000,
            p_budget_type: ((params as any).budget_type || 'fixed') as 'fixed' | 'hourly',
            p_location_barangay: (params.area || 'Ormoc City').trim(),
            p_required_skills: params.secondary_category_ids || [],
            p_status: 'draft',
          });

          if (!error) {
            if (data && typeof data === 'object' && (data as any).ok === false) {
              const err: any = new Error((data as any).message || 'Failed to post gig.');
              err.code = (data as any).code;
              throw err;
            }
            return { id: String((data as any)?.gig_id || 'created') };
          }
          if (error.code !== 'PGRST202' && !error.message?.includes('not find')) {
            throw error;
          }
        } catch (err: any) {
          if (err?.code && err?.code !== 'PGRST202') throw err;
        }

        // 2. Try legacy create_draft_gig
        const isUuid = (val?: string | null) =>
          Boolean(val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim()));

        if (params.category_id && !isUuid(params.category_id)) {
          if (!params.category_name) {
            params.category_name = params.category_id;
          }
          params.category_id = null;
        }

        const { data, error } = await supabase.rpc('create_draft_gig', {
          p_title: params.title,
          p_description: params.description,
          p_requirements: params.requirements || '',
          p_price_min: params.price_min,
          p_price_max: params.price_max,
          p_work_type: params.work_type,
          p_area: params.area || '',
          p_application_deadline: params.application_deadline,
          p_deadline: params.deadline,
          p_category_id: params.category_id || null,
          p_category_name: params.category_name || null,
          p_secondary_category_ids: params.secondary_category_ids || [],
        });

        if (error) throw error;
        return { id: String(data) };
      },
      { requestId: params.requestId }
    );
  },

  async updateGig(gigId: string, params: CreateGigParams): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated.');

    return runOnce(
      `update_gig:${gigId}`,
      async (reqId) => {
        // 1. Try rpc_create_or_update_gig first
        try {
          const { data, error } = await supabase.rpc('rpc_create_or_update_gig', {
            p_gig_id: gigId,
            p_title: params.title.trim(),
            p_category: (params.category_name || params.category_id || 'General').trim(),
            p_description: params.description.trim(),
            p_budget_centavos: params.price_min || params.price_max || 10000,
            p_budget_type: ((params as any).budget_type || 'fixed') as 'fixed' | 'hourly',
            p_location_barangay: (params.area || 'Ormoc City').trim(),
            p_required_skills: params.secondary_category_ids || [],
          });

          if (!error) {
            if (data && typeof data === 'object' && (data as any).ok === false) {
              const err: any = new Error((data as any).message || 'Failed to update gig.');
              err.code = (data as any).code;
              throw err;
            }
            return;
          }
          if (error.code !== 'PGRST202' && !error.message?.includes('not find')) {
            throw error;
          }
        } catch (err: any) {
          if (err?.code && err?.code !== 'PGRST202') throw err;
        }

        // 2. Try legacy update_gig
        const isUuid = (val?: string | null) =>
          Boolean(val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim()));

        if (params.category_id && !isUuid(params.category_id)) {
          if (!params.category_name) {
            params.category_name = params.category_id;
          }
          params.category_id = null;
        }

        const { error } = await supabase.rpc('update_gig', {
          p_gig_id: gigId,
          p_title: params.title,
          p_description: params.description,
          p_requirements: params.requirements || '',
          p_price_min: params.price_min,
          p_price_max: params.price_max,
          p_work_type: params.work_type,
          p_area: params.area || '',
          p_application_deadline: params.application_deadline,
          p_deadline: params.deadline,
          p_category_id: params.category_id || null,
          p_category_name: params.category_name || null,
          p_secondary_category_ids: params.secondary_category_ids || [],
          p_request_id: reqId,
        });

        if (error) throw error;
      },
    );
  },

  async getOrCreateCategory(name: string): Promise<string> {
    return runOnce(`get_or_create_category:${name.trim().toLowerCase()}`, async () => {
      const { data, error } = await supabase.rpc('get_or_create_category', {
        p_name: name,
      });
      if (error) throw error;
      return String(data);
    });
  },

  async suggestCategoriesForGig(title: string, description?: string): Promise<SuggestedGigCategory[]> {
    const { data, error } = await supabase.rpc('suggest_categories_for_gig', {
      p_title: title || '',
      p_description: description || '',
    });
    if (error) throw error;
    return ((data as any[]) || []).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      slug: String(row.slug),
      similarity_score: typeof row.similarity_score === 'number' ? row.similarity_score : undefined,
      match_reason: String(row.match_reason || 'Matches your gig'),
      source: 'db' as const,
    }));
  },

  /**
   * Suggests categories using AI (restricted to active DB categories + optional 1 general new category)
   * and automatically falls back to DB pg_trgm suggest_categories_for_gig if AI fails or returns empty.
   */
  async suggestCategoriesWithAiFallback(
    title: string,
    description?: string
  ): Promise<{
    suggestions: SuggestedGigCategory[];
    proposed_new_category: string | null;
    usedFallback: boolean;
  }> {
    try {
      const aiRes = await aiService.suggestGigCategory({ title, description });
      if (aiRes.suggestions && aiRes.suggestions.length > 0) {
        const browseCats = await this.getBrowseCategories().catch(() => []);
        return {
          suggestions: aiRes.suggestions.map((s) => {
            const matchedDb = browseCats.find(
              (c) =>
                c.id === s.category_id ||
                c.name.trim().toLowerCase() === s.name.trim().toLowerCase() ||
                c.slug === s.slug
            );
            return {
              id: matchedDb ? matchedDb.id : s.category_id,
              name: matchedDb ? matchedDb.name : s.name,
              slug: matchedDb ? matchedDb.slug : s.slug,
              match_reason: s.reason,
              source: 'ai' as const,
            };
          }),
          proposed_new_category: aiRes.proposed_new_category || null,
          usedFallback: false,
        };
      }
      // If AI returned 0 existing matches, also check DB fuzzy matches before relying solely on proposed_new_category
      const dbSuggestions = await this.suggestCategoriesForGig(title, description);
      return {
        suggestions: dbSuggestions,
        proposed_new_category: aiRes.proposed_new_category || null,
        usedFallback: dbSuggestions.length > 0,
      };
    } catch {
      const dbSuggestions = await this.suggestCategoriesForGig(title, description);
      return {
        suggestions: dbSuggestions,
        proposed_new_category: null,
        usedFallback: true,
      };
    }
  },

  async findSimilarCategories(query: string): Promise<SimilarCategory[]> {
    const { data, error } = await supabase.rpc('find_similar_categories', {
      p_query: query || '',
    });
    if (error) throw error;
    return ((data as any[]) || []).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      slug: String(row.slug),
      similarity_score: Number(row.similarity_score || 0),
    }));
  },

  async getBrowseCategories(): Promise<Category[]> {
    const { data, error } = await supabase.rpc('get_browse_categories');
    if (error) throw error;
    return ((data as any[]) || []).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      slug: String(row.slug),
      is_active: Boolean(row.is_active),
      created_at: String(row.created_at || ''),
    }));
  },

  async publishGig(gigId: string, requestId?: string): Promise<void> {
    return runOnce(
      `publish_gig:${gigId}`,
      async (reqId) => {
        const baseArgs = { p_gig_id: gigId };
        let { error } = await supabase.rpc('publish_gig', {
          ...baseArgs,
          p_request_id: reqId,
        });
        if (error && error.code === 'PGRST202') {
          ({ error } = await supabase.rpc('publish_gig', baseArgs));
        }

        if (error) throw error;
      },
      { requestId }
    );
  },

  async cancelGig(gigId: string, reason: string, requestId?: string): Promise<void> {
    return runOnce(
      `cancel_gig:${gigId}`,
      async (reqId) => {
        const baseArgs = {
          p_gig_id: gigId,
          p_reason: reason,
        };
        let { error } = await supabase.rpc('cancel_gig', {
          ...baseArgs,
          p_request_id: reqId,
        });
        if (error && error.code === 'PGRST202') {
          ({ error } = await supabase.rpc('cancel_gig', baseArgs));
        }

        if (error) throw error;
      },
      { requestId }
    );
  },

  async deleteGig(gigId: string, reason?: string, requestId?: string): Promise<number> {
    return runOnce(
      `delete_gig:${gigId}`,
      async (reqId) => {
        const args = { p_gig_id: gigId, p_reason: reason || null, p_request_id: reqId };
        let { data, error } = await supabase.rpc('delete_gig', args);
        if (error?.code === 'PGRST202') {
          ({ data, error } = await supabase.rpc('delete_gig', {
            p_gig_id: gigId,
            p_reason: reason || null,
          }));
        }
        if (error) throw error;
        return Number((data as any)?.applicants_notified || 0);
      },
      { requestId }
    );
  },
};

