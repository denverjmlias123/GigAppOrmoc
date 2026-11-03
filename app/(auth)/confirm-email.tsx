import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { authService, RESEND_CONFIRMATION_COOLDOWN_SECONDS } from '../../services/auth';
import { supabase } from '../../lib/supabase';
import { toAppError } from '../../lib/errors';
import { Button, IconButton } from '../../components/ui/Button';
import { Card, AlertBox } from '../../components/ui/Card';
import { OtpInput } from '../../components/ui/OtpInput';
import { showToast } from '../../components/ui/Toast';
import { strings } from '../../constants/strings';
import { useAuth } from '../../hooks/useAuth';

export default function ConfirmEmailScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { isWide, topSpace, bottomSpace } = useResponsiveLayout();
  const { refreshProfile } = useAuth();
  const params = useLocalSearchParams<{ email?: string }>();
  const [resending, setResending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [otp, setOtp] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const inFlightRef = useRef(false);

  const entranceAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(entranceAnim, {
      toValue: 1,
      duration: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.06,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [entranceAnim, pulseAnim]);

  const triggerShake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(shakeAnim, { toValue: -6, duration: 50, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(shakeAnim, { toValue: 6, duration: 50, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: Platform.OS !== 'web' }),
    ]).start();
  };

  useEffect(() => {
    let mounted = true;
    const targetEmail = (params.email || '').trim().toLowerCase();

    // Check if the current session actually matches the email being confirmed and is confirmed
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted || !session?.user) return;
      const sessionEmail = (session.user.email || '').trim().toLowerCase();
      // If a lingering session belongs to a different user, clear it so it doesn't hijack the flow
      if (targetEmail && sessionEmail !== targetEmail) {
        supabase.auth.signOut({ scope: 'local' }).catch(() => {});
        return;
      }
      // Only auto-advance if THIS email was already confirmed (e.g. via email link in another tab)
      if (sessionEmail === targetEmail && Boolean(session.user.email_confirmed_at)) {
        await authService.updateProfile(session.user.id, { onboarding_complete: false }).catch(() => {});
        await refreshProfile(session.user);
        router.replace('/(onboarding)/step1-mode');
      }
    }).catch(() => undefined);

    // If the confirmation link was clicked in a browser or deep-linked in the same app instance,
    // Supabase will automatically receive the session and update the user state.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (inFlightRef.current || !session?.user) return;
      const sessionEmail = (session.user.email || '').trim().toLowerCase();
      if (targetEmail && sessionEmail === targetEmail && Boolean(session.user.email_confirmed_at)) {
        await authService.updateProfile(session.user.id, { onboarding_complete: false }).catch(() => {});
        await refreshProfile(session.user);
        router.replace('/(onboarding)/step1-mode');
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [params.email, router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((current) => (current <= 1 ? 0 : current - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleVerifyOtp = async (codeToVerify?: string) => {
    const code = (codeToVerify ?? otp).trim();
    if (verifying || inFlightRef.current || !params.email) return;
    setErrorMessage(null);
    setStatusMessage(null);
    if (!code || code.length < 6) {
      setErrorMessage(strings.auth.otpCodeLength);
      triggerShake();
      return;
    }

    inFlightRef.current = true;
    setVerifying(true);
    try {
      const authResult = await authService.verifySignupOtp(params.email, code);
      const sessionUser = authResult?.session?.user || authResult?.user;
      if (sessionUser?.id) {
        await authService.updateProfile(sessionUser.id, { onboarding_complete: false }).catch(() => {});
      }
      await refreshProfile(sessionUser || undefined);
      showToast(strings.auth.otpConfirmedSuccess, 'success');
      router.replace('/(onboarding)/step1-mode');
    } catch (err: any) {
      triggerShake();
      setErrorMessage(toAppError(err, strings.auth.otpInvalidOrExpired).message);
    } finally {
      inFlightRef.current = false;
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    if (!params.email || resending || cooldown > 0) return;
    setStatusMessage(null);
    setErrorMessage(null);
    setResending(true);
    try {
      await authService.resendConfirmationEmail(params.email);
      setCooldown(RESEND_CONFIRMATION_COOLDOWN_SECONDS);
      setStatusMessage('A fresh confirmation email has been sent. Please check your inbox and spam folder.');
    } catch (err: any) {
      const appErr = toAppError(err);
      if (err?.retryAfterSeconds) {
        setCooldown(err.retryAfterSeconds);
      }
      setErrorMessage(appErr.message);
    } finally {
      setResending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: isWide ? 48 : topSpace + 12, paddingBottom: isWide ? 48 : bottomSpace + 16 },
          isWide && styles.scrollContentWide,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View
          style={[
            styles.animatedCardWrapper,
            isWide && styles.animatedCardWrapperWide,
            {
              opacity: entranceAnim,
              transform: [
                {
                  translateY: entranceAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [18, 0],
                  }),
                },
                { translateX: shakeAnim },
              ],
            },
          ]}
        >
          <View style={[styles.card, isWide && styles.cardWide, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <View style={styles.cardTopAccentBar} />

            <View style={styles.headerTopRow}>
              <IconButton
                icon="arrow-back"
                variant="secondary"
                size="sm"
                onPress={() => {
                  if (router.canGoBack()) {
                    router.back();
                  } else {
                    router.replace('/(auth)/login');
                  }
                }}
                accessibilityLabel="Back to Login"
              />
              <View style={[styles.accessBadge, { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.border }]}>
                <Ionicons name="mail-unread-outline" size={13} color={theme.colors.primary} />
                <Text style={[styles.accessBadgeText, { color: theme.colors.primary }]}>Email Confirmation</Text>
              </View>
            </View>

            <View style={styles.content}>
              <Animated.View style={[styles.iconCircle, { backgroundColor: theme.colors.primarySoft, transform: [{ scale: pulseAnim }] }]}>
                <Ionicons name="mail-unread-outline" size={32} color={theme.colors.primary} />
              </Animated.View>
              <Text style={[styles.title, { color: theme.colors.text }]}>Confirm Your Email</Text>
              <Text style={[styles.description, { color: theme.colors.muted }]}>
                We have sent a verification code to:
              </Text>
              <View style={[styles.emailPill, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border }]}>
                <Ionicons name="mail" size={14} color={theme.colors.primary} />
                <Text style={[styles.emailHighlight, { color: theme.colors.primary }]}>
                  {params.email || 'your email address'}
                </Text>
              </View>
              <Text style={[styles.instructions, { color: theme.colors.muted }]}>
                Check your inbox and enter the confirmation code below, or tap the link in the email.
              </Text>

              <View style={{ width: '100%', marginVertical: 14 }}>
                <OtpInput
                  value={otp}
                  length={8}
                  onChangeText={(val) => {
                    setOtp(val);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  onComplete={handleVerifyOtp}
                  disabled={verifying}
                  label={strings.auth.otpCodeLabel}
                />
                <Button
                  title={verifying ? strings.auth.otpVerifying : strings.auth.otpVerifyButton}
                  icon="checkmark-circle-outline"
                  onPress={() => handleVerifyOtp()}
                  loading={verifying}
                  disabled={verifying || otp.length < 6}
                  fullWidth
                  style={{ marginTop: 12 }}
                />
              </View>

              {statusMessage && (
                <AlertBox
                  tone="success"
                  message={statusMessage}
                  style={{ marginTop: 12, width: '100%' }}
                />
              )}

              {errorMessage && (
                <AlertBox
                  tone="danger"
                  message={errorMessage}
                  style={{ marginTop: 12, width: '100%' }}
                />
              )}

              <View style={[styles.helpBox, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border }]}>
                <Ionicons name="help-circle-outline" size={16} color={theme.colors.muted} />
                <Text style={[styles.helpText, { color: theme.colors.muted }]}>
                  Didn't see the email? Check your Spam or Promotions folder. It may take up to a minute to arrive.
                </Text>
              </View>
            </View>

            <View style={styles.footer}>
              {params.email ? (
                <Button
                  title={resending ? 'Sending...' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend Confirmation Email'}
                  variant="secondary"
                  icon="refresh-outline"
                  onPress={handleResend}
                  loading={resending}
                  disabled={resending || cooldown > 0}
                  fullWidth
                  style={{ marginBottom: 12 }}
                />
              ) : null}
              <Button
                title="I've confirmed my email → Log In"
                variant="ghost"
                icon="log-in-outline"
                onPress={() =>
                  router.replace({
                    pathname: '/(auth)/login',
                    params: params.email ? { email: params.email } : undefined,
                  })
                }
                fullWidth
              />
            </View>
          </View>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  scrollContentWide: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  animatedCardWrapper: {
    width: '100%',
    alignSelf: 'center',
  },
  animatedCardWrapperWide: {
    maxWidth: 480,
  },
  card: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    borderRadius: 22,
    padding: 24,
    gap: 20,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    ...(Platform.OS === 'web'
      ? ({
          boxShadow: '0 20px 40px -15px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(226, 232, 240, 0.85)',
        } as any)
      : {
          shadowColor: '#0F172A',
          shadowOffset: { width: 0, height: 12 },
          shadowOpacity: 0.08,
          shadowRadius: 24,
          elevation: 8,
        }),
  },
  cardWide: {
    padding: 38,
    gap: 24,
  },
  cardTopAccentBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: '#2563EB',
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  accessBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 9999,
    borderWidth: 1,
  },
  accessBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  content: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 8,
    textAlign: 'center',
  },
  description: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 8,
  },
  emailPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 14,
  },
  emailHighlight: {
    fontSize: 14,
    fontWeight: '700',
  },
  instructions: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  helpBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 12,
    width: '100%',
  },
  helpText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  footer: {
    width: '100%',
  },
});
