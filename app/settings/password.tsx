import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { useAuth } from '../../hooks/useAuth';
import { authService } from '../../services/auth';
import { sessionService } from '../../services/sessions';
import { toAppError } from '../../lib/errors';
import { strings } from '../../constants/strings';
import { showToast } from '../../components/ui/Toast';
import { Button } from '../../components/ui/Button';
import { Card, AlertBox, PageHeaderBox } from '../../components/ui/Card';
import { TextInput } from '../../components/ui/TextInput';
import { OtpInput } from '../../components/ui/OtpInput';
import { PasswordPolicyChecklist } from '../../components/ui/PasswordPolicyChecklist';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { bottomPad } = useResponsiveLayout();
  const { user, profile, refreshProfile } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [reauthCode, setReauthCode] = useState('');
  const [needsReauthentication, setNeedsReauthentication] = useState(false);
  const [requestingCode, setRequestingCode] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (saving) return;
    setError(null);
    setNotice(null);
    if (!currentPassword) {
      setError(strings.auth.passwordCurrentRequired);
      return;
    }
    if (!authService.validatePasswordConfirmation(password, confirmation)) {
      setError(strings.auth.passwordMismatch);
      return;
    }
    if (needsReauthentication && !reauthCode.trim()) {
      setError(strings.auth.passwordReauthCodeRequired);
      return;
    }
    setSaving(true);
    try {
      await authService.updatePassword({
        password,
        currentPassword,
        nonce: needsReauthentication ? reauthCode.trim() : undefined,
        email: user?.email ?? '',
        displayName: profile?.display_name ?? '',
      });

      // IAS 1 Requirement C: After password change, log out other active sessions
      try {
        const curSessionId = await sessionService.getCurrentSessionId();
        if (curSessionId) {
          await sessionService.endOtherSessions(curSessionId);
        }
      } catch {
        // Non-blocking best-effort remote revocation
      }

      if (profile?.must_change_password) {
        const refreshed = await refreshProfile();
        showToast(strings.toasts.passwordUpdated, 'success');
        router.replace(refreshed?.onboarding_complete ? '/(tabs)' : '/(onboarding)/step1-mode');
        return;
      }
      showToast(strings.toasts.passwordUpdated, 'success');
      setReauthCode('');
      setNeedsReauthentication(false);
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)/profile');
    } catch (err: any) {
      const code = String(err?.code || '').toLowerCase();
      const rawMessage = String(err?.message || '').toLowerCase();
      if (!needsReauthentication && (code === 'reauthentication_needed' || rawMessage.includes('reauthentication required'))) {
        setRequestingCode(true);
        try {
          await authService.requestPasswordReauthentication();
          setNeedsReauthentication(true);
          setNotice(strings.auth.passwordReauthCodeSent);
          setError(null);
        } catch (reauthErr: any) {
          setError(toAppError(reauthErr, strings.errors.generic).message);
        } finally {
          setRequestingCode(false);
        }
      } else if (needsReauthentication && (code === 'reauthentication_needed' || code === 'reauthentication_failed' || code === 'invalid_nonce' || rawMessage.includes('invalid nonce'))) {
        setError(strings.auth.passwordReauthCodeIncorrect);
      } else if (rawMessage.includes('current password')) {
        setError(strings.auth.passwordCurrentIncorrect);
      } else {
        setError(toAppError(err, strings.auth.passwordInvalid).message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <PageHeaderBox
        title={strings.auth.changePassword}
        subtitle={strings.auth.passwordCurrentRequired}
        onBack={
          !profile?.must_change_password
            ? () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'))
            : undefined
        }
        maxWidth={680}
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: 24,
            paddingBottom: Math.max(bottomPad, 32),
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.innerWrap}>
          {error ? <AlertBox tone="danger" message={error} style={{ marginBottom: 16 }} /> : null}
          {notice ? <AlertBox tone="success" message={notice} style={{ marginBottom: 16 }} /> : null}

          <Card tone="raised" padding="lg" style={styles.card}>
            <TextInput
              label={strings.auth.currentPassword}
              value={currentPassword}
              onChangeText={setCurrentPassword}
              isPassword
              autoCapitalize="none"
              autoComplete="current-password"
            />
            <TextInput
              label={strings.auth.newPassword}
              value={password}
              onChangeText={setPassword}
              isPassword
              autoCapitalize="none"
              autoComplete="new-password"
            />
            <PasswordPolicyChecklist
              password={password}
              email={user?.email ?? ''}
              displayName={profile?.display_name ?? ''}
            />
            <TextInput
              label={strings.auth.confirmNewPassword}
              value={confirmation}
              onChangeText={setConfirmation}
              isPassword
              autoCapitalize="none"
              autoComplete="new-password"
            />
            {needsReauthentication ? (
              <View style={{ gap: 12 }}>
                <OtpInput
                  label={strings.auth.passwordReauthCodeLabel}
                  value={reauthCode}
                  onChangeText={setReauthCode}
                  disabled={requestingCode || saving}
                />
                <Button
                  title={strings.auth.passwordReauthSendAgain}
                  variant="secondary"
                  onPress={async () => {
                    if (requestingCode) return;
                    setRequestingCode(true);
                    setError(null);
                    setNotice(null);
                    setReauthCode('');
                    try {
                      await authService.requestPasswordReauthentication();
                      setNotice(strings.auth.passwordReauthCodeSent);
                    } catch (err: any) {
                      setError(toAppError(err, strings.errors.generic).message);
                    } finally {
                      setRequestingCode(false);
                    }
                  }}
                  loading={requestingCode}
                  disabled={requestingCode || saving}
                />
              </View>
            ) : null}
            <Button
              title={strings.common.save}
              icon="lock-closed-outline"
              onPress={handleSave}
              loading={saving}
              disabled={saving || requestingCode}
            />
          </Card>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 24 },
  innerWrap: {
    maxWidth: 680,
    width: '100%',
    alignSelf: 'center',
  },
  card: {
    gap: 4,
  },
});
