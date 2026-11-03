import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { createRequestId } from '../lib/errors';

export const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes per IAS 1 requirement E
export const INACTIVITY_WARNING_MS = 14 * 60 * 1000; // 14 minutes (60 seconds pre-expiry warning)

const SESSION_STORAGE_KEY = 'gigormoc:session:id';
const LAST_ACTIVITY_KEY = 'gigormoc:session:last_activity_at';
let startSessionInFlight: Promise<string> | null = null;
let lastActivityWriteAt = 0;

export interface UserSession {
  id: string;
  user_id: string;
  started_at: string;
  last_seen_at: string;
  ended_at: string | null;
  end_reason: 'logout' | 'expired' | 'revoked' | 'locked' | 'password_changed' | null;
  device_label: string;
  platform: 'ios' | 'android' | 'web' | 'unknown';
}

function platformName(): UserSession['platform'] {
  return Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web'
    ? Platform.OS
    : 'unknown';
}

export const sessionService = {
  async getCurrentSessionId(): Promise<string | null> {
    return AsyncStorage.getItem(SESSION_STORAGE_KEY);
  },

  async startSession(): Promise<string> {
    if (startSessionInFlight) return startSessionInFlight;
    startSessionInFlight = (async () => {
      const { data, error } = await supabase.rpc('start_session', {
        p_device_label: Platform.OS === 'web' ? 'Web browser' : `${Platform.OS} device`,
        p_platform: platformName(),
        p_request_id: createRequestId(),
      });
      if (error) throw error;
      const id = data?.session_id;
      if (typeof id !== 'string') throw new Error('The server did not return a session ID.');
      await AsyncStorage.setItem(SESSION_STORAGE_KEY, id);
      await AsyncStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
      return id;
    })();
    try {
      return await startSessionInFlight;
    } finally {
      startSessionInFlight = null;
    }
  },

  async ensureCurrentSession(): Promise<boolean> {
    const id = await this.getCurrentSessionId();
    if (!id) {
      try {
        await this.startSession();
        return true;
      } catch {
        return false;
      }
    }
    const alive = await this.heartbeat();
    if (!alive) {
      try {
        await this.startSession();
        return true;
      } catch {
        return false;
      }
    }
    return true;
  },

  async noteActivity(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - lastActivityWriteAt < 15000) return;
    lastActivityWriteAt = now;
    await AsyncStorage.setItem(LAST_ACTIVITY_KEY, String(now));
  },

  async extendSession(): Promise<void> {
    await this.noteActivity(true);
  },

  async getInactivityRemainingMs(): Promise<number> {
    const id = await this.getCurrentSessionId();
    if (!id) return INACTIVITY_TIMEOUT_MS;
    const lastActivity = Number(await AsyncStorage.getItem(LAST_ACTIVITY_KEY));
    if (!Number.isFinite(lastActivity) || lastActivity <= 0) {
      await AsyncStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
      return INACTIVITY_TIMEOUT_MS;
    }
    const elapsed = Date.now() - lastActivity;
    return Math.max(0, INACTIVITY_TIMEOUT_MS - elapsed);
  },

  async heartbeat(): Promise<boolean> {
    const id = await this.getCurrentSessionId();
    if (!id) return false;
    const lastActivity = Number(await AsyncStorage.getItem(LAST_ACTIVITY_KEY));
    if (Number.isFinite(lastActivity) && lastActivity > 0 && Date.now() - lastActivity >= INACTIVITY_TIMEOUT_MS) {
      const { error: endError } = await supabase.rpc('end_session', { p_session_id: id, p_reason: 'expired' });
      if (endError) throw endError;
      await AsyncStorage.multiRemove([SESSION_STORAGE_KEY, LAST_ACTIVITY_KEY]);
      return false;
    }
    const { data, error } = await supabase.rpc('heartbeat_session', { p_session_id: id });
    if (error) {
      if (String(error.message || '').includes('session_not_found')) {
        await AsyncStorage.multiRemove([SESSION_STORAGE_KEY, LAST_ACTIVITY_KEY]);
        return false;
      }
      throw error;
    }
    if (data?.active !== true) {
      await AsyncStorage.multiRemove([SESSION_STORAGE_KEY, LAST_ACTIVITY_KEY]);
      return false;
    }
    return true;
  },

  async endCurrentSession(reason: UserSession['end_reason'] = 'logout', explicitId?: string): Promise<void> {
    const id = explicitId ?? await this.getCurrentSessionId();
    if (!id) return;
    try {
      const { error } = await supabase.rpc('end_session', { p_session_id: id, p_reason: reason });
      if (error) throw error;
    } finally {
      await AsyncStorage.multiRemove([SESSION_STORAGE_KEY, LAST_ACTIVITY_KEY]);
    }
  },

  async endOtherSessions(explicitId?: string): Promise<number> {
    const id = explicitId ?? await this.getCurrentSessionId();
    if (!id) throw new Error('This device has no active tracked session. Log in again and retry.');
    const { data, error } = await supabase.rpc('end_other_sessions', { p_current_session_id: id });
    if (error) throw error;
    return Number(data?.ended_count ?? 0);
  },

  async listMySessions(): Promise<UserSession[]> {
    const { data, error } = await supabase.rpc('list_my_sessions');
    if (error) throw error;
    return Array.isArray(data) ? data as UserSession[] : [];
  },
};
