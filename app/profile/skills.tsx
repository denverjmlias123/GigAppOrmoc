import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { useAuth } from '../../hooks/useAuth';
import { profileService, Skill } from '../../services/profile';
import { aiService } from '../../services/ai';
import { Button } from '../../components/ui/Button';
import { Card, AlertBox, PageHeaderBox } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { showToast } from '../../components/ui/Toast';
import { strings } from '../../constants/strings';

const MAX_PROFILE_SKILLS = 15;

export default function SkillsScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { bottomPad } = useResponsiveLayout();
  const { user, profile, refreshProfile } = useAuth();

  const isHire = profile?.active_mode === 'hire';

  const [availableSkills, setAvailableSkills] = useState<Skill[]>([]);
  const [userSkills, setUserSkills] = useState<Skill[]>([]);
  const [customSkillInput, setCustomSkillInput] = useState('');
  const [catalogFilter, setCatalogFilter] = useState('');
  const [addingCustom, setAddingCustom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skillsSaved, setSkillsSaved] = useState(false);
  const [zeroSkillsWarning, setZeroSkillsWarning] = useState(false);

  // AI skill suggestion state
  const [workDescription, setWorkDescription] = useState('');
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const loadData = async () => {
    if (!user || isHire) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [skills, mySkills] = await Promise.all([
        profileService.getSkills(),
        profileService.getUserSkills(user.id),
      ]);
      setAvailableSkills(skills);
      setUserSkills(mySkills);
    } catch (err: any) {
      setError(err?.message || 'Failed to load skills.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user, isHire]);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/profile');
    }
  };

  if (isHire) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <PageHeaderBox
          title="Freelancer Mode Only"
          subtitle="You are currently in Hire Someone (Client) mode. Clients set their hiring details and interests in Edit Profile instead."
          onBack={handleBack}
          maxWidth={920}
        />
        <View style={[styles.innerWrap, { paddingTop: 20 }]}>
          <Card tone="raised" padding="lg">
            <Button
              title="Edit Client Hiring Details"
              variant="primary"
              onPress={() => router.replace('/profile/edit')}
            />
          </Card>
        </View>
      </View>
    );
  }

  const toggleSkill = async (skill: Skill) => {
    if (!user) return;
    const isOwned = userSkills.some((s) => s.id === skill.id);
    setActionLoading(skill.id);
    setError(null);
    setSkillsSaved(false);

    try {
      if (isOwned) {
        await profileService.removeUserSkill(user.id, skill.id);
        const refreshed = await profileService.getUserSkills(user.id);
        setUserSkills(refreshed);
        setZeroSkillsWarning(refreshed.length === 0);
        await refreshProfile();
      } else {
        if (userSkills.length >= MAX_PROFILE_SKILLS) {
          setError(`Maximum limit of ${MAX_PROFILE_SKILLS} skills per profile reached.`);
          return;
        }
        await profileService.addUserSkill(user.id, skill.id);
        const refreshed = await profileService.getUserSkills(user.id);
        setUserSkills(refreshed);
        setZeroSkillsWarning(false);
        setSkillsSaved(true);
        showToast(strings.toasts.skillsSaved);
        await refreshProfile();
      }
    } catch (err: any) {
      setError(err?.message || 'Could not update skill.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleAddCustomSkill = async () => {
    if (!user || addingCustom) return;
    setError(null);
    setSkillsSaved(false);

    const validation = profileService.validateSkillName(customSkillInput);
    if (!validation.valid) {
      setError(validation.error || 'Invalid skill name.');
      return;
    }

    const normalized = validation.normalized;
    const lower = normalized.toLowerCase();

    if (userSkills.some((s) => s.name.trim().toLowerCase() === lower)) {
      setCustomSkillInput('');
      setSkillsSaved(true);
      return;
    }

    if (userSkills.length >= MAX_PROFILE_SKILLS) {
      setError(`Maximum limit of ${MAX_PROFILE_SKILLS} skills per profile reached.`);
      return;
    }

    setAddingCustom(true);
    try {
      await profileService.addProfileSkills([], [normalized]);
      // Re-fetch authoritative saved skills from the database
      const [skills, refreshed] = await Promise.all([
        profileService.getSkills(),
        profileService.getUserSkills(user.id),
      ]);
      setAvailableSkills(skills);
      setUserSkills(refreshed);
      setCustomSkillInput('');
      setZeroSkillsWarning(false);
      setSkillsSaved(true);
      showToast(strings.toasts.skillsSaved);
      await refreshProfile();
    } catch (err: any) {
      setError(err?.message || 'Could not add custom skill.');
    } finally {
      setAddingCustom(false);
    }
  };

  const handleSuggestSkills = async () => {
    if (!workDescription.trim()) {
      setAiError('Please enter a short description of the work you do.');
      return;
    }

    setAiLoading(true);
    setAiError(null);
    try {
      const suggestions = await aiService.suggestSkills(workDescription);
      setAiSuggestions(suggestions);
    } catch (err: any) {
      setAiError(err?.message || 'Could not fetch suggestions. You can add skills manually below.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleToggleAiSkill = async (skillName: string) => {
    if (!user) return;
    const lower = skillName.trim().toLowerCase();
    const existingOwned = userSkills.find((s) => s.name.trim().toLowerCase() === lower);

    if (existingOwned) {
      await toggleSkill(existingOwned);
      return;
    }

    if (userSkills.length >= MAX_PROFILE_SKILLS) {
      setError(`Maximum limit of ${MAX_PROFILE_SKILLS} skills per profile reached.`);
      return;
    }

    setActionLoading(`ai-${lower}`);
    setError(null);
    setSkillsSaved(false);
    try {
      await profileService.addProfileSkills([], [skillName.trim()]);
      const [skills, refreshed] = await Promise.all([
        profileService.getSkills(),
        profileService.getUserSkills(user.id),
      ]);
      setAvailableSkills(skills);
      setUserSkills(refreshed);
      setZeroSkillsWarning(false);
      setSkillsSaved(true);
      showToast(strings.toasts.skillsSaved);
      await refreshProfile();
    } catch (err: any) {
      setError(err?.message || 'Could not add suggested skill.');
    } finally {
      setActionLoading(null);
    }
  };

  const filteredCatalog = catalogFilter.trim()
    ? availableSkills.filter((s) =>
        s.name.toLowerCase().includes(catalogFilter.trim().toLowerCase())
      )
    : availableSkills;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <PageHeaderBox
        title="Manage Skills"
        subtitle="Select skills from the catalog, use AI suggestions, or add custom skills to display on your freelancer profile (up to 15)."
        onBack={handleBack}
        maxWidth={920}
      />

      <View style={styles.innerWrap}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={[
              styles.skillsContent,
              { paddingBottom: Math.max(bottomPad, 32) },
            ]}
            keyboardShouldPersistTaps="handled"
          >
            {error && <AlertBox tone="danger" message={error} style={{ marginBottom: 12 }} />}

            {(zeroSkillsWarning || (!loading && userSkills.length === 0)) && (
              <AlertBox
                tone="warning"
                message={strings.onboarding.zeroSkillsWarning}
                style={{ marginBottom: 12 }}
              />
            )}

            {/* Top "Your skills (n/15)" Tray */}
            <Card tone="raised" padding="md" style={styles.card}>
              <View style={styles.trayHeaderRow}>
                <Text style={[styles.sectionTitle, { color: theme.colors.text, marginBottom: 0 }]}>
                  {strings.onboarding.yourSkillsTrayLabel} ({userSkills.length}/{MAX_PROFILE_SKILLS})
                </Text>
                {skillsSaved && (
                  <View style={[styles.savedBadge, { backgroundColor: theme.colors.successSoft }]}>
                    <Text style={[styles.savedBadgeText, { color: theme.colors.successText }]}>
                      ✓ {strings.onboarding.skillsSavedText}
                    </Text>
                  </View>
                )}
              </View>

              {userSkills.length > 0 ? (
                <View style={[styles.chipGrid, { marginTop: 12 }]}>
                  {userSkills.map((skill) => {
                    const isBusy = actionLoading === skill.id;
                    const isPendingReview = skill.source === 'user' && skill.is_active === false;

                    return (
                      <TouchableOpacity
                        key={skill.id}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: theme.colors.primary,
                            borderColor: theme.colors.primary,
                          },
                        ]}
                        onPress={() => toggleSkill(skill)}
                        disabled={isBusy}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            { color: theme.colors.primaryContrast, marginRight: 6 },
                          ]}
                        >
                          {skill.name}
                        </Text>
                        {isPendingReview && (
                          <View style={styles.pendingPill}>
                            <Text
                              style={[
                                styles.pendingPillText,
                                { color: theme.colors.primaryContrast },
                              ]}
                            >
                              {strings.onboarding.pendingReviewBadge}
                            </Text>
                          </View>
                        )}
                        <Text style={{ color: theme.colors.primaryContrast, fontWeight: '700' }}>
                          ×
                        </Text>
                        {isBusy && (
                          <ActivityIndicator
                            size="small"
                            color={theme.colors.primaryContrast}
                            style={{ marginLeft: 6 }}
                          />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : (
                <Text style={[styles.subtitle, { color: theme.colors.muted, marginTop: 8 }]}>
                  {strings.onboarding.yourSkillsEmptyHint}
                </Text>
              )}
            </Card>

            {/* Add Custom Skill Input */}
            <Card tone="raised" padding="md" style={styles.card}>
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                Add Custom Skill
              </Text>
              <View style={styles.customRow}>
                <TextInput
                  style={[
                    styles.customInput,
                    {
                      borderColor: theme.colors.border,
                      color: theme.colors.text,
                      backgroundColor: theme.colors.surfaceAlt,
                    },
                  ]}
                  placeholder={strings.onboarding.addCustomSkillPlaceholder}
                  placeholderTextColor={theme.colors.muted}
                  value={customSkillInput}
                  onChangeText={setCustomSkillInput}
                  maxLength={40}
                />
                <Button
                  title="Add"
                  size="sm"
                  fullWidth={false}
                  onPress={handleAddCustomSkill}
                  disabled={addingCustom}
                  loading={addingCustom}
                />
              </View>
            </Card>

            {/* AI Skill Suggestions */}
            <Card tone="raised" padding="md" style={styles.card}>
              <Text style={[styles.sectionTitle, { color: theme.colors.text, marginBottom: 4 }]}>
                Suggest Skills with AI
              </Text>
              <Text style={[styles.subtitle, { color: theme.colors.muted, marginBottom: 10 }]}>
                Describe what you do in plain words to get skill suggestions.
              </Text>
              <TextInput
                style={[
                  styles.customInput,
                  {
                    borderColor: theme.colors.border,
                    color: theme.colors.text,
                    backgroundColor: theme.colors.surfaceAlt,
                    marginBottom: 10,
                    flex: 0,
                  },
                ]}
                placeholder={strings.onboarding.aiSkillsPlaceholder}
                placeholderTextColor={theme.colors.muted}
                value={workDescription}
                onChangeText={setWorkDescription}
              />
              {aiError && <AlertBox tone="danger" message={aiError} style={{ marginBottom: 8 }} />}
              <Button
                title={aiLoading ? strings.onboarding.suggestingSkills : strings.onboarding.suggestSkillsBtn}
                variant="soft"
                icon="sparkles-outline"
                onPress={handleSuggestSkills}
                disabled={aiLoading}
                loading={aiLoading}
              />

              {aiSuggestions.length > 0 && (
                <View style={[styles.chipGrid, { marginTop: 12 }]}>
                  {aiSuggestions.map((sug) => {
                    const lower = sug.trim().toLowerCase();
                    const selected = userSkills.some((s) => s.name.trim().toLowerCase() === lower);
                    const isBusy = actionLoading === `ai-${lower}`;
                    return (
                      <Chip
                        key={sug}
                        label={`${selected ? '✓ ' : '+ '}${sug}`}
                        selected={selected}
                        disabled={isBusy}
                        onPress={() => handleToggleAiSkill(sug)}
                      />
                    );
                  })}
                </View>
              )}
            </Card>

            {/* Skills Catalog */}
            {availableSkills.length > 0 ? (
              <Card tone="raised" padding="md" style={styles.card}>
                <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                  Skills Catalog
                </Text>
                <TextInput
                  style={[
                    styles.customInput,
                    {
                      borderColor: theme.colors.border,
                      color: theme.colors.text,
                      backgroundColor: theme.colors.surfaceAlt,
                      marginBottom: 12,
                      flex: 0,
                    },
                  ]}
                  placeholder="Filter catalog skills..."
                  placeholderTextColor={theme.colors.muted}
                  value={catalogFilter}
                  onChangeText={setCatalogFilter}
                />
                <View style={styles.chipGrid}>
                  {filteredCatalog.map((skill) => {
                    const selected = userSkills.some((s) => s.id === skill.id);
                    const isBusy = actionLoading === skill.id;

                    return (
                      <Chip
                        key={skill.id}
                        label={`${selected ? '✓ ' : '+ '}${skill.name}`}
                        selected={selected}
                        disabled={isBusy}
                        onPress={() => toggleSkill(skill)}
                      />
                    );
                  })}
                </View>
              </Card>
            ) : null}
          </ScrollView>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  innerWrap: {
    flex: 1,
    maxWidth: 1120,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 20,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  card: {
    marginBottom: 16,
  },
  trayHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  savedBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  savedBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  pendingPill: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    marginRight: 6,
  },
  pendingPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  customRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  customInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skillsContent: {
    paddingTop: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
