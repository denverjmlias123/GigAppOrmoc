import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { useAuth } from '../../hooks/useAuth';
import { authService } from '../../services/auth';
import { profileService, Area } from '../../services/profile';
import { aiService } from '../../services/ai';
import { toAppError } from '../../lib/errors';
import { PhotoUploadCard } from '../../components/profile/PhotoUploadCard';
import { Card, AlertBox, StickyFooterBox } from '../../components/ui/Card';
import { Button, IconButton } from '../../components/ui/Button';
import { TextInput } from '../../components/ui/TextInput';
import { Chip } from '../../components/ui/Chip';
import { strings } from '../../constants/strings';
import { confirmDialog } from '../../lib/dialog';
import { runConfirmedLogout } from '../../utils/confirmedLogout';
import { showToast } from '../../components/ui/Toast';

export default function OnboardingStep3ProfileScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { isWide, topSpace } = useResponsiveLayout();
  const { user, profile, refreshProfile, signOut } = useAuth();
  const isHire = profile?.active_mode === 'hire';

  // Photo
  const [photoBusy, setPhotoBusy] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  // Areas
  const [areas, setAreas] = useState<Area[]>([]);
  const [selectedArea, setSelectedArea] = useState('');
  const [customArea, setCustomArea] = useState('');
  const [areaSearch, setAreaSearch] = useState('');
  const [areasLoading, setAreasLoading] = useState(true);

  // Bio
  const [bio, setBio] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const inFlightRef = useRef(false);

  // AI Bio Drafting
  const [aiDrafts, setAiDrafts] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Entrance & micro-physics animations
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

  const handleSignOut = async () => {
    if (signingOut) return;
    try {
      const confirmed = await runConfirmedLogout({
        requestConfirmation: () => confirmDialog({
          title: strings.auth.logoutConfirmTitle,
          message: strings.auth.logoutConfirmMessage,
          confirmText: strings.auth.logoutConfirmYes,
          cancelText: strings.common.cancel,
          destructive: true,
        }),
        signOut: () => signOut({ reason: 'user' }),
        onConfirmed: () => setSigningOut(true),
      });
      if (!confirmed) return;
      router.replace('/(auth)/login');
    } finally {
      setSigningOut(false);
    }
  };

  const handlePickPhoto = async (source: 'library' | 'camera') => {
    if (!user || photoBusy) return;
    setError(null);
    setPhotoBusy(true);
    try {
      const url = await profileService.pickAndUploadAvatar(user.id, source);
      if (url) {
        setAvatarUri(url);
        await refreshProfile();
        showToast('Profile photo updated!', 'success');
      }
    } catch (err: any) {
      const appErr = toAppError(err);
      setError(appErr.message || 'Could not upload photo.');
      triggerShake();
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (!user || photoBusy) return;
    setError(null);
    setPhotoBusy(true);
    try {
      await profileService.removeAvatar(user.id);
      setAvatarUri(null);
      await refreshProfile();
      showToast('Profile photo removed.', 'info');
    } catch (err: any) {
      const appErr = toAppError(err);
      setError(appErr.message || 'Could not remove photo.');
      triggerShake();
    } finally {
      setPhotoBusy(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    const fetchAreas = async () => {
      try {
        const data = await profileService.getAreas();
        if (mounted) {
          setAreas(data || []);
        }
      } catch {
        // Table may be empty
      } finally {
        if (mounted) setAreasLoading(false);
      }
    };

    fetchAreas();
    return () => {
      mounted = false;
    };
  }, []);

  const filteredAreas = useMemo(() => {
    const q = areaSearch.trim().toLowerCase();
    if (!q) return areas;
    return areas.filter((a) => a.name.toLowerCase().includes(q));
  }, [areas, areaSearch]);

  const handleDraftBio = async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const chosenArea = selectedArea || customArea;
      const drafts = await aiService.draftBio({
        mode: profile?.active_mode || undefined,
        area: chosenArea,
        roughBio: bio,
      });
      setAiDrafts(drafts);
    } catch (err: any) {
      const appErr = toAppError(err);
      setAiError(appErr.message || 'Could not generate drafts. You can write your bio directly.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleSelectDraft = (draft: string) => {
    setBio(draft);
  };

  const handleComplete = async (skip: boolean = false) => {
    if (inFlightRef.current || loading) return;
    setError(null);

    if (!user) {
      router.replace('/(tabs)');
      return;
    }

    const finalArea = selectedArea || customArea.trim();
    const finalBio = skip ? '' : bio.trim();

    if (!skip && finalBio && (finalBio.length < 20 || finalBio.length > 300)) {
      setError('Bio must be between 20 and 300 characters (or skip for now).');
      triggerShake();
      return;
    }

    inFlightRef.current = true;
    setLoading(true);
    try {
      await authService.updateProfile(user.id, {
        bio: finalBio,
        area: skip ? '' : finalArea,
      });

      await authService.completeOnboarding(profile?.active_mode || (isHire ? 'hire' : 'find_work'));
      await refreshProfile();
      router.replace('/(tabs)');
    } catch (err: any) {
      const appErr = toAppError(err);
      setError(appErr.message || 'Failed to complete profile setup. Please try again.');
      triggerShake();
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { paddingTop: isWide ? 36 : topSpace + 8 }]}
    >
      <View style={styles.header}>
        <View style={styles.topRow}>
          <View style={styles.topLeftRow}>
            <IconButton
              icon="arrow-back"
              variant="secondary"
              size="sm"
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/(onboarding)/step2-skills'))}
              accessibilityLabel="Back to Step 2"
            />
            <View style={styles.stepBadge}>
              <Ionicons name="sparkles" size={13} color={theme.colors.primary} />
              <Text style={[styles.stepIndicator, { color: theme.colors.primary }]}>Step 3 of 3</Text>
            </View>
            <View
              style={[
                styles.rolePill,
                {
                  backgroundColor: isHire ? 'rgba(245, 158, 11, 0.12)' : 'rgba(37, 99, 235, 0.12)',
                  borderColor: isHire ? 'rgba(245, 158, 11, 0.28)' : 'rgba(37, 99, 235, 0.28)',
                },
              ]}
            >
              <Ionicons
                name={isHire ? 'people-outline' : 'briefcase-outline'}
                size={12}
                color={isHire ? '#B45309' : theme.colors.primary}
              />
              <Text
                style={[
                  styles.rolePillText,
                  { color: isHire ? '#B45309' : theme.colors.primary },
                ]}
              >
                {isHire ? 'Client Profile' : 'Freelancer Profile'}
              </Text>
            </View>
          </View>
          <Button
            title="Log Out"
            variant="ghost"
            size="xs"
            icon="log-out-outline"
            onPress={handleSignOut}
            disabled={signingOut}
          />
        </View>
        <View style={[styles.progressTrack, { backgroundColor: theme.colors.border }]}>
          <View style={[styles.progressFill, { width: '100%', backgroundColor: theme.colors.primary }]} />
        </View>

        <Text style={[styles.title, { color: theme.colors.text }]}>{strings.onboarding.bioTitle}</Text>
        <Text style={[styles.subtitle, { color: theme.colors.muted }]}>
          {strings.onboarding.bioSubtitle}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Animated.View
          style={[
            styles.inner,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }, { translateX: shakeAnim }],
            },
          ]}
        >
          {error && (
            <AlertBox
              tone="danger"
              message={error}
              actionLabel="Dismiss"
              onAction={() => setError(null)}
              style={{ marginBottom: 16 }}
            />
          )}

          {/* Profile Photo Card */}
          <PhotoUploadCard
            displayName={profile?.display_name || 'User'}
            avatarPath={avatarUri || profile?.avatar_path}
            photoBusy={photoBusy}
            onPickLibrary={() => handlePickPhoto('library')}
            onPickCamera={() => handlePickPhoto('camera')}
            onRemovePhoto={handleRemovePhoto}
          />

          {/* Barangay / Area Selection */}
          <Card
            headerTitle="Barangay / Area in Ormoc"
            headerSubtitle="Select your local area or barangay in Ormoc City to match with nearby opportunities."
            headerIcon="location-outline"
            style={styles.card}
          >
            {areasLoading ? (
              <View style={styles.centerLoading}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
                <Text style={[styles.loadingText, { color: theme.colors.muted }]}>Loading Ormoc barangays...</Text>
              </View>
            ) : areas.length > 0 ? (
              <>
                {selectedArea ? (
                  <View style={styles.selectedAreaRow}>
                    <View style={[styles.selectedAreaBadge, { backgroundColor: theme.colors.primarySoft }]}>
                      <Ionicons name="location" size={14} color={theme.colors.primary} />
                      <Text style={[styles.selectedAreaText, { color: theme.colors.primary }]}>
                        Selected: {selectedArea}
                      </Text>
                    </View>
                    <Button
                      title="Clear"
                      variant="ghost"
                      size="xs"
                      icon="close-outline"
                      onPress={() => setSelectedArea('')}
                    />
                  </View>
                ) : null}

                {areas.length > 8 && (
                  <TextInput
                    placeholder="Search barangay in Ormoc..."
                    value={areaSearch}
                    onChangeText={setAreaSearch}
                    leftIcon="search-outline"
                    onClear={areaSearch ? () => setAreaSearch('') : undefined}
                    containerStyle={{ marginBottom: 12 }}
                  />
                )}

                {filteredAreas.length === 0 ? (
                  <View style={styles.noAreaMatch}>
                    <Text style={[styles.noAreaText, { color: theme.colors.muted }]}>
                      No barangay found matching "{areaSearch}". You can use it as a custom area:
                    </Text>
                    <Button
                      title={`Use "${areaSearch}"`}
                      variant="soft"
                      size="sm"
                      icon="add"
                      onPress={() => {
                        setSelectedArea(areaSearch.trim());
                        setAreaSearch('');
                      }}
                    />
                  </View>
                ) : (
                  <View style={styles.chipsWrap}>
                    {filteredAreas.map((a) => {
                      const isSelected = selectedArea === a.name;
                      return (
                        <Chip
                          key={a.id}
                          label={a.name}
                          selected={isSelected}
                          size="sm"
                          onPress={() => setSelectedArea(isSelected ? '' : a.name)}
                        />
                      );
                    })}
                  </View>
                )}
              </>
            ) : (
              <TextInput
                value={customArea}
                onChangeText={setCustomArea}
                placeholder="e.g. Cogon, Ormoc City"
                leftIcon="location-outline"
                maxLength={60}
                containerStyle={{ marginBottom: 0 }}
              />
            )}
          </Card>

          {/* Short Bio */}
          <Card
            headerTitle="Short Bio"
            headerSubtitle="Share a brief introduction with the Ormoc community."
            headerIcon="document-text-outline"
            headerRight={
              <Text
                style={[
                  styles.charCount,
                  {
                    color:
                      bio.length > 0 && bio.length < 20
                        ? (theme.colors.warningText || '#D97706')
                        : bio.length >= 20 && bio.length <= 270
                        ? (theme.colors.successText || '#059669')
                        : bio.length > 270
                        ? (theme.colors.warningText || '#D97706')
                        : theme.colors.muted,
                  },
                ]}
              >
                {bio.length}/300 {bio.length > 0 && bio.length < 20 ? '(min 20)' : ''}
              </Text>
            }
            style={styles.card}
          >
            <TextInput
              value={bio}
              onChangeText={setBio}
              placeholder={
                isHire
                  ? 'Introduce yourself or your business and what kind of local talent you look to hire in Ormoc...'
                  : "Describe your background, services, experience, and what work you're looking for..."
              }
              multiline
              numberOfLines={4}
              maxLength={300}
              containerStyle={{ marginBottom: 12 }}
            />

            {/* AI Bio Assist Button */}
            <Button
              title={aiLoading ? strings.onboarding.draftingBio : strings.onboarding.helpMeWriteBioBtn}
              onPress={handleDraftBio}
              variant="ai"
              size="md"
              icon="sparkles"
              loading={aiLoading}
              disabled={aiLoading}
              fullWidth
            />

            {aiError && (
              <AlertBox
                tone="danger"
                message={aiError}
                actionLabel="Retry"
                onAction={handleDraftBio}
                style={{ marginTop: 10 }}
              />
            )}

            {/* AI Bio Draft Options */}
            {aiDrafts.length > 0 && (
              <View style={styles.draftsContainer}>
                <View style={styles.draftsHeaderRow}>
                  <Ionicons name="sparkles" size={14} color={theme.colors.spark} />
                  <Text style={[styles.draftsHeader, { color: theme.colors.text }]}>
                    {strings.onboarding.bioDraftsTitle}
                  </Text>
                </View>
                {aiDrafts.map((draft, idx) => {
                  const isSelected = bio === draft;
                  return (
                    <Card
                      key={idx}
                      tone={isSelected ? 'role' : 'inset'}
                      padding="sm"
                      onPress={() => handleSelectDraft(draft)}
                      style={styles.draftCard}
                    >
                      <Text style={[styles.draftText, { color: theme.colors.text }]}>
                        "{draft}"
                      </Text>
                      <View style={styles.draftHintRow}>
                        {isSelected ? (
                          <>
                            <Ionicons name="checkmark-circle" size={14} color={theme.colors.primary} />
                            <Text style={[styles.draftTapHint, { color: theme.colors.primary }]}>Selected draft</Text>
                          </>
                        ) : (
                          <>
                            <Ionicons name="add-circle-outline" size={14} color={theme.colors.muted} />
                            <Text style={[styles.draftTapHint, { color: theme.colors.muted }]}>Tap to use this draft</Text>
                          </>
                        )}
                      </View>
                    </Card>
                  );
                })}
              </View>
            )}
          </Card>
        </Animated.View>
      </ScrollView>

      {/* Sticky Footer */}
      <StickyFooterBox maxWidth={520}>
        <Button
          title={strings.onboarding.finishSetupBtn}
          onPress={() => handleComplete(false)}
          loading={loading}
          disabled={loading}
          icon="checkmark-done"
          fullWidth
        />
        <Button
          title={strings.onboarding.skipForNow}
          onPress={() => handleComplete(true)}
          variant="ghost"
          size="sm"
          disabled={loading}
          fullWidth
          style={{ marginTop: 4 }}
        />
      </StickyFooterBox>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    marginBottom: 12,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  topLeftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 9999,
    backgroundColor: 'rgba(37, 99, 235, 0.08)',
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
  stepIndicator: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 9999,
    borderWidth: 1,
  },
  rolePillText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  inner: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
  },
  card: {
    marginBottom: 16,
  },
  charCount: {
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  centerLoading: {
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
  },
  selectedAreaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  selectedAreaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  selectedAreaText: {
    fontSize: 13,
    fontWeight: '700',
  },
  noAreaMatch: {
    padding: 12,
    alignItems: 'center',
    gap: 8,
  },
  noAreaText: {
    fontSize: 13,
    textAlign: 'center',
  },
  draftsContainer: {
    marginTop: 14,
  },
  draftsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  draftsHeader: {
    fontSize: 13,
    fontWeight: '700',
  },
  draftCard: {
    marginBottom: 10,
    borderRadius: 14,
  },
  draftText: {
    fontSize: 14,
    lineHeight: 21,
    fontStyle: 'italic',
  },
  draftHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
  },
  draftTapHint: {
    fontSize: 12,
    fontWeight: '600',
  },
});
