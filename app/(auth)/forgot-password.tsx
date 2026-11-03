import React, { useState, useEffect, useRef } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { setString } from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { useAuth } from '../../hooks/useAuth';
import { authService } from '../../services/auth';
import { sessionService } from '../../services/sessions';
import { toAppError } from '../../lib/errors';
import { strings } from '../../constants/strings';
import { Button } from '../../components/ui/Button';
import { IconButton } from '../../components/ui/Button';
import { TextInput } from '../../components/ui/TextInput';
import { OtpInput } from '../../components/ui/OtpInput';
import { PasswordPolicyChecklist } from '../../components/ui/PasswordPolicyChecklist';
import { Card, AlertBox } from '../../components/ui/Card';
import { showToast } from '../../components/ui/Toast';

type ForgotPasswordStep = 'email' | 'otp' | 'new_password';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { isWide, topSpace, bottomSpace } = useResponsiveLayout();
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ email?: string }>();

  const [step, setStep] = useState<ForgotPasswordStep>('email');
  const [email, setEmail] = useState(params.email || '');
  const [otp, setOtp] = useState('');
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const inFlightRef = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleReset = async () => {
    if (loading || inFlightRef.current) return;
    setError(null);
    const normalizedEmail = authService.normalizeEmail(email);
    if (!normalizedEmail) {
      setError(strings.auth.loginEmailRequired);
      return;
    }

    const check = authService.validateEmailInput(normalizedEmail);
    if (!check.valid) {
      setError(check.message || strings.auth.invalidEmailFormat);
      return;
    }

    inFlightRef.current = true;
    setLoading(true);
    try {
      const res = await authService.resetPassword(normalizedEmail);
      setStep('otp');
      setOtp('');
      setDevOtp(res?.devOtp || null);
      setCooldown(60);
    } catch (err: any) {
      setError(toAppError(err, strings.auth.passwordResetSendFailed).message);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (resending || inFlightRef.current || cooldown > 0) return;
    setError(null);
    const normalizedEmail = authService.normalizeEmail(email);

    inFlightRef.current = true;
    setResending(true);
    try {
      const res = await authService.resetPassword(normalizedEmail);
      if (res?.devOtp) setDevOtp(res.devOtp);
      setCooldown(60);
      showToast(strings.auth.passwordReauthCodeSent, 'success');
    } catch (err: any) {
      setError(toAppError(err, strings.auth.passwordResetSendFailed).message);
    } finally {
      inFlightRef.current = false;
      setResending(false);
    }
  };

  const handleVerifyOtp = async (codeToVerify?: string) => {
    const code = (codeToVerify ?? otp).trim();
    if (verifying || inFlightRef.current) return;
    setError(null);
    if (!code) {
      setError(strings.auth.otpCodeRequired);
      return;
    }
    if (code.length < 6) {
      setError(strings.auth.otpCodeLength);
      return;
    }

    inFlightRef.current = true;
    setVerifying(true);
    try {
      const normalizedEmail = authService.normalizeEmail(email);
      await authService.verifyPasswordResetOtp(normalizedEmail, code);
      showToast(strings.auth.otpConfirmedSuccess, 'success');
      setStep('new_password');
    } catch (err: any) {
      setError(strings.auth.otpInvalidOrExpired);
    } finally {
      inFlightRef.current = false;
      setVerifying(false);
    }
  };

  const handleSaveNewPassword = async () => {
    if (savingPassword || inFlightRef.current) return;
    setError(null);
    const normalizedEmail = authService.normalizeEmail(email);

    if (!authService.validatePasswordConfirmation(newPassword, confirmPassword)) {
      setError(strings.auth.passwordMismatch);
      return;
    }

    inFlightRef.current = true;
    setSavingPassword(true);
    try {
      await authService.updatePassword({
        password: newPassword,
        email: normalizedEmail,
        displayName: profile?.display_name ?? '',
        otp,
      });

      // IAS 1 Requirement C: After password reset, log out other active sessions
      try {
        const curSessionId = await sessionService.getCurrentSessionId();
        if (curSessionId) {
          await sessionService.endOtherSessions(curSessionId);
        }
      } catch {
        // Non-blocking best-effort remote revocation
      }

      showToast(strings.toasts.passwordUpdated, 'success');
      router.replace(profile?.onboarding_complete ? '/(tabs)' : '/(auth)/login');
    } catch (err: any) {
      setError(toAppError(err, strings.auth.passwordInvalid).message);
    } finally {
      inFlightRef.current = false;
      setSavingPassword(false);
    }
  };

  const handleCancel = async () => {
    try {
      await authService.signOut({ scope: 'local' });
    } catch {
      // safe fallback
    }
    setNewPassword('');
    setConfirmPassword('');
    setOtp('');
    setStep('email');
    router.replace('/(auth)/login');
  };

  const normalizedEmail = authService.normalizeEmail(email);
  const emailError = error && (!normalizedEmail || !authService.validateEmailInput(normalizedEmail).valid)
    ? error
    : null;

  const stepNumber = step === 'email' ? 1 : step === 'otp' ? 2 : 3;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: isWide ? 48 : topSpace + 12, paddingBottom: isWide ? 48 : bottomSpace + 16 },
          isWide && styles.contentWide,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Card
          tone="raised"
          padding="lg"
          style={[styles.formCard, isWide && styles.formCardWide]}
        >
          <View style={styles.topBackRow}>
            <IconButton
              icon="arrow-back"
              variant="secondary"
              size="sm"
              onPress={() => {
                if (step === 'new_password') setStep('otp');
                else if (step === 'otp') setStep('email');
                else router.replace('/(auth)/login');
              }}
              accessibilityLabel="Back"
            />
            <Text style={[styles.stepIndicator, { color: theme.colors.muted }]}>
              Step {stepNumber} of 3
            </Text>
          </View>

          <View style={[styles.progressTrack, { backgroundColor: theme.colors.border }]}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.round((stepNumber / 3) * 100)}%`, backgroundColor: theme.colors.primary },
              ]}
            />
          </View>

          <Text style={[theme.type.title, { color: theme.colors.text, marginBottom: 4 }]}>
            {step === 'new_password' ? strings.auth.passwordResetReady : strings.auth.forgotPasswordTitle}
          </Text>
          <Text style={[theme.type.body, styles.subtitle, { color: theme.colors.muted }]}>
            {step === 'new_password'
              ? strings.auth.passwordPolicyTitle
              : strings.auth.passwordResetDescription}
          </Text>

          {error && !emailError && step === 'email' ? (
            <AlertBox
              tone="danger"
              message={error}
              style={{ marginBottom: 16 }}
            />
          ) : null}

          {step === 'otp' ? (
            <View style={styles.otpSection}>
              <AlertBox
                tone="success"
                title={strings.auth.passwordResetSentTitle}
                message={`${strings.auth.passwordResetSent} ${strings.auth.otpCodeSentNotice}`}
                style={{ marginBottom: 16 }}
              />

              {devOtp ? (
                <View
                  style={[
                    styles.devHelperCard,
                    { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.primary },
                  ]}
                >
                  <Text style={[styles.devHelperTitle, { color: theme.colors.primary }]}>
                    {strings.auth.otpDevTestNotice}
                  </Text>
                  <Text style={[styles.devHelperCode, { color: theme.colors.text }]}>
                    {devOtp}
                  </Text>
                  <Button
                    title={strings.auth.otpDevCopyFillBtn}
                    variant="secondary"
                    onPress={async () => {
                      setOtp(devOtp);
                      try {
                        await setString(devOtp);
                        showToast(strings.auth.otpConfirmedSuccess, 'success');
                      } catch {}
                      if (error) setError(null);
                    }}
                    style={styles.devHelperBtn}
                  />
                </View>
              ) : null}

              <OtpInput
                value={otp}
                onChangeText={(val) => {
                  setOtp(val);
                  if (error) setError(null);
                }}
                error={error}
                disabled={verifying}
                onComplete={(completedCode) => handleVerifyOtp(completedCode)}
              />

              <View style={styles.actions}>
                <Button
                  title={verifying ? strings.auth.otpVerifying : strings.auth.otpVerifyButton}
                  onPress={() => handleVerifyOtp()}
                  loading={verifying}
                  disabled={verifying || otp.length < 6}
                  fullWidth
                />

                <Button
                  title={cooldown > 0 ? strings.auth.otpResendIn(cooldown) : strings.auth.otpResendNow}
                  variant="secondary"
                  onPress={handleResendOtp}
                  loading={resending}
                  disabled={resending || cooldown > 0 || verifying}
                  fullWidth
                />

                <Button
                  title={strings.auth.passwordResetReturnToLogin}
                  variant="ghost"
                  onPress={handleCancel}
                  disabled={verifying}
                  fullWidth
                />
              </View>
            </View>
          ) : step === 'new_password' ? (
            <View style={styles.actions}>
              {error ? (
                <AlertBox
                  tone="danger"
                  message={error}
                  style={{ marginBottom: 16 }}
                />
              ) : null}

              <TextInput
                label={strings.auth.newPassword}
                value={newPassword}
                onChangeText={(val) => {
                  setNewPassword(val);
                  if (error) setError(null);
                }}
                placeholder="Enter new secure password"
                isPassword
                autoCapitalize="none"
                autoComplete="new-password"
                leftIcon="lock-closed-outline"
              />

              <PasswordPolicyChecklist
                password={newPassword}
                email={normalizedEmail}
                displayName={profile?.display_name ?? ''}
              />

              <TextInput
                label={strings.auth.confirmNewPassword}
                value={confirmPassword}
                onChangeText={(val) => {
                  setConfirmPassword(val);
                  if (error) setError(null);
                }}
                placeholder="Re-enter new secure password"
                isPassword
                autoCapitalize="none"
                autoComplete="new-password"
                leftIcon="shield-checkmark-outline"
                onSubmitEditing={handleSaveNewPassword}
              />

              <Button
                title={strings.common.save}
                onPress={handleSaveNewPassword}
                loading={savingPassword}
                disabled={savingPassword || !newPassword || !confirmPassword}
                fullWidth
                style={{ marginTop: 8 }}
              />

              <Button
                title={strings.common.cancel}
                variant="secondary"
                onPress={handleCancel}
                disabled={savingPassword}
                fullWidth
              />
            </View>
          ) : (
            <>
              <TextInput
                label={strings.auth.passwordResetEmailLabel}
                value={email}
                onChangeText={(value) => {
                  setEmail(value);
                  if (error) setError(null);
                }}
                placeholder={strings.auth.passwordResetEmailPlaceholder}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                leftIcon="mail-outline"
                error={emailError}
                onSubmitEditing={handleReset}
              />

              <Button
                title={strings.auth.passwordResetSend}
                onPress={handleReset}
                loading={loading}
                disabled={loading}
                fullWidth
              />

              <Button
                title={strings.auth.passwordResetReturnToLogin}
                variant="ghost"
                onPress={() => router.replace('/(auth)/login')}
                disabled={loading}
                fullWidth
                style={styles.returnButton}
              />
            </>
          )}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 20, justifyContent: 'center' },
  contentWide: { justifyContent: 'center', alignItems: 'center' },
  formCard: { width: '100%', maxWidth: 460, alignSelf: 'center', borderRadius: 16 },
  formCardWide: { padding: 36 },
  topBackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  stepIndicator: {
    fontSize: 14,
    fontWeight: '700',
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    marginBottom: 20,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
  },
  subtitle: { marginTop: 6, marginBottom: 20 },
  devHelperCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    alignItems: 'center',
    gap: 8,
  },
  devHelperTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  devHelperCode: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 4,
    marginVertical: 4,
    fontVariant: ['tabular-nums'],
  },
  devHelperBtn: {
    width: '100%',
  },
  otpSection: { width: '100%' },
  actions: { gap: 12, marginTop: 14 },
  returnButton: { marginTop: 8 },
});
