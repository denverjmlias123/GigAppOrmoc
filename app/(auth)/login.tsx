import React, { useState, useRef, useEffect } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { useAuth } from '../../hooks/useAuth';
import { authService } from '../../services/auth';
import { adminService } from '../../services/admin';
import { sessionService } from '../../services/sessions';
import { toAppError } from '../../lib/errors';
import { strings } from '../../constants/strings';
import { TextInput } from '../../components/ui/TextInput';
import { Button, IconButton } from '../../components/ui/Button';
import { Card, AlertBox } from '../../components/ui/Card';
import { useNetworkStatus } from '../../components/ui/OfflineBanner';
import { showToast } from '../../components/ui/Toast';
import { SHOW_ACCOUNT_NOT_FOUND } from '../../constants/featureFlags';
import { formatLockoutCountdown, resolveLoginFailure } from '../../utils/loginFailure';
import { CaptchaChallenge } from '../../components/ui/CaptchaChallenge';

export default function LoginScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { isWide, topSpace, bottomSpace } = useResponsiveLayout();
  const { authNotice, clearAuthNotice, signOut } = useAuth();
  const { isOffline } = useNetworkStatus();
  const params = useLocalSearchParams<{ email?: string }>();

  const [email, setEmail] = useState(params.email || '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailFieldError, setEmailFieldError] = useState<string | null>(null);
  const [passwordFieldError, setPasswordFieldError] = useState<string | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [accountNotFound, setAccountNotFound] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [lockoutSeconds, setLockoutSeconds] = useState<number | null>(null);
  const [lockoutAttemptsLeft, setLockoutAttemptsLeft] = useState<number | null>(null);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaSolved, setCaptchaSolved] = useState(false);
  const [showAppeal, setShowAppeal] = useState(false);
  const [appealEmail, setAppealEmail] = useState('');
  const [appealDetails, setAppealDetails] = useState('');
  const [appealSubmitting, setAppealSubmitting] = useState(false);
  const [appealError, setAppealError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const shakeAnim = useRef(new Animated.Value(0)).current;
  const entranceAnim = useRef(new Animated.Value(0)).current;

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
    if (lockoutSeconds === null || lockoutSeconds <= 0) return;
    const timer = setInterval(() => {
      setLockoutSeconds((remaining) => (remaining === null ? null : Math.max(0, remaining - 1)));
    }, 1000);
    return () => clearInterval(timer);
  }, [lockoutSeconds !== null && lockoutSeconds > 0]);

  const resetFormFeedback = () => {
    clearAuthNotice();
    setError(null);
    setEmailFieldError(null);
    setPasswordFieldError(null);
    setResendMessage(null);
    setNeedsConfirmation(false);
    setAccountNotFound(false);
    setLockoutSeconds(null);
    setLockoutAttemptsLeft(null);
    setAppealError(null);
  };

  const handleSendAppeal = async () => {
    if (appealSubmitting) return;
    setAppealError(null);
    const normalized = authService.normalizeEmail(appealEmail);
    if (!normalized || !normalized.includes('@')) {
      setAppealError(strings.auth.invalidEmailFormat);
      return;
    }
    if (appealDetails.trim().length < 10) {
      setAppealError('Please provide at least 10 characters explaining your appeal.');
      return;
    }
    setAppealSubmitting(true);
    try {
      const res = await authService.submitAccountAppeal({
        email: normalized,
        details: appealDetails.trim(),
      });
      showToast(res.message, 'success');
      setShowAppeal(false);
      setAppealDetails('');
    } catch (e: any) {
      setAppealError(e?.message || strings.errors.generic);
    } finally {
      setAppealSubmitting(false);
    }
  };

  const handleLogin = async () => {
    if (loading || inFlightRef.current) return;
    resetFormFeedback();

    let normalizedEmail = authService.normalizeEmail(email);
    if (!normalizedEmail) {
      setEmailFieldError(strings.auth.loginEmailRequired);
      triggerShake();
      return;
    }
    if (!normalizedEmail.includes('@')) {
      normalizedEmail = await authService.resolveIdentifier(normalizedEmail);
    }
    const emailCheck = authService.validateEmailInput(normalizedEmail);
    if (!emailCheck.valid) {
      setEmailFieldError(emailCheck.message || strings.auth.invalidEmailFormat);
      triggerShake();
      return;
    }
    if (!password) {
      setPasswordFieldError(strings.auth.loginPasswordRequired);
      triggerShake();
      return;
    }
    if (captchaRequired && !captchaSolved) {
      setError('Please complete the security check (CAPTCHA) before logging in.');
      triggerShake();
      return;
    }

    inFlightRef.current = true;
    setLoading(true);
    let authenticated = false;
    try {
      const data = await authService.signIn({
        email: normalizedEmail,
        password,
      });
      authenticated = true;

      const userId = data?.user?.id;
      let greetingName = strings.auth.loginNameFallback;
      if (userId) {
        const profile = await authService.getCurrentProfile(userId);
        if (profile && (profile.status === 'suspended' || profile.status === 'deactivated')) {
          await signOut({ scope: 'local' });
          setError(strings.errors.accountSuspended);
          return;
        }
        if (!profile) {
          showToast(strings.auth.loginSuccess(greetingName), 'success');
          return;
        }
        greetingName = profile?.display_name || greetingName;

        const isSuper = await adminService.isSuperAdmin().catch(() => false);
        await sessionService.noteActivity(true).catch(() => {});
        if (isSuper) {
          showToast(strings.auth.loginSuccess(greetingName), 'success');
          router.replace('/admin/dashboard');
          return;
        }
      }
      await sessionService.noteActivity(true).catch(() => {});
      showToast(strings.auth.loginSuccess(greetingName), 'success');
    } catch (err: any) {
      triggerShake();
      if (authenticated && (err?.code === 'ACCOUNT_SUSPENDED' || err?.message === strings.errors.accountSuspended)) {
        await signOut({ scope: 'local' });
      }
      const loginFailure = resolveLoginFailure(err, SHOW_ACCOUNT_NOT_FOUND, {
        accountNotFound: strings.auth.loginAccountNotFound,
        wrongCredentials: strings.errors.wrongCredentials,
        locked: () => strings.auth.loginLocked,
      });
      if (loginFailure) {
        setAccountNotFound(loginFailure.kind === 'account_not_found');
        if (loginFailure.kind === 'locked') {
          setLockoutSeconds(loginFailure.secondsLeft ?? 0);
          setLockoutAttemptsLeft(loginFailure.attemptsLeft ?? null);
          setCaptchaRequired(true);
          setCaptchaSolved(false);
        }
        setError(loginFailure.message);
        return;
      }
      const attemptsLeft = Number(err?.attempts_left ?? err?.attemptsLeft);
      if (Number.isFinite(attemptsLeft) && attemptsLeft >= 0 && attemptsLeft <= 3) {
        setLockoutAttemptsLeft(Math.floor(attemptsLeft));
      }
      const appErr = toAppError(err, strings.errors.wrongCredentials);
      setError(appErr.message);
      if (appErr.action === 'resend_confirmation' || err?.code === 'EMAIL_NOT_CONFIRMED') {
        setNeedsConfirmation(true);
      }
      if (appErr.field === 'email') {
        setEmailFieldError(appErr.message);
      }
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  const handleResendConfirmation = async () => {
    if (resending) return;
    setResendMessage(null);
    const normalizedEmail = authService.normalizeEmail(email);
    if (!normalizedEmail) {
      setEmailFieldError(strings.auth.loginResendEmailRequired);
      return;
    }

    setResending(true);
    try {
      await authService.resendConfirmationEmail(normalizedEmail);
      setResendMessage(strings.auth.confirmationEmailSent(normalizedEmail));
    } catch (err: any) {
      const appErr = toAppError(err);
      setError(appErr.message);
    } finally {
      setResending(false);
    }
  };

  const isLockoutActive = lockoutSeconds !== null && lockoutSeconds > 0;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: isWide ? 48 : topSpace + 8, paddingBottom: isWide ? 48 : bottomSpace + 16 },
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
          <View style={styles.cardGlowWrapper}>
            <Card
              tone="raised"
              padding="lg"
              style={[styles.formCard, isWide && styles.formCardWide]}
            >
              <View style={styles.cardTopAccentBar} />

              <View style={styles.backRow}>
                <IconButton
                  icon="arrow-back"
                  variant="secondary"
                  size="sm"
                  onPress={() => {
                    if (router.canGoBack()) {
                      router.back();
                    } else {
                      router.replace('/(auth)/welcome');
                    }
                  }}
                  accessibilityLabel={strings.auth.loginBackLabel}
                />
              </View>

              <View style={[styles.accessBadge, { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.border }]}>
                <Ionicons name="shield-checkmark" size={13} color={theme.colors.primary} />
                <Text style={[styles.accessBadgeText, { color: theme.colors.primary }]}>Ormoc City Marketplace Access</Text>
              </View>

              <Text style={[styles.titleDisplay, { color: theme.colors.text }]}>{strings.auth.loginTitle}</Text>
              <Text style={[theme.type.body, styles.subtitle, { color: theme.colors.muted }]}>
                {strings.auth.loginReturnSubtitle}
              </Text>

          {authNotice && !error && (
            <AlertBox
              tone="info"
              message={authNotice}
              onDismiss={clearAuthNotice}
              style={{ marginBottom: 16 }}
            />
          )}

          {error && (
            <View style={[styles.errorBox, { backgroundColor: theme.colors.dangerSoft, borderColor: theme.colors.danger }]}>
              <View style={styles.errorHeaderRow}>
                <Ionicons name="alert-circle" size={18} color={theme.colors.dangerText} />
                <Text style={[styles.errorText, { color: theme.colors.dangerText }]}>
                  {lockoutSeconds !== null ? strings.auth.loginLocked : error}
                  {isLockoutActive ? ` ${formatLockoutCountdown(lockoutSeconds)}` : ''}
                </Text>
              </View>
              {lockoutSeconds === 0 && (
                <Text style={[styles.errorSubText, { color: theme.colors.dangerText }]}>{strings.auth.loginLockoutEnded}</Text>
              )}
              {lockoutAttemptsLeft !== null && isLockoutActive && (
                <Text style={[styles.errorSubText, { color: theme.colors.dangerText }]}>
                  {strings.auth.loginAttemptsLeft(lockoutAttemptsLeft)}
                </Text>
              )}
              {lockoutAttemptsLeft !== null && lockoutSeconds === null && (
                <Text style={[styles.errorSubText, { color: theme.colors.dangerText }]}>
                  {strings.auth.loginAttemptsLeftCount(lockoutAttemptsLeft)}
                </Text>
              )}
              {needsConfirmation && (
                <View style={{ gap: 8, marginTop: 8 }}>
                  <Button
                    title="Enter confirmation code"
                    variant="primary"
                    size="sm"
                    icon="key-outline"
                    onPress={() =>
                      router.push({
                        pathname: '/(auth)/confirm-email',
                        params: { email: authService.normalizeEmail(email) },
                      })
                    }
                  />
                  <Button
                    title={resending ? strings.auth.loginResendSending : strings.auth.loginResendConfirmation}
                    variant="secondary"
                    size="sm"
                    icon="mail-outline"
                    onPress={handleResendConfirmation}
                    loading={resending}
                    disabled={resending || isOffline}
                  />
                </View>
              )}
              {accountNotFound && (
                <Button
                  title={strings.auth.loginCreateAccount}
                  variant="secondary"
                  size="sm"
                  icon="person-add-outline"
                  onPress={() =>
                    router.push({
                      pathname: '/(auth)/signup-step1',
                      params: { email: authService.normalizeEmail(email) },
                    })
                  }
                  style={{ marginTop: 8 }}
                />
              )}
              {Boolean(
                (error && (error.toLowerCase().includes('suspended') || error.toLowerCase().includes('inactive'))) ||
                (authNotice && authNotice.toLowerCase().includes('suspended'))
              ) && (
                <View style={{ gap: 8, marginTop: 10 }}>
                  <Text style={[theme.type.small, { color: theme.colors.dangerText }]}>
                    Your account has been suspended by administration. If you have in-flight gig agreements or wish to appeal, submit a report directly to the Super Admin.
                  </Text>
                  <Button
                    title="Appeal Suspension / Report Issue"
                    variant="danger"
                    size="sm"
                    icon="shield-outline"
                    onPress={() => {
                      setAppealEmail(email.trim());
                      setShowAppeal(true);
                    }}
                  />
                </View>
              )}
            </View>
          )}

          {resendMessage && (
            <AlertBox
              tone="success"
              message={resendMessage}
              style={{ marginBottom: 16 }}
            />
          )}

          {showAppeal ? (
            <View style={{ gap: 12, marginTop: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={[theme.type.bodyStrong, { color: theme.colors.text }]}>
                  Appeal Suspension / Report Issue
                </Text>
                <IconButton
                  icon="close"
                  size="sm"
                  variant="ghost"
                  onPress={() => setShowAppeal(false)}
                  accessibilityLabel="Close appeal form"
                />
              </View>
              <Text style={[theme.type.small, { color: theme.colors.muted }]}>
                Submit a report directly to the Super Admin. Include details about in-flight gig agreements or reasons why your account should be reviewed.
              </Text>
              {appealError && <AlertBox tone="danger" message={appealError} />}
              <TextInput
                label="Account Email"
                value={appealEmail}
                onChangeText={setAppealEmail}
                placeholder="your-email@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <TextInput
                label="Appeal Details / Problem Description"
                value={appealDetails}
                onChangeText={setAppealDetails}
                placeholder="Describe what happened, any pending gig milestones, or why access should be restored (minimum 10 characters)..."
                multiline
                numberOfLines={4}
              />
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    title={strings.common.cancel}
                    variant="secondary"
                    onPress={() => setShowAppeal(false)}
                    disabled={appealSubmitting}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Submit Appeal"
                    variant="primary"
                    icon="paper-plane-outline"
                    loading={appealSubmitting}
                    onPress={handleSendAppeal}
                    disabled={appealSubmitting || !appealEmail.trim() || appealDetails.trim().length < 10}
                  />
                </View>
              </View>
            </View>
          ) : (
            <>
              <TextInput
                label={strings.auth.loginEmailLabel}
                value={email}
                onChangeText={(val) => {
                  setEmail(val);
                  if (lockoutSeconds !== null) {
                    setLockoutSeconds(null);
                    setLockoutAttemptsLeft(null);
                    setError(null);
                  }
                  setAccountNotFound(false);
                  if (accountNotFound) setError(null);
                  if (emailFieldError) setEmailFieldError(null);
                }}
                placeholder={strings.auth.loginEmailPlaceholder}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="username"
                returnKeyType="next"
                leftIcon="person-outline"
                onEndEditing={() => {
                  const normalizedEmail = authService.normalizeEmail(email);
                  void authService
                    .getLoginGuardState(normalizedEmail)
                    .then((guard) => {
                      if (guard.locked) {
                        setLockoutSeconds(Math.max(0, Number(guard.seconds_left) || 0));
                        setLockoutAttemptsLeft(0);
                        setError(strings.auth.loginLocked);
                      } else if (typeof guard.attempts_left === 'number') {
                        setLockoutSeconds(null);
                        setLockoutAttemptsLeft(guard.attempts_left);
                      }
                    })
                    .catch(() => undefined);
                }}
                error={emailFieldError}
              />

              <TextInput
                label={strings.auth.loginPasswordLabel}
                value={password}
                onChangeText={(val) => {
                  setPassword(val);
                  if (passwordFieldError) setPasswordFieldError(null);
                }}
                placeholder={strings.auth.loginPasswordPlaceholder}
                isPassword
                autoCapitalize="none"
                autoComplete="current-password"
                returnKeyType="go"
                leftIcon="lock-closed-outline"
                onSubmitEditing={handleLogin}
                error={passwordFieldError}
              />

              <Pressable style={styles.forgotPassword} onPress={() => router.push('/(auth)/forgot-password')} hitSlop={8}>
                <Text style={{ color: theme.colors.primary, fontSize: 14, fontWeight: '700' }}>
                  {strings.auth.forgotPassword}
                </Text>
              </Pressable>

              <CaptchaChallenge
                required={captchaRequired}
                isSolved={captchaSolved}
                onSolved={setCaptchaSolved}
              />

              <Button
                title={
                  isLockoutActive
                    ? `${strings.auth.loginButton} (${formatLockoutCountdown(lockoutSeconds)})`
                    : isOffline
                    ? strings.auth.loginOffline
                    : strings.auth.loginButton
                }
                onPress={handleLogin}
                loading={loading}
                disabled={loading || isOffline || isLockoutActive || (captchaRequired && !captchaSolved)}
                icon="log-in-outline"
                fullWidth
              />

              <Pressable style={styles.linkButton} onPress={() => router.push('/(auth)/signup-step1')}>
                <Text style={{ color: theme.colors.muted }}>
                  {strings.auth.loginNewAccount}{' '}
                  <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>
                    {strings.auth.loginCreateAccount}
                  </Text>
                </Text>
              </Pressable>

              <Pressable
                style={{ marginTop: 14, alignItems: 'center' }}
                onPress={() => {
                  setAppealEmail(email.trim());
                  setShowAppeal(true);
                }}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Text style={[theme.type.small, { color: theme.colors.muted, textDecorationLine: 'underline' }]}>
                  Account suspended or locked? Appeal to Super Admin
                </Text>
              </Pressable>
            </>
          )}
        </Card>
      </View>
    </Animated.View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  scrollContent: { flexGrow: 1, paddingHorizontal: 20, justifyContent: 'center' },
  scrollContentWide: { justifyContent: 'center', alignItems: 'center' },
  animatedCardWrapper: { width: '100%', alignSelf: 'center' },
  animatedCardWrapperWide: { maxWidth: 480 },
  cardGlowWrapper: {
    width: '100%',
    alignSelf: 'center',
    position: 'relative',
  },
  formCard: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    borderRadius: 22,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
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
  formCardWide: { padding: 38 },
  cardTopAccentBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: '#2563EB',
  },
  backRow: { marginBottom: 14, alignSelf: 'flex-start' },
  accessBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 9999,
    borderWidth: 1,
    marginBottom: 14,
  },
  accessBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  titleDisplay: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  subtitle: { marginTop: 6, marginBottom: 24, fontSize: 14, lineHeight: 21 },
  errorBox: {
    padding: 12,
    borderRadius: 12,
    marginBottom: 20,
    borderWidth: 1,
    gap: 8,
  },
  errorHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: { fontSize: 14, flex: 1, fontWeight: '600', lineHeight: 20, fontVariant: ['tabular-nums'] },
  errorSubText: { fontSize: 13, fontWeight: '500', marginLeft: 26, lineHeight: 18 },
  forgotPassword: { alignSelf: 'flex-end', marginTop: 4, marginBottom: 20, paddingVertical: 4 },
  linkButton: { alignItems: 'center', marginTop: 22, paddingVertical: 10 },
});
