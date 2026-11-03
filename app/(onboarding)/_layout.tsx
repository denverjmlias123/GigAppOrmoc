import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { ScreenBackground } from '../../components/ui/ScreenBackground';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { offlineSyncService } from '../../services/offlineSync';

export default function OnboardingLayout() {
  const { user, profile, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    // 1. If not authenticated, verify with storage before bouncing to prevent flashing welcome during auth transitions
    if (!user) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session?.user) {
          router.replace('/(auth)/welcome');
        }
      }).catch(() => {
        router.replace('/(auth)/welcome');
      });
      return;
    }

    // 2. If onboarding is already completed AND mode is selected, bounce to tabs (unless actively viewing step1-mode)
    const inStep1 = (segments as string[]).includes('step1-mode');
    if (profile?.onboarding_complete && profile?.active_mode && !inStep1) {
      router.replace('/(tabs)');
      return;
    }

    // 3. Sequential sub-guard: Step 2 and Step 3 require active_mode to be selected
    const inStep2Or3 = (segments as string[]).includes('step2-skills') || (segments as string[]).includes('step3-profile');
    if (!profile?.active_mode && inStep2Or3) {
      offlineSyncService.getCachedProfile().then((cached) => {
        if (!cached?.active_mode) {
          router.replace('/(onboarding)/step1-mode');
        }
      }).catch(() => {
        router.replace('/(onboarding)/step1-mode');
      });
    }
  }, [user, profile, loading, segments, router]);

  return (
    <ScreenBackground style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: 'transparent' },
          animation: 'slide_from_right',
        }}
      />
    </ScreenBackground>
  );
}


