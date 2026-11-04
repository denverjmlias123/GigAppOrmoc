import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Platform, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAppTheme, lightFreelancerTheme, clientTheme, useResponsiveLayout } from '../theme';
import { Button } from '../../components/ui/Button';
import { AlertBox } from '../../components/ui/Card';
import { useAuth } from '../../hooks/useAuth';
import { authService } from '../../services/auth';
import { applicationsService } from '../../services/applications';
import { strings } from '../../constants/strings';
import { confirmDialog } from '../../lib/dialog';
import { runConfirmedLogout } from '../../utils/confirmedLogout';
import { toAppError } from '../../lib/errors';

type ModeChoice = 'find_work' | 'hire';

function normalizeMode(m?: string | null): ModeChoice | null {
  if (!m) return null;
  if (m === 'hire' || m === 'client') return 'hire';
  if (m === 'find_work' || m === 'freelancer') return 'find_work';
  return null;
}

export default function OnboardingStep1ModeScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { isWide, topSpace, bottomSpace } = useResponsiveLayout();
  const { user, profile, refreshProfile, signOut } = useAuth();

  const currentMode = normalizeMode(profile?.active_mode);
  const [selectedMode, setSelectedMode] = useState<ModeChoice | null>(
    currentMode || null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  // Entrance & feedback motion physics
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(18)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 320,
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 320,
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const triggerShake = () => {
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(shakeAnim, { toValue: -6, duration: 60, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(shakeAnim, { toValue: 6, duration: 60, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: Platform.OS !== 'web' }),
    ]).start();
  };

  useEffect(() => {
    const norm = normalizeMode(profile?.active_mode);
    if (norm && !selectedMode) {
      setSelectedMode(norm);
    }
  }, [profile?.active_mode, selectedMode]);

  const handleSignOut = async () => {
    if (loading) return;
    try {
      const confirmed = await runConfirmedLogout({
        requestConfirmation: () => confirmDialog({
          title: strings.auth.logoutConfirmTitle,
          message: strings.auth.logoutConfirmMessage,
          confirmText: strings.auth.logoutConfirmYes,
          cancelText: strings.common.cancel,
          destructive: true,
        }),
        signOut,
        onConfirmed: () => setLoading(true),
      });
      if (!confirmed) return;
      router.replace('/(auth)/login');
    } catch {
      router.replace('/(auth)/login');
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = async () => {
    if (inFlightRef.current || loading) return;

    if (!selectedMode) {
      setError('Please select either Find Work or Hire Someone to continue.');
      triggerShake();
      return;
    }

    if (!user) {
      router.push('/(onboarding)/step2-skills');
      return;
    }

    const isOnboarding = !profile?.onboarding_completed;
    const currentActive = normalizeMode(profile?.active_mode);
    const isSameMode = currentActive === selectedMode;

    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      if (isOnboarding || !currentActive) {
        await authService.chooseInitialMode(selectedMode);
      } else if (!isSameMode) {
        try {
          await applicationsService.switchMode(selectedMode);
        } catch {
          // In onboarding step 1, fallback to chooseInitialMode
          await authService.chooseInitialMode(selectedMode);
        }
      }
      await refreshProfile();
      router.push('/(onboarding)/step2-skills');
    } catch (err: any) {
      if (err?.message?.includes('already been chosen') || err?.message?.includes('already in')) {
        await refreshProfile();
        router.push('/(onboarding)/step2-skills');
      } else {
        try {
          await authService.updateProfile(user.id, { active_mode: selectedMode } as any);
          await refreshProfile();
          router.push('/(onboarding)/step2-skills');
          return;
        } catch {}

        const appErr = toAppError(err);
        setError(appErr.message || 'Could not save initial mode.');
        triggerShake();
      }
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  const options: {
    id: ModeChoice;
    title: string;
    desc: string;
    badge: string;
    tag: string;
    bullets: string[];
    icon: React.ComponentProps<typeof Ionicons>['name'];
    colors: { bg: string; fg: string; sub: string; accent: string };
  }[] = [
    {
      id: 'find_work',
      title: strings.modes.findWork,
      desc: strings.modes.findWorkDesc,
      badge: 'Freelancer Workspace',
      tag: 'For skilled workers & freelancers',
      bullets: [
        'Browse and apply to open Ormoc gigs',
        'Showcase your skills, rates & portfolio',
        'Milestone payments released directly upon approval',
      ],
      icon: 'briefcase-outline',
      colors: {
        bg: lightFreelancerTheme.colors.heroBg,
        fg: lightFreelancerTheme.colors.heroText,
        sub: lightFreelancerTheme.colors.heroMuted,
        accent: lightFreelancerTheme.colors.accent || '#10B981',
      },
    },
    {
      id: 'hire',
      title: strings.modes.hire,
      desc: strings.modes.hireDesc,
      badge: 'Client Workspace',
      tag: 'For businesses, homeowners & employers',
      bullets: [
        'Post local jobs with clear scopes & budgets',
        'Compare proposals from Ormoc freelancers',
        'Release milestones safely once deliverables are approved',
      ],
      icon: 'people-outline',
      colors: {
        bg: clientTheme.colors.heroBg,
        fg: clientTheme.colors.heroText,
        sub: clientTheme.colors.heroMuted,
        accent: clientTheme.colors.accent || '#F59E0B',
      },
    },
  ];

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: isWide ? 44 : topSpace + 8, paddingBottom: isWide ? 44 : bottomSpace + 20 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View
          style={[
            styles.inner,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }, { translateX: shakeAnim }],
            },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTopRow}>
              <View style={styles.stepBadge}>
                <Ionicons name="sparkles" size={13} color={theme.colors.primary} />
                <Text style={[styles.stepText, { color: theme.colors.primary }]}>Step 1 of 3: Role Choice</Text>
              </View>
              <Button
                title="Log out"
                variant="ghost"
                size="xs"
                icon="log-out-outline"
                onPress={handleSignOut}
                disabled={loading}
              />
            </View>
            <View style={[styles.progressTrack, { backgroundColor: theme.colors.border }]}>
              <View style={[styles.progressFill, { backgroundColor: theme.colors.primary }]} />
            </View>
            <Text style={[theme.type.display, { color: theme.colors.text }]}>How will you use Gigormoc?</Text>
            <Text style={[theme.type.body, { color: theme.colors.muted, marginTop: 6 }]}>
              Pick the primary role you'll use most. Your home dashboard and actions will be tailored to it.
            </Text>
          </View>

          {/* Action-level error banner */}
          {error && (
            <AlertBox
              tone="danger"
              message={error}
              actionLabel="Dismiss"
              onAction={() => setError(null)}
            />
          )}

          {profile?.onboarding_completed && normalizeMode(profile?.active_mode) && (
            <AlertBox
              tone="info"
              title="Active Role"
              message={`Currently in ${normalizeMode(profile?.active_mode) === 'hire' ? 'Hire Someone (Client)' : 'Find Work (Freelancer)'} mode. You can switch roles below anytime or proceed.`}
              style={{ marginVertical: 4 }}
            />
          )}

          {/* Role Choice Cards */}
          <View style={[styles.optionsList, isWide && styles.optionsListWide]}>
            {options.map((opt) => {
              const isSelected = selectedMode === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => {
                    setSelectedMode(opt.id);
                    setError(null);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  style={({ hovered }: any) => [
                    styles.card,
                    isWide && { flex: 1 },
                    {
                      backgroundColor: opt.colors.bg,
                      borderRadius: theme.radii.card,
                      borderColor: isSelected
                        ? opt.colors.accent
                        : hovered
                        ? 'rgba(255,255,255,0.45)'
                        : 'rgba(255,255,255,0.14)',
                      borderWidth: isSelected ? 2.5 : 1.5,
                      transform: [{ scale: isSelected ? 1.015 : 1 }],
                    },
                    isSelected && {
                      shadowColor: opt.colors.accent,
                      shadowOffset: { width: 0, height: 6 },
                      shadowOpacity: 0.28,
                      shadowRadius: 12,
                      elevation: 6,
                    },
                    Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                  ]}
                >
                  <View
                    style={[
                      styles.roleTopBar,
                      { backgroundColor: isSelected ? opt.colors.accent : 'transparent' },
                    ]}
                  />

                  <View style={styles.cardTop}>
                    <View style={styles.cardIcon}>
                      <Ionicons name={opt.icon} size={22} color={opt.colors.fg} />
                    </View>
                    <View style={styles.badgeWrap}>
                      <View style={[styles.rolePill, { backgroundColor: 'rgba(255,255,255,0.16)' }]}>
                        <Text style={styles.rolePillText}>{opt.badge}</Text>
                      </View>
                      <Text style={[styles.tagText, { color: opt.colors.sub }]}>{opt.tag}</Text>
                    </View>
                    <Ionicons
                      name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                      size={26}
                      color={isSelected ? opt.colors.accent : 'rgba(255,255,255,0.40)'}
                    />
                  </View>

                  <Text style={[styles.cardTitle, { color: opt.colors.fg }]}>{opt.title}</Text>
                  <Text style={[styles.cardDesc, { color: opt.colors.sub }]}>{opt.desc}</Text>

                  <View style={styles.bulletList}>
                    {opt.bullets.map((b) => (
                      <View key={b} style={styles.bulletRow}>
                        <Ionicons name="checkmark" size={15} color={opt.colors.accent} />
                        <Text style={[styles.bulletText, { color: opt.colors.fg }]}>{b}</Text>
                      </View>
                    ))}
                  </View>
                </Pressable>
              );
            })}
          </View>

          <AlertBox
            tone="info"
            message={strings.modes.switchNote}
          />

          <View style={styles.footer}>
            <Button
              title={profile?.active_mode ? 'Continue to Step 2' : 'Continue'}
              onPress={handleContinue}
              loading={loading}
              disabled={!selectedMode || loading}
              rightIcon="arrow-forward"
              fullWidth
            />
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 20, justifyContent: 'center' },
  inner: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: 16 },
  header: { marginBottom: 4 },
  headerTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  stepBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 9999,
    backgroundColor: 'rgba(37, 99, 235, 0.08)',
  },
  stepText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  progressTrack: { height: 4, borderRadius: 2, marginBottom: 20, overflow: 'hidden' },
  progressFill: { width: '33%', height: 4, borderRadius: 2 },
  optionsList: { gap: 16 },
  optionsListWide: { flexDirection: 'row', alignItems: 'stretch', gap: 16 },
  card: { padding: 22, overflow: 'hidden', position: 'relative' },
  roleTopBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10 },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeWrap: { flex: 1, justifyContent: 'center' },
  rolePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 9999,
    marginBottom: 2,
  },
  rolePillText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '500',
  },
  cardTitle: { fontSize: 22, fontWeight: '700', letterSpacing: -0.3, marginBottom: 6 },
  cardDesc: { fontSize: 14, lineHeight: 21, marginBottom: 16 },
  bulletList: {
    gap: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.16)',
    paddingTop: 14,
  },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bulletText: { fontSize: 13, fontWeight: '500', flex: 1 },
  footer: { marginTop: 8, maxWidth: 460, width: '100%', alignSelf: 'center' },
});
