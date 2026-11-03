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
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { authService } from '../../services/auth';
import { supabase } from '../../lib/supabase';
import { toAppError } from '../../lib/errors';
import { strings } from '../../constants/strings';
import { clearSignupDraft, getSignupDraft } from '../../lib/signupDraft';
import { DateOfBirthField } from '../../components/ui/DateOfBirthField';
import { Button, IconButton } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { isAtLeast18, parseIsoDate } from '../../utils/dateOfBirth';

export default function SignUpStep2Screen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { isWide, topSpace, bottomSpace } = useResponsiveLayout();
  const [draft] = useState(() => getSignupDraft());

  const [dateOfBirth, setDateOfBirth] = useState('');
  const [dateOfBirthError, setDateOfBirthError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDuplicateEmail, setIsDuplicateEmail] = useState(false);

  const inFlightRef = useRef(false);

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
    if (!draft?.email || !draft.password || !draft.displayName) {
      router.replace('/(auth)/signup-step1');
    }
  }, [draft, router]);

  const handleRegister = async () => {
    if (loading || inFlightRef.current) return;
    setError(null);
    setDateOfBirthError(null);
    setIsDuplicateEmail(false);

    if (!draft?.email || !draft.password || !draft.displayName) {
      router.replace('/(auth)/signup-step1');
      return;
    }

    const birthDate = parseIsoDate(dateOfBirth);
    if (!birthDate) {
      setDateOfBirthError(strings.auth.dateOfBirthInvalid);
      setError(strings.auth.dateOfBirthInvalid);
      triggerShake();
      return;
    }
    if (!isAtLeast18(dateOfBirth)) {
      setDateOfBirthError(strings.auth.dateOfBirthUnder18);
      setError(strings.auth.dateOfBirthUnder18);
      triggerShake();
      return;
    }

    const normalizedEmail = authService.normalizeEmail(draft.email);

    inFlightRef.current = true;
    setLoading(true);
    try {
      const res = await authService.signUp({
        email: normalizedEmail,
        password: draft.password,
        displayName: draft.displayName,
        dob: dateOfBirth,
      });

      if (res?.user?.id) {
        let otpCode = '';
        try {
          otpCode = await authService.createSignupOtp(res.user.id);
        } catch {
          // If RPC unavailable, empty code allows user to request resend
        }
        router.replace({
          pathname: '/(auth)/verify-otp',
          params: { userId: res.user.id, otpCode, email: normalizedEmail },
        });
      } else {
        router.replace({
          pathname: '/(auth)/confirm-email',
          params: { email: normalizedEmail },
        });
      }
    } catch (err: any) {
      triggerShake();
      if (
        err?.code === 'EMAIL_ALREADY_REGISTERED' ||
        authService.isDuplicateEmailAuthResult(err)
      ) {
        setIsDuplicateEmail(true);
        setError(strings.auth.duplicateEmailMessage);
      } else {
        setError(toAppError(err, strings.errors.generic).message);
      }
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  const normalizedEmail = authService.normalizeEmail(draft?.email || '');

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: isWide ? 40 : topSpace + 8, paddingBottom: isWide ? 40 : bottomSpace + 16 },
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
                  accessibilityLabel="Back to Step 1"
                />
                <View style={[styles.stepBadge, { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.border }]}>
                  <Ionicons name="sparkles" size={12} color={theme.colors.primary} />
                  <Text style={[styles.stepBadgeText, { color: theme.colors.primary }]}>{strings.auth.signupStep2Indicator}</Text>
                </View>
              </View>

              <View style={[styles.progressTrack, { backgroundColor: theme.colors.border }]}>
                <View style={[styles.progressFill, { width: '100%', backgroundColor: theme.colors.primary }]} />
              </View>

              <Text style={[styles.title, { color: theme.colors.text }]}>{strings.auth.step2Title}</Text>
              <Text style={[styles.subtitle, { color: theme.colors.muted }]}>
                {strings.auth.step2Subtitle}
              </Text>

          {error && (
            <View
              style={[
                styles.errorBox,
                { backgroundColor: theme.colors.dangerSoft, borderColor: theme.colors.danger, borderLeftColor: theme.colors.danger },
              ]}
            >
              <View style={styles.errorHeaderRow}>
                <Ionicons name="alert-circle" size={18} color={theme.colors.dangerText} />
                <Text style={[styles.errorText, { color: theme.colors.dangerText }]}>{error}</Text>
              </View>
              {isDuplicateEmail && (
                <View style={styles.dupActionsRow}>
                  <Button
                    title={strings.auth.duplicateEmailLoginBtn}
                    size="sm"
                    icon="log-in-outline"
                    style={styles.dupActionButton}
                    onPress={() => {
                      clearSignupDraft();
                      router.replace({
                        pathname: '/(auth)/login',
                        params: { email: normalizedEmail },
                      });
                    }}
                  />
                  <Button
                    title={strings.auth.duplicateEmailResetBtn}
                    variant="secondary"
                    size="sm"
                    icon="key-outline"
                    style={styles.dupActionButton}
                    onPress={() => {
                      clearSignupDraft();
                      router.replace({
                        pathname: '/(auth)/forgot-password',
                        params: { email: normalizedEmail },
                      });
                    }}
                  />
                </View>
              )}
            </View>
          )}

          <DateOfBirthField
            label={strings.auth.dateOfBirthLabel}
            value={dateOfBirth}
            onChange={(value) => {
              setDateOfBirth(value);
              setDateOfBirthError(null);
              setError(null);
            }}
            error={dateOfBirthError}
          />

          <View style={[styles.privacyBox, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border }]}>
            <Ionicons name="lock-closed-outline" size={16} color={theme.colors.muted} />
            <Text style={[styles.privacyText, { color: theme.colors.muted }]}>
              Your birth date is stored securely and never shown on your public profile.
            </Text>
          </View>

          <Button
            title={strings.auth.signupComplete}
            onPress={handleRegister}
            loading={loading}
            disabled={loading || !dateOfBirth}
            icon="checkmark-circle-outline"
            fullWidth
            style={{ marginTop: 12 }}
          />

          <Button
            title={`← ${strings.auth.signupBackToStep1}`}
            variant="ghost"
            onPress={() => router.canGoBack() ? router.back() : router.replace('/(auth)/signup-step1')}
            disabled={loading}
            fullWidth
            style={styles.backButton}
          />
        </Card>
      </View>
    </Animated.View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
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
  formCardWide: {
    padding: 38,
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
    marginBottom: 12,
  },
  stepBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 9999,
    borderWidth: 1,
  },
  stepBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    marginBottom: 18,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 22,
  },
  errorBox: {
    padding: 14,
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
  errorText: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    lineHeight: 20,
  },
  dupActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 8,
  },
  dupActionButton: { flex: 1 },
  privacyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
    marginBottom: 8,
  },
  privacyText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  backButton: {
    marginTop: 10,
  },
});
