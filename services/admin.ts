import { supabase } from '../lib/supabase';
import { offlineSyncService } from './offlineSync';

export interface BackupRecord {
  id: string;
  created_at: string;
  creator_email: string;
  backup_type: 'scheduled' | 'manual';
  status: 'completed' | 'failed' | 'restored';
  tables_included: string[];
  record_count: number;
  checksum: string;
  restored_at: string | null;
}

export interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  area: string | null;
  active_mode: 'find_work' | 'hire' | null;
  status: string;
  created_at: string;
  last_sign_in_at: string | null;
  freelancer_rating_avg: number;
  freelancer_rating_count: number;
  client_rating_avg: number;
  client_rating_count: number;
  must_change_password: boolean;
  admin_role: 'admin' | 'super_admin' | null;
}


export interface VerificationQueueItem {
  id: string;
  display_name: string;
  email?: string;
  area: string | null;
  active_mode: 'find_work' | 'hire' | null;
  is_legit_verified: boolean;
  verification_status: 'unverified' | 'ai_flagged' | 'approved' | 'rejected';
  ai_legitimacy_score: number;
  ai_legitimacy_report?: any;
  created_at: string;
  verified_at?: string | null;
}

interface AdminUserPage {
  rows: AdminUser[];
  total_count: number;
  page: number;
  page_size: number;
}

export interface AuditFilters {
  user?: string;
  action?: string;
  status?: 'success' | 'failure' | '';
  entity?: string;
  search?: string;
  date_from?: string;
  date_to?: string;
}

export interface AuditEvent {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  status: 'success' | 'failure';
  ip: string | null;
  device: string | null;
  metadata: Record<string, unknown>;
}

interface AuditPage {
  rows: AuditEvent[];
  total_count: number;
  page: number;
  page_size: number;
}

