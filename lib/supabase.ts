import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

const rawUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const rawKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

function resolveSupabaseUrl(url: string): string {
  if (!url) return '';
  if (Platform.OS !== 'web' && (url.includes('127.0.0.1') || url.includes('localhost'))) {
    const hostUri =
      Constants.expoConfig?.hostUri ||
      (Constants as any)?.manifest2?.extra?.expoClient?.hostUri ||
      (Constants as any)?.manifest?.debuggerHost;
    if (hostUri) {
      const hostIp = hostUri.split(':')[0];
      return url.replace(/127\.0\.0\.1|localhost/, hostIp);
    }
  }
  return url;
}

export const supabaseUrl = resolveSupabaseUrl(rawUrl);
const supabaseAnonKey = rawKey;

export const REQUEST_TIMEOUT_MS = 6000;

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  if (typeof navigator !== 'undefined' && (navigator as any).onLine === false) {
    const offlineErr: any = new Error('Network request failed: device is offline');
    offlineErr.code = 'OFFLINE';
    throw offlineErr;
  }

  const controller = new AbortController();
  const existingSignal = init?.signal;
  if (existingSignal) {
    if (existingSignal.aborted) {
      controller.abort();
    } else {
      existingSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  const timer = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError' && !existingSignal?.aborted) {
      const timeoutErr: any = new Error('The request took too long. Please check your connection and try again.');
      timeoutErr.name = 'AbortError';
      timeoutErr.code = 'TIMEOUT';
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    fetch: fetchWithTimeout,
  },
  realtime: {
    heartbeatIntervalMs: 15000,
  },
});

export const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

let refreshSessionInFlight: Promise<boolean> | null = null;
let sessionExpiredHandler: (() => Promise<void> | void) | null = null;

/** Register the app-level cleanup used when Supabase confirms that refresh credentials are invalid. */
export function registerSessionExpiredHandler(cb: (() => Promise<void> | void) | null) {
  sessionExpiredHandler = cb;
}

function isExpiredAuthError(error: any): boolean {
  const message = String(error?.message || '');
  return error?.status === 401 || error?.code === '401' || error?.code === 'PGRST301' ||
    /jwt (?:has )?expired|token is expired/i.test(message);
}

function isTerminalRefreshError(error: any): boolean {
  const status = Number(error?.status);
  const code = String(error?.code || '').toLowerCase();
  return status === 400 || status === 401 || code.includes('refresh_token') || code === 'session_not_found';
}

async function notifySessionExpired(): Promise<void> {
  try {
    await sessionExpiredHandler?.();
  } catch {
    // Expiration cleanup must not replace the original request error.
  }
}

/**
 * Single-flight session refresh: concurrent 401/JWT-expired callers share one refresh request.
 */
export async function refreshSessionSingleFlight(): Promise<boolean> {
  if (refreshSessionInFlight) {
    return refreshSessionInFlight;
  }
  refreshSessionInFlight = (async () => {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session) {
        if (error && isTerminalRefreshError(error)) await notifySessionExpired();
        return false;
      }
      return true;
    } catch (error: any) {
      if (isTerminalRefreshError(error)) await notifySessionExpired();
      return false;
    } finally {
      refreshSessionInFlight = null;
    }
  })();
  return refreshSessionInFlight;
}

/**
 * Ensures the Realtime WebSocket reconnects immediately upon foregrounding,
 * preventing silent channel drops after mobile OS deep sleep transitions.
 */
export function ensureRealtimeConnected(): void {
  try {
    const realtime = (supabase as any)?.realtime;
    if (realtime && typeof realtime.connect === 'function') {
      const isConnected = typeof realtime.isConnected === 'function' ? realtime.isConnected() : false;
      if (!isConnected) {
        realtime.connect();
      } else if (typeof realtime.sendHeartbeat === 'function') {
        void realtime.sendHeartbeat();
      }
    }
  } catch {
    // Non-blocking fallback
  }
}

const preAuthRpcs = new Set([
  'rpc_get_project_inbox_messages',
  'rpc_generate_otp',
  'rpc_verify_otp',
  'rpc_register_and_issue_otp',
  'rpc_check_signup_availability',
  'rpc_pre_auth_check',
  'rpc_verify_captcha',
  'rpc_record_login_failure',
  'rpc_record_login_success',
  'rpc_reset_password_with_otp',
  'rpc_log_underage_attempt',
]);

export interface RpcEnvelope<T = Record<string, any>> {
  ok: boolean;
  code?: string;
  message?: string;
  data?: T;
  [key: string]: any;
}

export async function callRpc<T = RpcEnvelope>(
  fnName: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  try {
    const isPreAuth = preAuthRpcs.has(fnName);
    const clientToUse = isPreAuth ? anonClient : supabase;
    let { data, error } = await clientToUse.rpc(fnName, params);

    // Only refresh and retry with the authenticated client. Falling back to anonClient
    // can never repair an expired user JWT and can hide auth/configuration errors.
    if (!isPreAuth && error && isExpiredAuthError(error)) {
      const refreshed = await refreshSessionSingleFlight();
      if (refreshed) {
        const retry = await supabase.rpc(fnName, params);
        data = retry.data;
        error = retry.error;
      }
    }

    if (error) {
      return {
        ok: false,
        code: error.code || 'RPC_ERROR',
        message: error.message || 'An error occurred while calling the database function.',
      } as unknown as T;
    }

    if (data && typeof data === 'object') {
      return data as T;
    }

    return {
      ok: true,
      data,
    } as unknown as T;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown network or execution exception';
    return {
      ok: false,
      code: 'CLIENT_EXCEPTION',
      message,
    } as unknown as T;
  }
}
