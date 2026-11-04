import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { View, ActivityIndicator, StyleSheet, AppState, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider, useAppTheme } from './theme';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { OfflineBanner } from '../components/ui/OfflineBanner';
import { ToastProvider } from '../components/ui/Toast';
import { ConfirmDialogProvider } from '../components/ui/ConfirmDialog';
import { SessionTimeoutModal } from '../components/ui/SessionTimeoutModal';
import { ProjectMailInbox } from '../components/security/ProjectMailInbox';
import { sessionService } from '../services/sessions';
import { ensureRealtimeConnected } from '../lib/supabase';
import { adminService } from '../services/admin';

function RootNavigation() {
  const { user, profile, loading, isOffline, signOut } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const theme = useAppTheme();
  const [sessionWarningVisible, setSessionWarningVisible] = React.useState(false);
  const [warningSecondsRemaining, setWarningSecondsRemaining] = React.useState(60);

  useEffect(() => {
    if (loading) return;

    const segList = segments as string[];
    const inAuthGroup = segList[0] === '(auth)';
    const inOnboardingGroup = segList[0] === '(onboarding)';
    const inAdminGroup = segList[0] === 'admin';
    const inPasswordReset = inAuthGroup && segList.includes('forgot-password');
    const inConfirmEmail = inAuthGroup && segList.includes('confirm-email');
    const inVerifyOtp = inAuthGroup && segList.includes('verify-otp');
    const inSignUp = inAuthGroup && (segList.includes('signup-step1') || segList.includes('signup-step2'));

    // Recovery links, OTP verification, and sign up handle their own direct transitions; do not hijack them
    if (inPasswordReset || inConfirmEmail || inVerifyOtp || inSignUp) return;

    if (!user) {
      // User is not authenticated -> route to welcome if trying to access tabs or onboarding
      if (!inAuthGroup) {
        router.replace('/(auth)/welcome');
      }
    } else if (!profile) {
      // User session exists locally but profile was deleted or is missing, only force logout if strictly online and not onboarding
      if (!inAuthGroup && !inOnboardingGroup && !isOffline) {
        signOut().catch(() => {});
        router.replace('/(auth)/welcome');
      }
    } else {
      // User is authenticated and profile exists
      if (profile.must_change_password) {
        if (segList[0] !== 'settings' || !segList.includes('password')) router.replace('/settings/password');
      } else {
        adminService.isSuperAdmin().then((isSuper) => {
          if (isSuper) {
            if (!inAdminGroup) {
              router.replace('/admin/dashboard');
            }
          } else if (profile.email_verified === false && !profile.onboarding_complete) {
            if (!inVerifyOtp && !inConfirmEmail) {
              router.replace({
                pathname: '/(auth)/verify-otp',
                params: { userId: user.id, email: user.email },
              });
            }
          } else if (!profile.active_mode || !profile.onboarding_complete) {
            if (!inOnboardingGroup) {
              router.replace('/(onboarding)/step1-mode');
            }
          } else {
            const inStep1 = segList.includes('step1-mode');
            if ((inAuthGroup || (inOnboardingGroup && !inStep1)) && !inAdminGroup) {
              router.replace('/(tabs)');
            }
          }
        }).catch(() => {
          if (profile.email_verified === false && !profile.onboarding_complete) {
            if (!inVerifyOtp && !inConfirmEmail) {
              router.replace({
                pathname: '/(auth)/verify-otp',
                params: { userId: user.id, email: user.email },
              });
            }
          } else if (!profile.active_mode || !profile.onboarding_complete) {
            if (!inOnboardingGroup) {
              router.replace('/(onboarding)/step1-mode');
            }
          } else {
            const inStep1 = segList.includes('step1-mode');
            if ((inAuthGroup || (inOnboardingGroup && !inStep1)) && !inAdminGroup) {
              router.replace('/(tabs)');
            }
          }
        });
      }
    }
  }, [user, profile, loading, isOffline, segments]);

  useEffect(() => {
    if (!user?.id || isOffline) {
      setSessionWarningVisible(false);
      return;
    }
    let checking = false;
    let lastHeartbeat = Date.now();

    const checkInactivityAndHeartbeat = async () => {
      if (checking) return;
      checking = true;
      try {
        const remainingMs = await sessionService.getInactivityRemainingMs();
        if (remainingMs <= 0) {
          setSessionWarningVisible(false);
          const active = await sessionService.heartbeat();
          if (!active && !isOffline) {
            await signOut({ reason: 'session_expired' });
          }
        } else if (remainingMs <= 60 * 1000) {
          // IAS 1 Requirement E: Show warning before the session expires
          setWarningSecondsRemaining(Math.max(1, Math.ceil(remainingMs / 1000)));
          setSessionWarningVisible(true);
        } else {
          setSessionWarningVisible(false);
          // Run heartbeat every 2 minutes
          if (Date.now() - lastHeartbeat > 2 * 60 * 1000) {
            lastHeartbeat = Date.now();
            const active = await sessionService.heartbeat();
            if (!active && !isOffline) await signOut({ reason: 'session_expired' });
          }
        }
      } catch {
        // Network failure during session check should not kill offline session
      } finally {
        checking = false;
      }
    };

    const intervalMs = sessionWarningVisible ? 1000 : 10000;
    const timer = setInterval(() => { void checkInactivityAndHeartbeat(); }, intervalMs);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        ensureRealtimeConnected();
        void checkInactivityAndHeartbeat();
      }
    });
    return () => {
      clearInterval(timer);
      appStateSubscription.remove();
    };
  }, [user?.id, isOffline, sessionWarningVisible]);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && user?.id) {
      const onWebActivity = () => {
        void sessionService.noteActivity().catch(() => undefined);
      };
      window.addEventListener('pointerdown', onWebActivity, { passive: true });
      window.addEventListener('keydown', onWebActivity, { passive: true });
      return () => {
        window.removeEventListener('pointerdown', onWebActivity);
        window.removeEventListener('keydown', onWebActivity);
      };
    }
  }, [user?.id]);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes' && mutation.attributeName === 'aria-hidden') {
            const target = mutation.target as HTMLElement;
            if (target && target.getAttribute('aria-hidden') === 'true') {
              const active = document.activeElement as HTMLElement | null;
              if (active && target.contains(active)) {
                active.blur?.();
              }
            }
          }
        }
      });
      observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['aria-hidden'] });
      return () => observer.disconnect();
    }
  }, []);

  const recordSessionActivity = () => {
    if (user?.id) void sessionService.noteActivity().catch(() => undefined);
  };

  const handleExtendSession = async () => {
    await sessionService.extendSession();
    setSessionWarningVisible(false);
  };

  const handleSignOutNow = async () => {
    setSessionWarningVisible(false);
    await signOut({ reason: 'user' });
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.root} onTouchStart={recordSessionActivity}>
      <StatusBar style="dark" />
      <OfflineBanner />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
      <ProjectMailInbox />
      <SessionTimeoutModal
        visible={sessionWarningVisible}
        secondsRemaining={warningSecondsRemaining}
        onExtend={handleExtendSession}
        onSignOut={handleSignOutNow}
      />
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AuthProvider>
          <ThemeProvider>
            <ToastProvider>
              <ConfirmDialogProvider>
                <RootNavigation />
              </ConfirmDialogProvider>
            </ToastProvider>
          </ThemeProvider>
        </AuthProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
