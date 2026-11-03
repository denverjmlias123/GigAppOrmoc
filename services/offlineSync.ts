import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

interface PendingAction {
  id: string;
  type:
    | 'submit_application'
    | 'respond_to_application'
    | 'approve_legit_badge'
    | 'reject_legit_badge';
  payload: Record<string, any>;
  requestId?: string;
  createdAt: string;
}

const STORAGE_KEYS = {
  PROFILE: '@offline_profile',
  MY_APPLICATIONS: '@offline_my_applications',
  MY_GIGS: '@offline_my_gigs',
  MY_AGREEMENTS: '@offline_my_agreements',
  GIG_APPLICANTS_PREFIX: '@offline_applicants_',
  VERIFICATION_QUEUE: '@offline_verification_queue',
  PENDING_ACTIONS: '@offline_pending_actions',
};

let isKnownOffline = false;
let actionSequence = 0;

type NetworkStatusListener = (online: boolean) => void;
const networkStatusListeners = new Set<NetworkStatusListener>();

export const subscribeNetworkStatus = (cb: NetworkStatusListener) => {
  networkStatusListeners.add(cb);
  return () => {
    networkStatusListeners.delete(cb);
  };
};

export const broadcastNetworkStatus = (online: boolean) => {
  isKnownOffline = !online;
  networkStatusListeners.forEach((cb) => {
    try {
      cb(online);
    } catch {}
  });
};

