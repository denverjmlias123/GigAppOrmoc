import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Easing,
} from 'react-native';
import { setString } from 'expo-clipboard';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { authService } from '../../services/auth';
import { supabase } from '../../lib/supabase';
import { strings } from '../../constants/strings';
import { OtpInput } from '../../components/ui/OtpInput';
import { Button, IconButton } from '../../components/ui/Button';
import { Card, AlertBox } from '../../components/ui/Card';
import { showToast } from '../../components/ui/Toast';
import { getSignupDraft, clearSignupDraft } from '../../lib/signupDraft';

export default function VerifyOtpScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { isWide, topSpace, bottomSpace } = useResponsiveLayout();
  const params = useLocalSearchParams<{ userId?: string; otpCode?: string; email?: string }>();

  const [resolvedUserId, setResolvedUserId] = useState(params.userId || '');
  const [resolvedEmail, setResolvedEmail] = useState(params.email || '');
  const [generatedCode, setGeneratedCode] = useState(params.otpCode || '');
  const [otp, setOtp] = useState('');
  const [showingCode, setShowingCode] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const inFlightRef = useRef(false);

  useEffect(() => {
    let active = true;
    async function resolveAndGenerate() {
      let uid = resolvedUserId || params.userId || '';
      let em = resolvedEmail || params.email || '';

      if (!uid || !em) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            if (!uid) uid = user.id;
            if (!em) em = user.email || '';
          }
        } catch {}
      }

      if (!uid || !em) {
        const draft = getSignupDraft();
        if (draft?.email && !em) {
          em = draft.email;
        }
      }

      if (active) {
        if (uid && uid !== resolvedUserId) setResolvedUserId(uid);
        if (em && em !== resolvedEmail) setResolvedEmail(em);
      }

      if (!generatedCode && (uid || em)) {
        try {
          const code = await authService.createSignupOtp(uid, em);
          if (active && code) {
            setGeneratedCode(code);
            setShowingCode(true);
          }
        } catch (err: any) {
          console.warn('createSignupOtp failed:', err?.message);
        }
      }
    }

    resolveAndGenerate();
    return () => { active = false; };
  }, [params.userId, params.email, generatedCode]);

  const entranceAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entranceAnim, {
      toValue: 1,
      duration: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [entranceAnim]);

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
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((current) => (current <= 1 ? 0 : current - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const displayCode = generatedCode || params.otpCode || '';
  const effectiveUserId = resolvedUserId || params.userId || '';
  const effectiveEmail = resolvedEmail || params.email || '';

  const handleCopyCode = async () => {
    if (!displayCode) return;
    try {
      await setString(displayCode);
      setOtp(displayCode);
      showToast('Verification code copied to clipboard', 'success');
    } catch {
      // Clipboard unavailable
    }
  };

  const handleVerifyOtp = async () => {
    if (verifying || inFlightRef.current) return;
    setErrorMessage(null);

    if (!effectiveUserId && !effectiveEmail) {
      setErrorMessage('No active sign-up found. Please tap Cancel & Start Over to sign up.');
      triggerShake();
      return;
    }

    const code = (otp || '').trim();
    if (!code || code.length < 6) {
      setErrorMessage(strings.auth.otpCodeLength);
      triggerShake();
      return;
    }

    inFlightRef.current = true;
    setVerifying(true);
    try {
      let ok = false;
      try {
        ok = await authService.verifySignupOtpByUser(effectiveUserId, code, effectiveEmail);
      } catch {
        if (effectiveEmail) {
          const authResult = await authService.verifySignupOtp(effectiveEmail, code);
          ok = !!(authResult?.session || authResult?.user);
        }
      }
      if (!ok) {
        setErrorMessage(strings.auth.otpInvalidOrExpired);
        triggerShake();
        return;
      }

      showToast(strings.auth.otpConfirmedSuccess, 'success');
      const draft = getSignupDraft();
      if (draft?.email && draft?.password) {
        try {
          await authService.signIn({ email: draft.email, password: draft.password });
          clearSignupDraft();
          router.replace('/(onboarding)/step1-mode');
          return;
        } catch {
          router.replace({ pathname: '/(auth)/login', params: { email: effectiveEmail || draft.email } });
          return;
        }
      } else {
        router.replace({ pathname: '/(auth)/login', params: { email: effectiveEmail } });
        return;
      }
    } catch (err: any) {
      triggerShake();
      setErrorMessage(err?.message || strings.auth.otpInvalidOrExpired);
    } finally {
      inFlightRef.current = false;
      setVerifying(false);
    }
  };

  const handleResendOtp = async () => {
    if (resending || cooldown > 0 || (!effectiveUserId && !effectiveEmail)) return;
    setErrorMessage(null);
    setResending(true);
    try {
      const newCode = await authService.createSignupOtp(effectiveUserId, effectiveEmail);
      setGeneratedCode(newCode);
      setOtp('');
      setShowingCode(true);
      setCooldown(60);
      showToast('A new code has been generated.', 'success');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Could not generate a new code.');
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
              transform: [{ translateX: shakeAnim }],
            },
          ]}
        >
          <View
            style={[
              styles.card,
              isWide && styles.cardWide,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}
          >
            <View style={[styles.cardTopAccentBar, { backgroundColor: '#2563EB' }]} />

            <View style={styles.headerTopRow}>
              <IconButton
                icon="arrow-back"
                variant="secondary"
                size="sm"
                onPress={() => {
                  if (router.canGoBack()) {
                    router.back();
                  } else {
                    router.replace('/(auth)/signup-step1');
                  }
                }}
                accessibilityLabel="Back"
              />
              <View
                style={[
                  styles.accessBadge,
                  { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.border },
                ]}
              >
                <Ionicons name="lock-closed-outline" size={13} color={theme.colors.primary} />
                <Text style={[styles.accessBadgeText, { color: theme.colors.primary }]}>Verify Account</Text>
              </View>
            </View>

            <View style={styles.content}>
              <Animated.View style={[styles.iconCircle, { backgroundColor: theme.colors.primarySoft }]}>
                <Ionicons name="lock-closed-outline" size={32} color={theme.colors.primary} />
              </Animated.View>
              <Text style={[styles.title, { color: theme.colors.text }]}>{strings.auth.otpCodeDisplayTitle}</Text>
              <Text style={[styles.description, { color: theme.colors.muted }]}>
                {strings.auth.otpCodeInstructions}
              </Text>

              {/* Code display (shown when we have the generated code) */}
              {showingCode && Boolean(displayCode) && (
                <View style={styles.codeDisplayRow}>
                  <Text
                    style={[
                      styles.codeDisplay,
                      { color: theme.colors.text, backgroundColor: theme.colors.primarySoft },
                    ]}
                  >
                    {displayCode}
                  </Text>
                  <Pressable
                    onPress={handleCopyCode}
                    disabled={verifying}
                    hitSlop={10}
                    accessibilityLabel={strings.auth.otpCopyButton}
                  >
                    <View
                      style={[
                        styles.copyButton,
                        verifying && styles.copyButtonDisabled,
                        { borderColor: theme.colors.primary },
                      ]}
                    >
                      <Ionicons
                        name="copy-outline"
                        size={18}
                        color={verifying ? theme.colors.textTertiary : theme.colors.primary}
                      />
                      <Text
                        style={[
                          styles.copyButtonText,
                          verifying && styles.copyButtonTextDisabled,
                          { color: verifying ? theme.colors.textTertiary : theme.colors.primary },
                        ]}
                      >
                        {strings.auth.otpCopyButton}
                      </Text>
                    </View>
                  </Pressable>
                </View>
              )}

              <OtpInput
                value={otp}
                length={6}
                onChangeText={(val) => {
                  setOtp(val);
                  if (errorMessage) setErrorMessage(null);
                }}
                onComplete={handleVerifyOtp}
                disabled={verifying}
                label={strings.auth.otpCodeLabel}
              />

              {errorMessage && (
                <AlertBox tone="danger" message={errorMessage} style={{ marginTop: 12, width: '100%' }} />
              )}

              {!effectiveUserId && !effectiveEmail && (
                <AlertBox
                  tone="warning"
                  title="No active sign-up found"
                  message="Please return to Sign Up to create your account or receive your verification code."
                  actionLabel="Back to Sign Up"
                  onAction={() => router.replace('/(auth)/signup-step1')}
                  style={{ marginTop: 12, width: '100%' }}
                />
              )}

              <View
                style={[
                  styles.helpBox,
                  { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border },
                ]}
              >
                <Ionicons name="help-circle-outline" size={16} color={theme.colors.muted} />
                <Text style={[styles.helpText, { color: theme.colors.muted }]}>
                  Copy the code above, paste it into the boxes, then tap Verify. The code expires in 10 minutes.
                </Text>
              </View>
            </View>

            <View style={styles.footer}>
              {(effectiveUserId || effectiveEmail) ? (
                <Button
                  title={
                    resending ? 'Sending...' : cooldown > 0 ? `Resend in ${cooldown}s` : strings.auth.otpResendNow
                  }
                  variant="secondary"
                  icon="refresh-outline"
                  onPress={handleResendOtp}
                  loading={resending}
                  disabled={resending || cooldown > 0}
                  fullWidth
                  style={{ marginBottom: 12 }}
                />
              ) : null}
              <Button
                title={verifying ? strings.auth.otpVerifying : strings.auth.otpVerifyButton}
                icon="checkmark-circle-outline"
                onPress={handleVerifyOtp}
                loading={verifying}
                disabled={verifying || (otp || '').length < 6}
                fullWidth
              />
              <Button
                title="Cancel & Start Over"
                variant="ghost"
                icon="log-out-outline"
                onPress={() => router.replace('/(auth)/signup-step1')}
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
    marginBottom: 18,
  },
  codeDisplayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  codeDisplay: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 2,
    fontFamily: 'monospace',
    minWidth: 120,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  copyButtonDisabled: {
    opacity: 0.5,
  },
  copyButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
  copyButtonTextDisabled: {
    color: '#94A3B8',
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