export const adminService = {
  async isAdmin(): Promise<boolean> {
    const { data, error } = await supabase.rpc('is_admin');
    if (error) throw error;
    return data === true;
  },

  async isSuperAdmin(): Promise<boolean> {
    const { data, error } = await supabase.rpc('is_super_admin');
    if (error) throw error;
    return data === true;
  },

  async dashboardMetrics(): Promise<Record<string, any>> {
    const { data, error } = await supabase.rpc('admin_dashboard_metrics');
    if (error) throw error;
    return data || {};
  },

  async listUsers(options: { search?: string; status?: string; mode?: string; page?: number; pageSize?: number }): Promise<AdminUserPage> {
    const { data, error } = await supabase.rpc('admin_list_users', {
      p_search: options.search || null,
      p_status: options.status || null,
      p_mode: options.mode || null,
      p_page: options.page || 1,
      p_page_size: options.pageSize || 25,
    });
    if (error) throw error;
    if (!data || !Array.isArray(data.rows)) throw new Error('Invalid admin user response.');
    return { rows: data.rows as AdminUser[], total_count: Number(data.total_count) || 0,
      page: Number(data.page) || options.page || 1, page_size: Number(data.page_size) || options.pageSize || 25 };
  },

  async userDetail(userId: string): Promise<any> {
    const { data, error } = await supabase.rpc('admin_get_user_detail', { p_user_id: userId });
    if (error) throw error;
    return data;
  },

  async updateUser(input: { userId: string; displayName: string; area: string; status: 'active' | 'suspended' }) {
    const { data, error } = await supabase.rpc('admin_update_user', {
      p_user_id: input.userId, p_display_name: input.displayName, p_area: input.area, p_status: input.status,
    });
    if (error) throw error;
    return data;
  },

  async setAdminRole(userId: string, role: 'user' | 'admin' | 'super_admin') {
    const { data, error } = await supabase.rpc('admin_set_admin_role', { p_user_id: userId, p_role: role });
    if (error) throw error;
    return data;
  },

  async unlockLogin(email: string) {
    const { data, error } = await supabase.rpc('admin_unlock_login', { p_email: email });
    if (error) throw error;
    return data;
  },

  async lockLogin(email: string) {
    const { data, error } = await supabase.rpc('admin_lock_login', { p_email: email });
    if (error) throw error;
    return data;
  },

  async listBackups(): Promise<BackupRecord[]> {
    const { data, error } = await supabase.rpc('admin_list_backups');
    if (error) throw error;
    return Array.isArray(data) ? (data as BackupRecord[]) : [];
  },

  async createBackup(type: 'scheduled' | 'manual' = 'manual'): Promise<{ id: string; record_count: number; created_at: string }> {
    const { data, error } = await supabase.rpc('admin_create_backup', { p_type: type });
    if (error) throw error;
    return data;
  },

  async getBackupSnapshot(backupId: string): Promise<Record<string, unknown>> {
    const { data, error } = await supabase.rpc('admin_get_backup_snapshot', { p_backup_id: backupId });
    if (error) throw error;
    return data;
  },

  async restoreBackup(backupId: string): Promise<{ restored: boolean; record_count: number }> {
    const { data, error } = await supabase.rpc('admin_restore_backup', { p_backup_id: backupId });
    if (error) throw error;
    return data;
  },

  async endSessions(userId: string): Promise<number> {
    const { data, error } = await supabase.rpc('admin_end_user_sessions', { p_user_id: userId });
    if (error) throw error;
    return Number(data) || 0;
  },

  async invokeUserAction<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
    const { data, error } = await supabase.functions.invoke('admin-users', { body });
    if (error) throw error;
    if (data?.error) { const e: any = new Error(String(data.error)); e.code = data.error; throw e; }
    return data as T;
  },

  async getLogTrail(filters: AuditFilters, page = 1, pageSize = 25): Promise<AuditPage> {
    const { data, error } = await supabase.rpc('get_log_trail', {
      p_filters: filters,
      p_page: page,
      p_page_size: pageSize,
    });
    if (error) throw error;
    if (!data || !Array.isArray(data.rows)) throw new Error('Invalid log response.');
    return {
      rows: data.rows as AuditEvent[],
      total_count: Number(data.total_count) || 0,
      page: Number(data.page) || page,
      page_size: Number(data.page_size) || pageSize,
    };
  },

  async exportLogTrail(filters: AuditFilters): Promise<AuditEvent[]> {
    const pageSize = 1000;
    const first = await this.getLogTrail(filters, 1, pageSize);
    if (filters.action?.trim().toLowerCase() === 'log_trail_viewed' && first.total_count > pageSize) {
      throw new Error('EXPORT_ACTION_LIMIT');
    }
    if (first.total_count > 10000) {
      throw new Error('EXPORT_LIMIT');
    }
    const rows = [...first.rows];
    const pages = Math.ceil(first.total_count / pageSize);
    for (let page = 2; page <= pages; page += 1) {
      const result = await this.getLogTrail(filters, page, pageSize);
      rows.push(...result.rows);
    }
    return rows;
  },

  async listVerificationQueue(): Promise<VerificationQueueItem[]> {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name, area, active_mode, is_legit_verified, verification_status, ai_legitimacy_score, ai_legitimacy_report, created_at, verified_at')
        .in('verification_status', ['ai_flagged', 'approved', 'rejected'])
        .order('created_at', { ascending: false });

      if (error) throw error;
      const queue = (data || []) as VerificationQueueItem[];
      await offlineSyncService.cacheVerificationQueue(queue);
      return queue;
    } catch {
      const cached = await offlineSyncService.getCachedVerificationQueue();
      if (cached && cached.length > 0) return cached;
      return [];
    }
  },

  async approveLegitimacyBadge(userId: string, notes?: string): Promise<void> {
    try {
      const { error } = await supabase.rpc('admin_decide_verification', {
        p_user_id: userId,
        p_action: 'approve',
        p_notes: notes || null,
      });

      if (error) throw error;
    } catch (err: any) {
      await offlineSyncService.queueAction('approve_legit_badge', { userId, notes });
    }

    // Update local cache
    const queue = await offlineSyncService.getCachedVerificationQueue();
    const item = queue.find((q: any) => q.id === userId);
    if (item) {
      item.is_legit_verified = true;
      item.verification_status = 'approved';
      item.verified_at = new Date().toISOString();
      await offlineSyncService.cacheVerificationQueue(queue);
    }

    const cachedProfile = await offlineSyncService.getCachedProfile();
    if (cachedProfile && cachedProfile.id === userId) {
      cachedProfile.is_legit_verified = true;
      cachedProfile.verification_status = 'approved';
      await offlineSyncService.cacheProfile(cachedProfile);
    }
  },

  async rejectLegitimacyBadge(userId: string, notes?: string): Promise<void> {
    try {
      const { error } = await supabase.rpc('admin_decide_verification', {
        p_user_id: userId,
        p_action: 'reject',
        p_notes: notes || null,
      });

      if (error) throw error;
    } catch (err: any) {
      await offlineSyncService.queueAction('reject_legit_badge', { userId, notes });
    }

    // Update local cache
    const queue = await offlineSyncService.getCachedVerificationQueue();
    const item = queue.find((q: any) => q.id === userId);
    if (item) {
      item.is_legit_verified = false;
      item.verification_status = 'rejected';
      await offlineSyncService.cacheVerificationQueue(queue);
    }

    const cachedProfile = await offlineSyncService.getCachedProfile();
    if (cachedProfile && cachedProfile.id === userId) {
      cachedProfile.is_legit_verified = false;
      cachedProfile.verification_status = 'rejected';
      await offlineSyncService.cacheProfile(cachedProfile);
    }
  },
};
