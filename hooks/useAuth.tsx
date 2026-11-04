import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { Platform } from 'react-native';
import { Session, User } from '@supabase/supabase-js';
import { supabase, registerSessionExpiredHandler } from '../lib/supabase';
import { performSharedCleanup } from '../lib/sessionCleanup';
import { authService, Profile } from '../services/auth';
import { strings } from '../constants/strings';
import { sessionService } from '../services/sessions';
import { offlineSyncService } from '../services/offlineSync';
import { clearAdminCache, adminService } from '../services/admin';

export type UserProfile = Profile;

interface SignOutOptions {
  scope?: 'local' | 'global';
  reason?: 'user' | 'session_expired';
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  isLoading: boolean;
  isOffline: boolean;
  adminRole: 'admin' | 'super_admin' | null;
  currentSessionId: string | null;
  activeInboxEmail: string | null;
  activeChallengeId: string | null;
  authNotice: string | null;
  profileError: string | null;
  setActiveInboxContext: (email: string | null, challengeId: string | null) => void;
  clearAuthNotice: () => void;
  refreshProfile: (explicitUserOrId?: User | string) => Promise<Profile | null>;
  signOut: (options?: SignOutOptions) => Promise<void>;
  runSharedCleanup: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  profile: null,
  loading: true,
  isLoading: true,
  isOffline: false,
  adminRole: null,
  currentSessionId: null,
  activeInboxEmail: null,
  activeChallengeId: null,
  authNotice: null,
  profileError: null,
  setActiveInboxContext: () => {},
  clearAuthNotice: () => {},
  refreshProfile: async (_explicitUserOrId?: User | string) => null,
  signOut: async () => {},
  runSharedCleanup: async () => {},
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [adminRole, setAdminRole] = useState<'admin' | 'super_admin' | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [activeInboxEmail, setActiveInboxEmail] = useState<string | null>(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem('gigormoc_inbox_email') || null;
    }
    return null;
  });
  const [activeChallengeId, setActiveChallengeId] = useState<string | null>(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem('gigormoc_inbox_challenge') || null;
    }
    return null;
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [isOffline, setIsOffline] = useState<boolean>(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const signOutInFlightRef = useRef<Promise<void> | null>(null);
  const hadActiveSessionRef = useRef<boolean>(false);
  const handledSignedOutRef = useRef<boolean>(false);

  const clearAuthNotice = () => setAuthNotice(null);

  const runSharedCleanup = async () => {
    try {
      await supabase.removeAllChannels();
    } catch {
      // Ignore
    }
    await performSharedCleanup({ clearAuthStorage: false });
  };

  const clearAuth = async (options?: SignOutOptions) => {
    if (signOutInFlightRef.current) {
      return signOutInFlightRef.current;
    }

    signOutInFlightRef.current = (async () => {
      try {
        handledSignedOutRef.current = true;
        try {
          await authService.signOut({ scope: options?.scope ?? 'local' });
        } catch {
          // Ignore
        }
        await performSharedCleanup({ clearAuthStorage: true });
        clearAdminCache();

        setUser(null);
        setSession(null);
        setProfile(null);
        setAdminRole(null);
        setCurrentSessionId(null);

        if (options?.reason === 'session_expired') {
          setAuthNotice(strings.errors.sessionExpired);
        } else if (hadActiveSessionRef.current) {
          setAuthNotice(strings.errors.loggedOutNotice);
        }
        hadActiveSessionRef.current = false;

        // Broadcast cross-tab logout to close all other open tabs immediately (IAS Requirement E)
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          try {
            localStorage.setItem('gigormoc:cross_tab_logout', String(Date.now()));
            if (typeof BroadcastChannel !== 'undefined') {
              const bc = new BroadcastChannel('gigormoc_auth_channel');
              bc.postMessage('LOGOUT');
              bc.close();
            }
          } catch {}
        }
      } finally {
        signOutInFlightRef.current = null;
      }
    })();

    return signOutInFlightRef.current;
  };

  const syncUserState = async (currentSession: Session | null) => {
    if (!currentSession?.user) {
      setUser(null);
      setProfile(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    // Attempt to load from offline cache first to avoid screen flicker / delays
    const cached = await offlineSyncService.getCachedProfile();
    if (cached && cached.id === currentSession.user.id) {
      setUser(currentSession.user);
      setProfile(cached);
      hadActiveSessionRef.current = true;
    }

    try {
      // 1. Verify user with Supabase server (in case user was deleted in Supabase)
      const { data: userData, error: userError } = await supabase.auth.getUser();

      const isNetworkIssue =
        userError?.message?.toLowerCase().includes('network') ||
        userError?.message?.toLowerCase().includes('fetch') ||
        userError?.message?.toLowerCase().includes('timeout') ||
        userError?.code === 'OFFLINE' ||
        userError?.code === 'TIMEOUT';

      if (userError && !isNetworkIssue) {
        await clearAuth({ reason: 'session_expired' });
        setLoading(false);
        return;
      }

      if (isNetworkIssue) {
        setIsOffline(true);
        offlineSyncService.setKnownOffline(true);
        if (cached) {
          setUser(currentSession.user);
          setProfile(cached);
          hadActiveSessionRef.current = true;
          setLoading(false);
          return;
        }
      }

      const activeUserId = userData?.user?.id || currentSession.user.id;

      // 2. Fetch profile from database
      const p = await authService.getCurrentProfile(activeUserId);
      if (!p) {
        // If profile fetch failed due to offline/network, use cached if available
        if (cached) {
          setIsOffline(true);
          setUser(currentSession.user);
          setProfile(cached);
          hadActiveSessionRef.current = true;
          setLoading(false);
          return;
        }
        await clearAuth({ reason: 'user' });
        setLoading(false);
        return;
      }

      if (p.status === 'suspended' || p.status === 'deactivated' || p.status === 'deleted') {
        await clearAuth({ reason: 'user' });
        setAuthNotice(strings.errors.accountSuspended);
        setLoading(false);
        return;
      }

      try {
        await sessionService.ensureCurrentSession();
        await sessionService.noteActivity(true);
      } catch {
        // Network failure during session check should not kill offline session
      }

      // Update cache
      await offlineSyncService.cacheProfile(p);
      setIsOffline(false);
      offlineSyncService.setKnownOffline(false);

      hadActiveSessionRef.current = true;
      handledSignedOutRef.current = false;
      setUser(userData?.user || currentSession.user);
      setSession(currentSession);
      setProfile(p);

      sessionService.getCurrentSessionId().then((sId) => {
        if (sId) setCurrentSessionId(sId);
      }).catch(() => {});

      adminService.isSuperAdmin().then((isSuper) => {
        if (isSuper) {
          setAdminRole('super_admin');
        } else {
          adminService.isAdmin().then((isAdmin) => {
            setAdminRole(isAdmin ? 'admin' : null);
          }).catch(() => setAdminRole(null));
        }
      }).catch(() => setAdminRole(null));

      // Trigger background sync of any pending actions
      void offlineSyncService.syncPendingActions().catch(() => {});
    } catch (err: any) {
      const isAuthError =
        err?.status === 401 ||
        err?.status === 403 ||
        err?.code === 'PGRST301' ||
        err?.message?.toLowerCase().includes('jwt') ||
        err?.message?.toLowerCase().includes('sub claim') ||
        err?.message?.toLowerCase().includes('user not found');

      const isNetworkIssue =
        err?.code === 'OFFLINE' ||
        err?.code === 'TIMEOUT' ||
        err?.name === 'AbortError' ||
        err?.message?.toLowerCase().includes('network') ||
        err?.message?.toLowerCase().includes('offline') ||
        err?.message?.toLowerCase().includes('fetch');

      if (isAuthError) {
        await clearAuth({ reason: 'session_expired' });
      } else if (isNetworkIssue) {
        setIsOffline(true);
        offlineSyncService.setKnownOffline(true);
        if (cached) {
          setUser(currentSession.user);
          setProfile(cached);
          hadActiveSessionRef.current = true;
        }
      } else {
        setProfile(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    registerSessionExpiredHandler(async () => {
      if (!mounted) return;
      await clearAuth({ reason: 'session_expired' });
    });

    // Check initial session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!mounted) return;
      syncUserState(s);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, s) => {
      if (!mounted) return;
      if (event === 'SIGNED_OUT' || !s) {
        if (!handledSignedOutRef.current && hadActiveSessionRef.current) {
          handledSignedOutRef.current = true;
          hadActiveSessionRef.current = false;
          await performSharedCleanup({ clearAuthStorage: true });
          setAuthNotice(strings.errors.loggedOutNotice);
        }
        setUser(null);
        setSession(null);
        setProfile(null);
        setAdminRole(null);
        setCurrentSessionId(null);
        setLoading(false);
      } else {
        await syncUserState(s);
      }
    });

    // Cross-tab logout listener on Web (IAS Requirement E: Logging out in one tab logs out all open tabs)
    let bc: any = null;
    let onStorage: ((e: StorageEvent) => void) | null = null;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      onStorage = (e: StorageEvent) => {
        if (!mounted) return;
        if (e.key === 'gigormoc:cross_tab_logout' || (e.key && e.key.includes('auth-token') && !e.newValue)) {
          void clearAuth({ reason: 'user' });
        }
      };
      window.addEventListener('storage', onStorage);

      if (typeof BroadcastChannel !== 'undefined') {
        try {
          bc = new BroadcastChannel('gigormoc_auth_channel');
          bc.onmessage = (msg: MessageEvent) => {
            if (!mounted) return;
            if (msg.data === 'LOGOUT') {
              void clearAuth({ reason: 'user' });
            }
          };
        } catch {}
      }
    }

    return () => {
      mounted = false;
      registerSessionExpiredHandler(null);
      subscription.unsubscribe();
      if (onStorage && typeof window !== 'undefined') {
        window.removeEventListener('storage', onStorage);
      }
      if (bc) {
        try { bc.close(); } catch {}
      }
    };
  }, []);

  const refreshProfile = async (explicitUserOrId?: User | string): Promise<Profile | null> => {
    let activeUserId = typeof explicitUserOrId === 'string' ? explicitUserOrId : explicitUserOrId?.id || user?.id;
    if (typeof explicitUserOrId === 'object' && explicitUserOrId) {
      setUser(explicitUserOrId);
    } else if (!user) {
      const { data: { session: s } } = await supabase.auth.getSession();
      if (s?.user) {
        setUser(s.user);
        if (!activeUserId) activeUserId = s.user.id;
      }
    }
    if (!activeUserId) {
      return null;
    }
    try {
      const p = await authService.getCurrentProfile(activeUserId);
      if (!p) {
        const cached = await offlineSyncService.getCachedProfile();
        if (cached) return cached;
        return null;
      }
      await offlineSyncService.cacheProfile(p);
      setProfile(p);
      return p;
    } catch (err: any) {
      const isNetworkIssue =
        err?.code === 'OFFLINE' ||
        err?.code === 'TIMEOUT' ||
        err?.name === 'AbortError' ||
        err?.message?.toLowerCase().includes('network') ||
        err?.message?.toLowerCase().includes('fetch');

      if (isNetworkIssue) {
        setIsOffline(true);
        const cached = await offlineSyncService.getCachedProfile();
        if (cached) {
          setProfile(cached);
          return cached;
        }
      }

      const isAuthError =
        err?.status === 401 ||
        err?.status === 403 ||
        err?.code === 'PGRST301' ||
        err?.message?.toLowerCase().includes('jwt') ||
        err?.message?.toLowerCase().includes('sub claim') ||
        err?.message?.toLowerCase().includes('user not found');
      if (isAuthError) {
        await clearAuth({ reason: 'session_expired' });
      }
      return null;
    }
  };

  const setActiveInboxContext = (email: string | null, challengeId: string | null) => {
    setActiveInboxEmail(email);
    setActiveChallengeId(challengeId);
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      if (email) {
        window.localStorage.setItem('gigormoc_inbox_email', email);
      } else {
        window.localStorage.removeItem('gigormoc_inbox_email');
      }
      if (challengeId) {
        window.localStorage.setItem('gigormoc_inbox_challenge', challengeId);
      } else {
        window.localStorage.removeItem('gigormoc_inbox_challenge');
      }
    }
  };

  const signOut = async (options?: SignOutOptions) => {
    await clearAuth(options);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        loading,
        isLoading: loading,
        isOffline,
        adminRole,
        currentSessionId,
        activeInboxEmail,
        activeChallengeId,
        authNotice,
        profileError,
        setActiveInboxContext,
        clearAuthNotice,
        refreshProfile,
        signOut,
        runSharedCleanup,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
