import React, { useState, useEffect } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { useAuth } from '../../hooks/useAuth';
import { authService, RESEND_CONFIRMATION_COOLDOWN_SECONDS } from '../../services/auth';
import { toAppError } from '../../lib/errors';
import { strings } from '../../constants/strings';
import { showToast } from '../../components/ui/Toast';
import { Button } from '../../components/ui/Button';
import { Card, AlertBox, PageHeaderBox } from '../../components/ui/Card';
import { TextInput } from '../../components/ui/TextInput';
import { OtpInput } from '../../components/ui/OtpInput';

export default function ChangeEmailScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { bottomPad } = useResponsiveLayout();
  const { user, refreshProfile } = useAuth();

  const [step, setStep] = useState<'request' | 'otp'>('request');
  const [newEmail, setNewEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleRequestChange = async () => {
    if (loading) return;
    setError(null);

    const normalized = authService.normalizeEmail(newEmail);
    const check = authService.validateEmailInput(normalized);
    if (!check.valid) {
      setError(check.message || strings.auth.invalidEmailFormat);
      return;
    }
    if (normalized === user?.email?.toLowerCase()) {
      setError('The new email must be different from your current email.');
      return;
    }
    if (!currentPassword) {
      setError('Please enter your current password for security confirmation.');
      return;
    }

    setLoading(true);
    try {
      // Re-authenticate before initiating sensitive account changes
      const { error: signInErr } = await authService.signIn({
        email: user?.email ?? '',
        password: currentPassword,
      });
      if (signInErr) {
        setError('Current password is incorrect.');
        return;
      }

      await authService.updateEmail(normalized);
      setStep('otp');
      setCooldown(RESEND_CONFIRMATION_COOLDOWN_SECONDS);
      showToast('Confirmation code sent to your new email address.');
    } catch (err: any) {
      setError(toAppError(err, 'Failed to send confirmation code to new email.').message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (codeToVerify?: string) => {
    const code = (codeToVerify ?? otp).trim();
    if (verifying) return;
    setError(null);
    if (!code || code.length < 6) {
      setError('Please enter the 6-digit confirmation code.');
      return;
    }

    setVerifying(true);
    try {
      const normalized = authService.normalizeEmail(newEmail);
      await authService.verifyEmailChangeOtp(normalized, code);
      await refreshProfile();
      showToast('Email address changed successfully!');
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)/profile');
    } catch (err: any) {
      setError(toAppError(err, 'Invalid or expired confirmation code.').message);
    } finally {
      setVerifying(false);
    }
  };

  const handleResendOtp = async () => {
    if (loading || cooldown > 0) return;
    setError(null);
    setLoading(true);
    try {
      const normalized = authService.normalizeEmail(newEmail);
      await authService.updateEmail(normalized);
      setCooldown(RESEND_CONFIRMATION_COOLDOWN_SECONDS);
      showToast('A fresh code has been sent.');
    } catch (err: any) {
      setError(toAppError(err, 'Failed to resend code.').message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <PageHeaderBox
        title="Change Email Address"
        subtitle={user?.email ? `Current: ${user.email}` : undefined}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'))}
        maxWidth={460}
      />

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Card tone="raised" padding="lg" style={styles.card}>
          <Text style={[styles.stepIndicator, { color: theme.colors.muted }]}>
            {step === 'request' ? 'Step 1 of 2: New Email & Password' : 'Step 2 of 2: Confirm 6-Digit Code'}
          </Text>

          {error && <AlertBox tone="danger" message={error} style={{ marginBottom: 16 }} />}

          {step === 'request' ? (
            <View style={{ gap: 14 }}>
              <TextInput
                label="New Email Address"
                value={newEmail}
                onChangeText={(val) => {
                  setNewEmail(val);
                  if (error) setError(null);
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                leftIcon="mail-outline"
                placeholder="name@example.com"
              />

              <TextInput
                label="Current Password"
                value={currentPassword}
                onChangeText={(val) => {
                  setCurrentPassword(val);
                  if (error) setError(null);
                }}
                isPassword
                leftIcon="lock-closed-outline"
                placeholder="Enter password to confirm identity"
              />

              <Button
                title={loading ? 'Processing...' : 'Send Confirmation Code'}
                icon="arrow-forward-outline"
                onPress={handleRequestChange}
                loading={loading}
                disabled={loading || !newEmail.trim() || !currentPassword}
                fullWidth
                style={{ marginTop: 8 }}
              />
            </View>
          ) : (
            <View style={{ gap: 16 }}>
              <Text style={[theme.type.body, { color: theme.colors.text }]}>
                A 6-digit verification code was sent to:
              </Text>
              <Text style={[styles.emailHighlight, { color: theme.colors.primary }]}>
                {authService.normalizeEmail(newEmail)}
              </Text>

              <OtpInput
                value={otp}
                onChangeText={(val) => {
                  setOtp(val);
                  if (error) setError(null);
                }}
                onComplete={handleVerifyOtp}
                disabled={verifying}
                label="Enter 6-Digit Code"
              />

              <Button
                title={verifying ? 'Checking...' : 'Save & Update Email'}
                icon="checkmark-circle-outline"
                onPress={() => handleVerifyOtp()}
                loading={verifying}
                disabled={verifying || otp.length < 6}
                fullWidth
              />

              <Button
                title={cooldown > 0 ? `Resend Code in ${cooldown}s` : 'Resend Code'}
                variant="secondary"
                icon="refresh-outline"
                onPress={handleResendOtp}
                disabled={cooldown > 0 || loading}
                loading={loading}
                fullWidth
              />

              <Button
                title="Change Target Email"
                variant="ghost"
                onPress={() => {
                  setStep('request');
                  setOtp('');
                  setError(null);
                }}
                fullWidth
              />
            </View>
          )}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, alignItems: 'center' },
  card: { width: '100%', maxWidth: 460, borderRadius: 20 },
  stepIndicator: { fontSize: 13, fontWeight: '600', marginBottom: 16 },
  emailHighlight: { fontSize: 15, fontWeight: '700', marginBottom: 8 },
});
