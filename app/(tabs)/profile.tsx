import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { useAuth } from '../../hooks/useAuth';
import { Avatar } from '../../components/ui/Avatar';
import { LegitBadge } from '../../components/ui/LegitBadge';
import { aiLegitimacyService } from '../../services/aiLegitimacy';
import { Button } from '../../components/ui/Button';
import { Card, AlertBox, StatBox } from '../../components/ui/Card';
import { ListRow } from '../../components/ui/ListRow';
import {
  ProfileCompleteBadge,
  ProfileCompletenessCard,
} from '../../components/ui/ProfileCompleteness';
import { ScreenBackground } from '../../components/ui/ScreenBackground';
import {
  profileService,
  ProfileCompleteness,
  CompletenessMissingItem,
} from '../../services/profile';
import { strings, mapSqlErrorToFriendlyMessage } from '../../constants/strings';
import { confirmDialog } from '../../lib/dialog';
import { runConfirmedLogout } from '../../utils/confirmedLogout';
import { adminService } from '../../services/admin';

export default function ProfileScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { isWide, isDesktop, topSpace } = useResponsiveLayout();
  const { user, profile, refreshProfile, signOut } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [completeness, setCompleteness] = useState<ProfileCompleteness | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [showPhotoMenu, setShowPhotoMenu] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [screeningBusy, setScreeningBusy] = useState(false);

  const loadCompleteness = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await profileService.getProfileCompleteness(user.id);
      setCompleteness(res);
    } catch {
      // Non-blocking if RPC not yet applied
    }
  }, [user?.id]);

  useEffect(() => {
    loadCompleteness();
  }, [loadCompleteness, profile]);

  useFocusEffect(
    useCallback(() => {
      void loadCompleteness();
      void refreshProfile();
    }, [loadCompleteness, refreshProfile])
  );

  useEffect(() => {
    let alive = true;
    adminService.isAdmin().then(async (allowed) => {
      const isSuper = allowed ? await adminService.isSuperAdmin() : false;
      if (alive) {
        setIsAdmin(isSuper);
        if (isSuper) {
          router.replace('/admin/dashboard');
        }
      }
    }).catch(() => { if (alive) setIsAdmin(false); });
    return () => { alive = false; };
  }, [user?.id, router]);

  const handleSignOut = async (scope: 'local' | 'global' = 'local') => {
    if (loggingOut) return;
    try {
      const confirmed = await runConfirmedLogout({
        requestConfirmation: () => confirmDialog({
          title: strings.auth.logoutConfirmTitle,
          message: scope === 'global' ? strings.auth.logoutAllConfirmMessage : strings.auth.logoutConfirmMessage,
          confirmText: scope === 'global' ? strings.auth.logoutAllConfirmYes : strings.auth.logoutConfirmYes,
          cancelText: strings.common.cancel,
          destructive: true,
        }),
        signOut: () => signOut({ scope, reason: 'user' }),
        onConfirmed: () => setLoggingOut(true),
      });
      if (!confirmed) return;
      router.replace('/(auth)/login');
    } catch (err: any) {
      setPhotoError(mapSqlErrorToFriendlyMessage(err, 'Could not sign out.'));
    } finally {
      setLoggingOut(false);
    }
  };

  const handlePickAvatar = async (source: 'library' | 'camera') => {
    if (!user || photoBusy) return;
    setPhotoError(null);
    setShowPhotoMenu(false);
    setPhotoBusy(true);
    try {
      const url = await profileService.pickAndUploadAvatar(user.id, source);
      if (url) {
        await refreshProfile();
        await loadCompleteness();
      }
    } catch (err: any) {
      setPhotoError(mapSqlErrorToFriendlyMessage(err, 'Could not upload profile photo.'));
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleRemoveAvatar = async () => {
    if (!user || photoBusy) return;
    setPhotoError(null);
    setShowPhotoMenu(false);
    setPhotoBusy(true);
    try {
      await profileService.removeAvatar(user.id);
      await refreshProfile();
      await loadCompleteness();
    } catch (err: any) {
      setPhotoError(mapSqlErrorToFriendlyMessage(err, 'Could not remove profile photo.'));
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleMissingItemPress = (item: CompletenessMissingItem) => {
    if (item.key === 'photo') {
      setShowPhotoMenu(true);
      handlePickAvatar('library');
      return;
    }
    if (item.key === 'skills') {
      router.push('/profile/skills');
      return;
    }
    router.push({ pathname: '/profile/edit', params: { focus: item.key } });
  };

  const displayName = profile?.display_name || 'No name set';
  const isHire = profile?.active_mode === 'hire';

  // Show the rating and completed count for the side the person is currently on.
  const mainRating = isHire ? profile?.client_rating_avg : profile?.freelancer_rating_avg;
  const mainRatingCount = isHire ? profile?.client_rating_count : profile?.freelancer_rating_count;
  const mainCompleted = isHire ? profile?.client_completed_gigs : profile?.freelancer_completed_gigs;
  const otherLabel = isHire ? 'As freelancer' : 'As client';
  const otherRating = isHire ? profile?.freelancer_rating_avg : profile?.client_rating_avg;
  const otherCount = isHire ? profile?.freelancer_rating_count : profile?.client_rating_count;

  const goEdit = () => router.push('/profile/edit');
  const goMode = () => router.push('/settings/mode');
  const goSkills = () => router.push('/profile/skills');
  
  const handleRunAiScreening = async () => {
    if (!profile || screeningBusy) return;
    setScreeningBusy(true);
    try {
      const evaluation = await aiLegitimacyService.submitForReview(profile);
      await refreshProfile();
      await confirmDialog({
        title: 'AI Screening Complete',
        message: `Score: ${evaluation.score}%\n\n${evaluation.aiSummary}\n\nYour account has been submitted to the Super Admin review queue for final human approval.`,
        confirmText: 'Done',
      });
      await refreshProfile();
    } catch (err: any) {
      await confirmDialog({
        title: 'Screening Note',
        message: err?.message || 'Could not complete AI screening.',
        confirmText: 'OK',
      });
    } finally {
      setScreeningBusy(false);
    }
  };

  const goPortfolio = () => router.push('/profile/portfolio');
  const goPublic = () => user && router.push({ pathname: '/profile/[id]', params: { id: user.id } });

  return (
    <ScreenBackground>
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            isWide && { paddingTop: 24, paddingHorizontal: 28 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View
            style={[
              styles.hero,
              {
                backgroundColor: theme.colors.heroBg,
                paddingTop: isWide ? 32 : topSpace + 8,
              },
              isWide && styles.heroWide,
            ]}
          >
            <Avatar
              name={displayName}
              imageUri={profile?.avatar_path || profile?.avatar_url}
              size={80}
              onHero
              editable
              onPress={() => setShowPhotoMenu((prev) => !prev)}
            />
            {photoBusy ? (
              <ActivityIndicator color={theme.colors.heroText} style={{ marginTop: 8 }} />
            ) : null}

            <View style={styles.nameRow}>
              <Text style={[theme.type.title, { color: theme.colors.heroText }]}>{displayName}</Text>
              {profile?.is_legit_verified ? <LegitBadge size="small" role={profile.active_mode} /> : null}
              {completeness?.complete ? <ProfileCompleteBadge onHero /> : null}
            </View>

            {profile?.headline ? (
              <Text style={[theme.type.body, { color: theme.colors.heroMuted, marginTop: 4, textAlign: 'center' }]}>
                {profile.headline}
              </Text>
            ) : null}

            <Text style={[theme.type.small, { color: theme.colors.heroMuted, marginTop: 2 }]}>
              {user?.email || 'Unknown'}
            </Text>

            <View style={styles.heroMeta}>
              <View style={[styles.heroChip, { backgroundColor: theme.colors.heroChip }]}>
                <View style={[styles.roleDot, { backgroundColor: isAdmin ? '#F59E0B' : theme.colors.roleAccent }]} />
                <Ionicons name={isAdmin ? 'shield-checkmark' : isHire ? 'people' : 'search'} size={13} color={theme.colors.heroText} />
                <Text style={[styles.heroChipText, { color: theme.colors.heroText }]}>
                  {isAdmin
                    ? 'Super Admin'
                    : profile?.active_mode === 'find_work'
                    ? 'Freelancer'
                    : isHire
                    ? 'Client'
                    : 'No mode selected'}
                </Text>
              </View>
              {profile?.area ? (
                <View style={[styles.heroChip, { backgroundColor: theme.colors.heroChip }]}>
                  <Ionicons name="location" size={13} color={theme.colors.heroText} />
                  <Text style={[styles.heroChipText, { color: theme.colors.heroText }]}>{profile.area}</Text>
                </View>
              ) : null}
            </View>
          </View>

          <View style={[styles.body, isWide && { paddingHorizontal: 0 }]}>
            {photoError ? (
              <AlertBox tone="danger" message={photoError} style={{ marginBottom: 14 }} />
            ) : null}

            {showPhotoMenu ? (
              <Card tone="raised" padding="md" style={styles.photoMenuCard}>
                <Text style={[theme.type.bodyStrong, { color: theme.colors.text, marginBottom: 10 }]}>
                  {strings.profile.photoSectionTitle}
                </Text>
                <View style={styles.photoMenuBtns}>
                  <Button
                    title={strings.profile.chooseFromLibraryBtn}
                    variant="secondary"
                    size="sm"
                    icon="images-outline"
                    onPress={() => handlePickAvatar('library')}
                    disabled={photoBusy}
                  />

                  {Platform.OS !== 'web' ? (
                    <Button
                      title={strings.profile.takePhotoBtn}
                      variant="secondary"
                      size="sm"
                      icon="camera-outline"
                      onPress={() => handlePickAvatar('camera')}
                      disabled={photoBusy}
                    />
                  ) : null}

                  {profile?.avatar_path || profile?.avatar_url ? (
                    <Button
                      title={strings.profile.removePhotoBtn}
                      variant="danger-soft"
                      size="sm"
                      icon="trash-outline"
                      onPress={handleRemoveAvatar}
                      disabled={photoBusy}
                    />
                  ) : null}
                </View>
              </Card>
            ) : null}

            <View style={isDesktop ? styles.desktopTwoCol : undefined}>
              {/* Left Column on Desktop: Role Switcher + Completeness + Stats */}
              <View style={isDesktop ? styles.desktopLeftCol : undefined}>
                {/* Platform Super Admin Quick-Access Card */}
                {isAdmin ? (
                  <Card tone="raised" padding="md" style={{ marginBottom: 12, borderColor: '#F59E0B', borderWidth: 1.5, backgroundColor: theme.colors.surfaceAlt }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 200 }}>
                        <Ionicons name="shield-checkmark" size={26} color="#D97706" />
                        <View style={{ flex: 1 }}>
                          <Text style={[theme.type.bodyStrong, { color: theme.colors.text }]}>Platform Super Admin</Text>
                          <Text style={[theme.type.small, { color: theme.colors.muted }]}>
                            Full administrative privileges: user moderation, bans, appeals, and system audit trail.
                          </Text>
                        </View>
                      </View>
                      <Button
                        title="Open Admin Console"
                        variant="primary"
                        size="sm"
                        icon="speedometer-outline"
                        onPress={() => router.push('/admin/dashboard')}
                      />
                    </View>
                  </Card>
                ) : null}

                {/* Account Legitimacy Review Card (ordinary users only) */}
                {!isAdmin ? (
                  <Card tone="raised" padding="md" style={{ marginBottom: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                        <Ionicons
                          name="shield-checkmark"
                          size={20}
                          color={profile?.is_legit_verified ? theme.colors.primary : theme.colors.warning}
                        />
                        <Text style={[theme.type.bodyStrong, { color: theme.colors.text }]}>
                          Account Legitimacy
                        </Text>
                      </View>
                      {profile?.is_legit_verified ? (
                        <LegitBadge size="small" role={profile?.active_mode} />
                      ) : (
                        <View style={{ backgroundColor: theme.colors.warningSoft, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: theme.colors.warningText }}>
                            {profile?.verification_status === 'ai_flagged' || profile?.verification_status === 'pending' ? 'In Review' : 'Not Reviewed'}
                          </Text>
                        </View>
                      )}
                    </View>

                    {profile?.is_legit_verified ? (
                      <Text style={[theme.type.small, { color: theme.colors.successText, marginTop: 6 }]}>
                        Certified by Super Admin. Your account displays the official Legit Badge across all gigs, proposals, and reports.
                      </Text>
                    ) : profile?.verification_status === 'ai_flagged' || profile?.verification_status === 'pending' ? (
                      <View style={{ gap: 8, marginTop: 6 }}>
                        <Text style={[theme.type.small, { color: theme.colors.muted }]}>
                          AI Screening complete (Score: {profile?.ai_legitimacy_score || profile?.legitimacy_score || 85}%). Account is in the Super Admin queue awaiting human confirmation.
                        </Text>
                        <Button
                          title="Re-run AI Screening"
                          variant="secondary"
                          size="sm"
                          icon="sparkles-outline"
                          loading={screeningBusy}
                          onPress={handleRunAiScreening}
                        />
                      </View>
                    ) : (
                      <View style={{ gap: 8, marginTop: 6 }}>
                        <Text style={[theme.type.small, { color: theme.colors.muted }]}>
                          AI evaluates your qualifications and reports to the Super Admin for human review.
                        </Text>
                        <Button
                          title="Run AI Check & Submit to Admin"
                          variant="ai"
                          size="sm"
                          loading={screeningBusy}
                          onPress={handleRunAiScreening}
                        />
                      </View>
                    )}
                  </Card>
                ) : null}

                {/* Prominent Role Mode Switcher Card (regular users only) */}
                {!isAdmin ? (
                  <Card
                    tone="raised"
                    padding="md"
                    onPress={goMode}
                    style={styles.roleSwitcherCard}
                  >
                    <View
                      style={[
                        styles.roleSwitcherIconWrap,
                        { backgroundColor: theme.colors.primarySoft },
                      ]}
                    >
                      <Ionicons
                        name={isHire ? 'people' : 'briefcase'}
                        size={22}
                        color={theme.colors.primary}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.roleSwitcherLabel, { color: theme.colors.muted }]}>
                        Active Workspace Mode
                      </Text>
                      <Text style={[styles.roleSwitcherTitle, { color: theme.colors.text }]}>
                        {isHire ? 'Client (Hiring Mode)' : 'Freelancer (Find Work Mode)'}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.roleSwitcherActionPill,
                        { backgroundColor: theme.colors.primarySoft },
                      ]}
                    >
                      <Ionicons name="swap-horizontal" size={14} color={theme.colors.primary} />
                      <Text style={[styles.roleSwitcherActionText, { color: theme.colors.primary }]}>
                        Switch
                      </Text>
                    </View>
                  </Card>
                ) : null}

                {!isAdmin ? (
                  <ProfileCompletenessCard
                    completeness={completeness}
                    onSelectMissingItem={handleMissingItemPress}
                  />
                ) : null}

                <View style={styles.statsRow}>
                  <StatBox
                    label={`${mainRatingCount || 0} ${mainRatingCount === 1 ? 'review' : 'reviews'}`}
                    value={`★ ${Number(mainRating || 0).toFixed(1)}`}
                    icon="star"
                    tone="warning"
                  />
                  <StatBox
                    label="Gigs completed"
                    value={mainCompleted || 0}
                    icon="checkmark-done-circle-outline"
                    tone="success"
                  />
                </View>

                <Text style={[theme.type.small, { color: theme.colors.muted, marginBottom: 12 }]}>
                  {otherLabel}: ★ {Number(otherRating || 0).toFixed(1)} ({otherCount || 0})
                </Text>

                {profile?.bio ? (
                  <Card tone="raised" padding="md" style={{ marginBottom: 14 }}>
                    <Text style={[theme.type.bodyStrong, { color: theme.colors.text, marginBottom: 4 }]}>About</Text>
                    <Text style={[theme.type.body, { color: theme.colors.muted }]}>{profile.bio}</Text>
                  </Card>
                ) : null}
              </View>

              {/* Right Column on Desktop: Settings Menu & Logout */}
              <View style={isDesktop ? styles.desktopRightCol : undefined}>
                <Card tone="raised" padding="none" style={styles.menuCard}>
                  <ListRow
                    icon="create-outline"
                    title="Edit profile"
                    subtitle={
                      isHire
                        ? 'Name, photo, bio, area, hiring details'
                        : 'Name, photo, headline, bio, area, availability'
                    }
                    onPress={goEdit}
                  />
                  {isHire ? (
                    <>
                      {user ? <ListRow icon="eye-outline" title="View public profile" onPress={goPublic} /> : null}
                      {!isAdmin ? <ListRow icon="swap-horizontal-outline" title="Switch account mode" onPress={goMode} /> : null}
                    </>
                  ) : (
                    <>
                      <ListRow icon="construct-outline" title="Manage skills" onPress={goSkills} />
                      <ListRow icon="folder-open-outline" title="Portfolio" onPress={goPortfolio} />
                      {user ? <ListRow icon="eye-outline" title="View public profile" onPress={goPublic} /> : null}
                      {!isAdmin ? <ListRow icon="swap-horizontal-outline" title="Switch account mode" onPress={goMode} /> : null}
                    </>
                  )}
                  <ListRow
                    icon="phone-portrait-outline"
                    title={strings.auth.sessionsTitle}
                    subtitle={strings.auth.sessionsSubtitle}
                    onPress={() => router.push('/settings/sessions')}
                  />
                  <ListRow
                    icon="lock-closed-outline"
                    title={strings.auth.securitySettings}
                    subtitle={strings.auth.changePassword}
                    onPress={() => router.push('/settings/password')}
                  />
                  <ListRow
                    icon="mail-outline"
                    title="Account Email"
                    subtitle="Change email address"
                    onPress={() => router.push('/settings/email')}
                    last={!isAdmin}
                  />
                  {isAdmin ? <ListRow icon="shield-checkmark-outline" title={strings.admin.dashboard} onPress={() => router.push('/admin/dashboard')} last /> : null}
                </Card>

                <Button
                  title="Log out"
                  variant="danger-soft"
                  icon="log-out-outline"
                  onPress={() => handleSignOut('local')}
                  loading={loggingOut}
                  disabled={loggingOut}
                  style={{ marginBottom: 10 }}
                />
                <Button
                  title="Log out of all devices"
                  variant="ghost"
                  onPress={() => handleSignOut('global')}
                  disabled={loggingOut}
                />
              </View>
            </View>
          </View>
        </ScrollView>
      </View>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    paddingBottom: 64,
    maxWidth: 1120,
    width: '100%',
    alignSelf: 'center',
  },
  hero: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    alignItems: 'center',
  },
  heroWide: {
    borderRadius: 28,
    paddingHorizontal: 28,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  heroMeta: { flexDirection: 'row', gap: 8, marginTop: 16, flexWrap: 'wrap', justifyContent: 'center' },
  heroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  roleDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  heroChipText: { fontSize: 13, fontWeight: '700' },
  body: { padding: 20 },
  desktopTwoCol: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 24,
  },
  desktopLeftCol: {
    flex: 1,
  },
  desktopRightCol: {
    flex: 1.15,
  },
  roleSwitcherCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  roleSwitcherIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleSwitcherLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  roleSwitcherTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginTop: 2,
  },
  roleSwitcherActionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  roleSwitcherActionText: {
    fontSize: 13,
    fontWeight: '700',
  },
  photoMenuCard: {
    marginBottom: 16,
  },
  photoMenuBtns: {
    gap: 8,
  },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  menuCard: { overflow: 'hidden', marginBottom: 20 },
});
