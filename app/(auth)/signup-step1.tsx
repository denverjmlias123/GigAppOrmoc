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
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { authService } from '../../services/auth';
import { supabase } from '../../lib/supabase';
import { toAppError } from '../../lib/errors';
import { strings } from '../../constants/strings';
import { clearSignupDraft, getSignupDraft, setSignupDraft } from '../../lib/signupDraft';
import { PasswordPolicyChecklist } from '../../components/ui/PasswordPolicyChecklist';
import { TextInput } from '../../components/ui/TextInput';
import { Button, IconButton } from '../../components/ui/Button';
import { Card, AlertBox } from '../../components/ui/Card';
import { DateOfBirthField } from '../../components/ui/DateOfBirthField';
import { isAtLeast18, parseIsoDate } from '../../utils/dateOfBirth';

export default function SignUpStep1Screen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { isWide, topSpace, bottomSpace } = useResponsiveLayout();
  const params = useLocalSearchParams<{ email?: string }>();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState(params.email || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Field-level inline validation errors
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | null>(null);
  const [dobError, setDobError] = useState<string | null>(null);
  const [termsError, setTermsError] = useState<string | null>(null);

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
    const draft = getSignupDraft();
    if (draft) {
      if (!displayName && draft.displayName) setDisplayName(draft.displayName);
      if (!email && draft.email) setEmail(draft.email);
      if (!password && draft.password) {
        setPassword(draft.password);
        setConfirmPassword(draft.password);
      }
    }
  }, []);

  const handleNext = async () => {
    if (pending || inFlightRef.current) return;
    setError(null);
    setDisplayNameError(null);
    setEmailError(null);
    setPasswordError(null);
    setConfirmPasswordError(null);
    setDobError(null);
    setTermsError(null);

    let hasFieldError = false;

    if (!displayName.trim() || displayName.trim().length < 2) {
      const msg = strings.auth.signupDisplayNameRequired;
      setDisplayNameError(msg);
      setError(msg);
      hasFieldError = true;
    } else if (displayName.trim().length > 50) {
      const msg = 'Display name cannot exceed 50 characters.';
      setDisplayNameError(msg);
      setError(msg);
      hasFieldError = true;
    }

    const normalizedEmail = authService.normalizeEmail(email);
    const emailValidation = authService.validateEmailInput(normalizedEmail);
    if (!emailValidation.valid) {
      const msg = emailValidation.message || strings.auth.invalidEmailFormat;
      setEmailError(msg);
      setError(msg);
      hasFieldError = true;
    }

    const passwordCheck = authService.validatePassword(password, normalizedEmail, displayName);
    if (!passwordCheck.valid) {
      const msg = strings.auth.passwordInvalid;
      setPasswordError(msg);
      setError(msg);
      hasFieldError = true;
    }

    if (!authService.validatePasswordConfirmation(password, confirmPassword)) {
      const msg = strings.auth.passwordMismatch;
      setConfirmPasswordError(msg);
      setError(msg);
      hasFieldError = true;
    }

    const birthDate = parseIsoDate(dateOfBirth);
    if (!birthDate) {
      setDobError(strings.auth.dateOfBirthInvalid);
      setError(strings.auth.dateOfBirthInvalid);
      hasFieldError = true;
    } else if (!isAtLeast18(dateOfBirth)) {
      setDobError(strings.auth.dateOfBirthUnder18);
      setError(strings.auth.dateOfBirthUnder18);
      hasFieldError = true;
    }

    if (!termsAccepted) {
      const msg = strings.auth.signupTermsRequired;
      setTermsError(msg);
      setError(msg);
      hasFieldError = true;
    }

    if (hasFieldError) {
      triggerShake();
      return;
    }

    inFlightRef.current = true;
    setPending(true);
    try {
      setSignupDraft({ displayName: displayName.trim(), email: normalizedEmail, password });

      // 1. Create the Supabase Auth user (DOB passed for the 18+ trigger)
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: {
            display_name: displayName.trim(),
            dob: dateOfBirth,
            terms_version: 'v1.0',
          },
        },
      });

      if (signUpError) {
        if (
          authService.isDuplicateEmailAuthResult(signUpError, signUpData)
        ) {
          setError(strings.auth.duplicateEmailMessage);
          setEmailError(strings.auth.duplicateEmailMessage);
          triggerShake();
          return;
        }
        throw signUpError;
      }

      const userId = signUpData?.user?.id;
      if (!userId) {
        throw new Error('Account created but no user id returned.');
      }

      // Generate the system auto-generated 6-digit OTP and go to verify-otp
      try {
        const otpCode = await authService.createSignupOtp(userId);
        router.push({
          pathname: '/(auth)/verify-otp',
          params: { userId, otpCode, email: normalizedEmail },
        });
      } catch {
        router.push({
          pathname: '/(auth)/verify-otp',
          params: { userId, email: normalizedEmail },
        });
      }
    } catch (err: any) {
      triggerShake();
      setError(toAppError(err, strings.errors.generic).message);
    } finally {
      inFlightRef.current = false;
      setPending(false);
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
                      router.replace('/(auth)/welcome');
                    }
                  }}
                  accessibilityLabel="Back"
                />
                <View style={[styles.stepBadge, { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.border }]}>
                  <Ionicons name="sparkles" size={12} color={theme.colors.primary} />
                  <Text style={[styles.stepBadgeText, { color: theme.colors.primary }]}>{strings.auth.signupStep1Indicator}</Text>
                </View>
              </View>

              <View style={[styles.progressTrack, { backgroundColor: theme.colors.border }]}>
                <View style={[styles.progressFill, { width: '50%', backgroundColor: theme.colors.primary }]} />
              </View>

              <Text style={[styles.title, { color: theme.colors.text }]}>{strings.auth.step1Title}</Text>
              <Text style={[styles.subtitle, { color: theme.colors.muted }]}>
                Enter your details to create your account for Ormoc City.
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
                </View>
              )}

              <View style={styles.inputGroup}>
                <TextInput
                  label={strings.auth.signupDisplayNameLabel}
                  value={displayName}
                  onChangeText={(val) => {
                    setDisplayName(val);
                    if (displayNameError) setDisplayNameError(null);
                    if (error && !emailError && !passwordError && !confirmPasswordError && !dobError) setError(null);
                  }}
                  placeholder={strings.auth.signupDisplayNamePlaceholder}
                  autoCapitalize="words"
                  maxLength={50}
                  returnKeyType="next"
                  leftIcon="person-outline"
                  error={displayNameError}
                />
              </View>

              <View style={styles.inputGroup}>
                <TextInput
                  label={strings.auth.signupEmailLabel}
                  value={email}
                  onChangeText={(val) => {
                    setEmail(val);
                    if (emailError) setEmailError(null);
                    if (error && !displayNameError && !passwordError && !confirmPasswordError && !dobError) setError(null);
                  }}
                  placeholder={strings.auth.signupEmailPlaceholder}
                  autoCapitalize="none"
                  autoComplete="email"
                  returnKeyType="next"
                  leftIcon="mail-outline"
                  error={emailError}
                />
              </View>

              <View style={styles.inputGroup}>
                <TextInput
                  label={strings.auth.signupPasswordLabel}
                  value={password}
                  onChangeText={(val) => {
                    setPassword(val);
                    if (passwordError) setPasswordError(null);
                  }}
                  placeholder="Min 8 chars (uppercase, number, symbol)"
                  isPassword
                  autoCapitalize="none"
                  autoComplete="new-password"
                  returnKeyType="next"
                  leftIcon="lock-closed-outline"
                  error={passwordError}
                />
                <PasswordPolicyChecklist password={password} email={email} displayName={displayName} />
              </View>

              <View style={styles.inputGroup}>
                <TextInput
                  label={strings.auth.signupConfirmPasswordLabel}
                  value={confirmPassword}
                  onChangeText={(val) => {
                    setConfirmPassword(val);
                    if (confirmPasswordError) setConfirmPasswordError(null);
                  }}
                  placeholder="Re-enter matching password"
                  isPassword
                  autoCapitalize="none"
                  autoComplete="new-password"
                  returnKeyType="next"
                  leftIcon="shield-checkmark-outline"
                  onSubmitEditing={handleNext}
                  error={confirmPasswordError}
                />
              </View>

              <DateOfBirthField
                label={strings.auth.dateOfBirthLabel}
                value={dateOfBirth}
                onChange={(value) => {
                  setDateOfBirth(value);
                  setDobError(null);
                  if (error) setError(null);
                }}
                error={dobError}
              />

              <Pressable
                style={styles.checkboxContainer}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                onPress={() => {
                  setTermsAccepted(!termsAccepted);
                  if (termsError) setTermsError(null);
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: termsAccepted }}
                accessibilityLabel={strings.auth.signupTermsLabel}
              >
                <View
                  style={[
                    styles.checkbox,
                    { borderColor: termsError ? theme.colors.danger : theme.colors.border },
                    termsAccepted && { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
                  ]}
                >
                  {termsAccepted && <Ionicons name="checkmark" size={14} color={theme.colors.heroText} />}
                </View>
                <Text style={[styles.checkboxLabel, { color: termsError ? theme.colors.dangerText : theme.colors.text }]}>
                  {strings.auth.signupTermsLabel}
                </Text>
              </Pressable>
              {termsError ? (
                <View style={styles.termsErrorRow}>
                  <Ionicons name="alert-circle" size={14} color={theme.colors.dangerText} />
                  <Text style={{ color: theme.colors.dangerText, fontSize: 12, fontWeight: '600' }}>
                    {termsError}
                  </Text>
                </View>
              ) : null}

              <Button
                title={strings.auth.signupContinue}
                onPress={handleNext}
                loading={pending}
                disabled={pending}
                rightIcon="arrow-forward"
                fullWidth
                style={styles.continueButton}
              />

              <Pressable
                style={styles.linkButton}
                onPress={() => {
                  clearSignupDraft();
                  router.push('/(auth)/login');
                }}
              >
                <Text style={{ color: theme.colors.muted }}>
                  {strings.auth.signupAlreadyAccount}{' '}
                  <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>
                    {strings.auth.loginTitle}
                  </Text>
                </Text>
              </Pressable>
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
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
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
  inputGroup: {
    marginBottom: 6,
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginVertical: 14,
    gap: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 1.5,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  termsErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: -8,
    marginBottom: 12,
    gap: 6,
  },
  continueButton: {
    marginTop: 10,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 6,
  },
  linkButton: {
    alignItems: 'center',
    marginTop: 20,
    padding: 8,
  },
});
