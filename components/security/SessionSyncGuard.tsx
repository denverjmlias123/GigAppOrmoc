import React, { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { Platform } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

export const SessionSyncGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, currentSessionId, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!user) return;

    // 1. Web BroadcastChannel synchronization
    let broadcastChannel: BroadcastChannel | null = null;
    if (Platform.OS === 'web' && typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      broadcastChannel = new BroadcastChannel('gigormoc_auth_sync');
      broadcastChannel.onmessage = (event) => {
        if (event.data?.type === 'LOGOUT' || event.data?.type === 'SESSIONS_REVOKED') {
          signOut();
          router.replace('/(auth)/login');
        }
      };
    }

    // 2. Realtime subscription to public.user_sessions
    const sessionsSubscription = supabase
      .channel(`public:user_sessions:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'user_sessions',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const updatedSession = payload.new as { id: string; is_revoked: boolean };
          if (updatedSession.id === currentSessionId && updatedSession.is_revoked) {
            signOut();
            router.replace('/(auth)/login');
          }
        }
      )
      .subscribe();

    // 3. Realtime subscription to public.profiles (Admin lock / Deactivation)
    const profileSubscription = supabase
      .channel(`public:profiles:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`,
        },
        (payload) => {
          const updatedProfile = payload.new as { is_active: boolean; is_admin_locked: boolean };
          if (updatedProfile.is_admin_locked || !updatedProfile.is_active) {
            signOut();
            router.replace('/(auth)/login');
          }
        }
      )
      .subscribe();

    return () => {
      broadcastChannel?.close();
      supabase.removeChannel(sessionsSubscription);
      supabase.removeChannel(profileSubscription);
    };
  }, [user, currentSessionId, signOut, router]);

  return <>{children}</>;
};