export const offlineSyncService = {
  setKnownOffline(offline: boolean) {
    isKnownOffline = offline;
    broadcastNetworkStatus(!offline);
  },
  isOnline(): boolean {
    return !isKnownOffline;
  },

  async cacheItem<T>(key: string, data: T): Promise<void> {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      // Ignore cache write error in low storage conditions
    }
  },

  async getCachedItem<T>(key: string): Promise<T | null> {
    try {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  // Profile caching
  async cacheProfile(profile: any): Promise<void> {
    if (!profile) return;
    await this.cacheItem(STORAGE_KEYS.PROFILE, profile);
  },

  async getCachedProfile(): Promise<any | null> {
    return this.getCachedItem(STORAGE_KEYS.PROFILE);
  },

  // Applications caching
  async cacheMyApplications(apps: any[]): Promise<void> {
    await this.cacheItem(STORAGE_KEYS.MY_APPLICATIONS, apps);
  },

  async getCachedMyApplications(): Promise<any[]> {
    const data = await offlineSyncService.getCachedItem<any[]>(STORAGE_KEYS.MY_APPLICATIONS);
    return data || [];
  },

  // Gig applicants caching
  async cacheGigApplicants(gigId: string, applicants: any[]): Promise<void> {
    await this.cacheItem(`${STORAGE_KEYS.GIG_APPLICANTS_PREFIX}${gigId}`, applicants);
  },

  async getCachedGigApplicants(gigId: string): Promise<any[]> {
    const data = await offlineSyncService.getCachedItem<any[]>(`${STORAGE_KEYS.GIG_APPLICANTS_PREFIX}${gigId}`);
    return data || [];
  },

  // Gigs caching
  async cacheMyGigs(gigs: any[]): Promise<void> {
    await this.cacheItem(STORAGE_KEYS.MY_GIGS, gigs);
  },

  async getCachedMyGigs(): Promise<any[]> {
    const data = await offlineSyncService.getCachedItem<any[]>(STORAGE_KEYS.MY_GIGS);
    return data || [];
  },

  // Agreements caching
  async cacheMyAgreements(agreements: any[]): Promise<void> {
    await this.cacheItem(STORAGE_KEYS.MY_AGREEMENTS, agreements);
  },

  async getCachedMyAgreements(): Promise<any[]> {
    const data = await offlineSyncService.getCachedItem<any[]>(STORAGE_KEYS.MY_AGREEMENTS);
    return data || [];
  },

  // Verification queue caching
  async cacheVerificationQueue(queue: any[]): Promise<void> {
    await this.cacheItem(STORAGE_KEYS.VERIFICATION_QUEUE, queue);
  },

  async getCachedVerificationQueue(): Promise<any[]> {
    const data = await offlineSyncService.getCachedItem<any[]>(STORAGE_KEYS.VERIFICATION_QUEUE);
    return data || [];
  },

  // Pending Actions Queue
  async queueAction(type: PendingAction['type'], payload: Record<string, any>, requestId?: string): Promise<PendingAction> {
    const action: PendingAction = {
      id: `act_${Date.now()}_${++actionSequence}`,
      type,
      payload,
      ...(requestId ? { requestId } : {}),
      createdAt: new Date().toISOString(),
    };

    const current = await this.getPendingActions();
    current.push(action);
    await this.cacheItem(STORAGE_KEYS.PENDING_ACTIONS, current);
    return action;
  },

  async getPendingActions(): Promise<PendingAction[]> {
    const data = await offlineSyncService.getCachedItem<PendingAction[]>(STORAGE_KEYS.PENDING_ACTIONS);
    return data || [];
  },

  async clearPendingAction(id: string): Promise<void> {
    const current = await this.getPendingActions();
    const updated = current.filter((a) => a.id !== id);
    await this.cacheItem(STORAGE_KEYS.PENDING_ACTIONS, updated);
  },

  /**
   * Replays pending actions when connection is restored.
   */
  async syncPendingActions(): Promise<{ synced: number; remaining: number }> {
    const actions = await this.getPendingActions();
    if (actions.length === 0) return { synced: 0, remaining: 0 };

    let synced = 0;
    for (const act of actions) {
      try {
        if (act.type === 'submit_application') {
          await supabase.rpc('submit_application', {
            p_gig_id: act.payload.gigId,
            p_proposed_price: act.payload.proposedPrice,
            p_estimated_days: act.payload.estimatedDays,
            p_message: act.payload.message,
            p_request_id: act.requestId || null,
          });
          await this.clearPendingAction(act.id);
          synced++;
        } else if (act.type === 'respond_to_application') {
          await supabase.rpc('respond_to_application', {
            p_application_id: act.payload.applicationId,
            p_action: act.payload.action,
            p_counter_price: act.payload.counterPrice || null,
            p_request_id: act.requestId || null,
          });
          await this.clearPendingAction(act.id);
          synced++;
        } else if (act.type === 'approve_legit_badge' || act.type === 'reject_legit_badge') {
          await supabase.rpc('admin_decide_verification', {
            p_user_id: act.payload.userId,
            p_action: act.type === 'approve_legit_badge' ? 'approve' : 'reject',
            p_notes: act.payload.notes || null,
          });
          await this.clearPendingAction(act.id);
          synced++;
        }
      } catch (err: any) {
        // If still network failure, break and retry next time
        if (
          err?.code === 'OFFLINE' ||
          err?.code === 'TIMEOUT' ||
          err?.message?.includes('network') ||
          err?.message?.includes('fetch')
        ) {
          isKnownOffline = true;
          break;
        }
        // If server rejected (e.g. duplicate or permission), drop it from queue
        await this.clearPendingAction(act.id);
      }
    }

    const remaining = (await this.getPendingActions()).length;
    return { synced, remaining };
  },

  /**
   * Helper that executes a remote fetch with a fallback to cached data if offline or timeout.
   */
  async withOfflineFallback<T>(
    remoteFn: () => Promise<T>,
    getCachedFn: () => Promise<T>,
    onRemoteSuccess?: (data: T) => Promise<void> | void
  ): Promise<{ data: T; isFromCache: boolean }> {
    // If device is already known to be offline or on degraded signal, serve cache immediately
    // and revalidate in background rather than forcing another 6-second timeout block.
    if (isKnownOffline) {
      const cached = await getCachedFn();
      if (cached !== null && cached !== undefined) {
        void remoteFn()
          .then((res) => {
            isKnownOffline = false;
            broadcastNetworkStatus(true);
            if (onRemoteSuccess) {
              void onRemoteSuccess(res);
            }
          })
          .catch(() => {});
        return { data: cached, isFromCache: true };
      }
    }

    try {
      const result = await remoteFn();
      isKnownOffline = false;
      broadcastNetworkStatus(true);
      if (onRemoteSuccess) {
        try {
          await onRemoteSuccess(result);
        } catch {}
      }
      return { data: result, isFromCache: false };
    } catch (err: any) {
      const isNetworkIssue =
        err?.code === 'OFFLINE' ||
        err?.code === 'TIMEOUT' ||
        err?.name === 'AbortError' ||
        err?.message?.toLowerCase().includes('network') ||
        err?.message?.toLowerCase().includes('offline') ||
        err?.message?.toLowerCase().includes('fetch');

      if (isNetworkIssue) {
        isKnownOffline = true;
        broadcastNetworkStatus(false);
        const cached = await getCachedFn();
        if (cached !== null && cached !== undefined) {
          return { data: cached, isFromCache: true };
        }
      }
      throw err;
    }
  },
};
