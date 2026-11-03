import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase, callRpc } from '../lib/supabase';
import { Session, User } from '@supabase/supabase-js';
import { Platform } from 'react-native';

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  display_name: string;
  date_of_birth: string;
  phone?: string | null;
  active_mode: 'freelancer' | 'client';
  last_mode_switch_at?: string | null;
  email_verified: boolean;
  onboarding_completed: boolean;
  onboarding_step: number;
  is_active: boolean;
  is_admin_locked: boolean;
  verification_status: 'unsubmitted' | 'pending' | 'update_requested' | 'verified' | 'rejected';
  legitimacy_score: number;
  verification_notes?: string | null;
  area_barangay?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  client_type?: 'individual' | 'business' | null;
  business_name?: string | null;
  hiring_interests?: string[] | null;
  freelancer_rating_avg: number;
  freelancer_review_count: number;
  client_rating_avg: number;
  client_review_count: number;
  created_at: string;
  updated_at: string;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  adminRole: 'admin' | 'super_admin' | null;
  currentSessionId: string | null;
  activeInboxEmail: string | null;
  activeChallengeId: string | null;
  isLoading: boolean;
  profileError: string | null;
  setActiveInboxContext: (email: string | null, challengeId: string | null) => void;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  adminRole: null,
  currentSessionId: null,
  activeInboxEmail: null,
  activeChallengeId: null,
  isLoading: true,
  profileError: null,
  setActiveInboxContext: () => {},
  refreshProfile: async () => {},
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
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
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  const fetchProfileAndAdmin = useCallback(async (userId: string) => {
    try {
      setProfileError(null);
      // 1. Fetch profile
      const { data: profileData, error: profileErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (profileErr) {
        console.warn('Error fetching profile:', profileErr.message);
        setProfileError(profileErr.message);
        setProfile(null);
      } else if (profileData) {
        setProfile(profileData as UserProfile);
        setActiveInboxEmail(profileData.email);
        setProfileError(null);
      } else {
        console.warn('Stale session detected: user has no matching profile row. Clearing auth session.');
        setProfile(null);
        setProfileError('Profile not found.');
        await supabase.auth.signOut();
        setSession(null);
        setUser(null);
        setCurrentSessionId(null);
      }

      // 2. Fetch admin role
      const { data: adminData } = await supabase
        .from('platform_admins')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle();

      if (adminData && (adminData.role === 'admin' || adminData.role === 'super_admin')) {
        setAdminRole(adminData.role);
      } else {
        setAdminRole(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error loading profile';
      console.warn('Error fetching profile:', err);
      setProfileError(msg);
    }
  }, []);

  const registerCurrentSession = useCallback(async (userId: string) => {
    try {
      const deviceInfo = `${Platform.OS} ${Platform.Version || ''}`;
      const res = await callRpc<{ ok: boolean; session_id?: string }>('rpc_register_session', {
        p_session_token_fingerprint: `device_${Date.now()}`,
        p_device_info: deviceInfo,
        p_ip_address: '127.0.0.1',
      });

      if (res.ok && res.session_id) {
        setCurrentSessionId(res.session_id);
      }
    } catch (err) {
      console.warn('Error registering session:', err);
    }
  }, []);

  useEffect(() => {
    // Initial session load
    supabase.auth.getSession().then(async ({ data: { session: initialSession } }) => {
      setSession(initialSession);
      setUser(initialSession?.user ?? null);
      if (initialSession?.user) {
        await fetchProfileAndAdmin(initialSession.user.id);
        await registerCurrentSession(initialSession.user.id);
      }
      setIsLoading(false);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);

        if (newSession?.user) {
          await fetchProfileAndAdmin(newSession.user.id);
          if (!currentSessionId) {
            await registerCurrentSession(newSession.user.id);
          }
        } else {
          setProfile(null);
          setAdminRole(null);
          setCurrentSessionId(null);
        }
        setIsLoading(false);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [fetchProfileAndAdmin, registerCurrentSession, currentSessionId]);

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

  const refreshProfile = async () => {
    if (user?.id) {
      await fetchProfileAndAdmin(user.id);
    }
  };

  const signOut = async () => {
    if (currentSessionId) {
      await callRpc('rpc_revoke_session', {
        p_session_id: currentSessionId,
        p_revoke_all_others: false,
      });
    }
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setProfile(null);
    setAdminRole(null);
    setCurrentSessionId(null);
    setActiveInboxEmail(null);
    setActiveChallengeId(null);
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem('gigormoc_inbox_email');
      window.localStorage.removeItem('gigormoc_inbox_challenge');
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile,
        adminRole,
        currentSessionId,
        activeInboxEmail,
        activeChallengeId,
        isLoading,
        profileError,
        setActiveInboxContext,
        refreshProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
