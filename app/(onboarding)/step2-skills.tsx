import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { useAuth } from '../../hooks/useAuth';
import { profileService, Skill, Category } from '../../services/profile';
import { aiService } from '../../services/ai';
import { strings } from '../../constants/strings';
import { confirmDialog } from '../../lib/dialog';
import { runConfirmedLogout } from '../../utils/confirmedLogout';
import { toAppError } from '../../lib/errors';
import { ClientHiringDetailsCard } from '../../components/onboarding/ClientHiringDetailsCard';
import { FreelancerSkillSections } from '../../components/onboarding/FreelancerSkillSections';
import { Card, AlertBox, StickyFooterBox } from '../../components/ui/Card';
import { Button, IconButton } from '../../components/ui/Button';

const MAX_HIRING_INTERESTS = 8;
const MAX_PROFILE_SKILLS = 15;

export default function OnboardingStep2SkillsScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { isWide, topSpace } = useResponsiveLayout();
  const { profile, refreshProfile, signOut } = useAuth();

  const isHire = profile?.active_mode === 'hire';

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

  // --- FREELANCER STATE (active_mode === 'find_work') ---
  const [catalogSkills, setCatalogSkills] = useState<Skill[]>([]);
  const [savedSkills, setSavedSkills] = useState<Skill[]>([]);
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogAttempt, setCatalogAttempt] = useState(0);

  const [workDescription, setWorkDescription] = useState('');
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [selectedAiSkills, setSelectedAiSkills] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [customInput, setCustomInput] = useState('');
  const [customSkills, setCustomSkills] = useState<string[]>([]);
  const [skillsSaved, setSkillsSaved] = useState(false);
  const [zeroSkillsWarning, setZeroSkillsWarning] = useState(false);

  // --- CLIENT STATE (active_mode === 'hire') ---
  const [clientType, setClientType] = useState<
    'individual' | 'business' | 'organization' | 'other' | ''
  >(profile?.client_type || '');
  const [businessName, setBusinessName] = useState(profile?.business_name || '');
  const [aboutHiring, setAboutHiring] = useState(profile?.about_hiring || '');
  const [catalogCategories, setCatalogCategories] = useState<Category[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [helpDescription, setHelpDescription] = useState('');
  const [aiCategorySuggestions, setAiCategorySuggestions] = useState<string[]>([]);
  const [selectedCustomCategories, setSelectedCustomCategories] = useState<string[]>([]);
  const [customCategoryInput, setCustomCategoryInput] = useState('');

  // Submitting state & concurrency guard
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const inFlightRef = useRef(false);

  const handleSignOut = async () => {
    if (signingOut) return;
    try {
      const confirmed = await runConfirmedLogout({
        requestConfirmation: () =>
          confirmDialog({
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

  useEffect(() => {
    let mounted = true;
    const fetchCatalog = async () => {
      setLoading(true);
      setCatalogError(null);
      try {
        if (isHire) {
          const cats = await profileService.getCategories();
          if (mounted) {
            setCatalogCategories(cats || []);
          }
        } else {
          const [skillsData, mySavedSkills] = await Promise.all([
            profileService.getSkills(),
            profile?.id ? profileService.getUserSkills(profile.id) : Promise.resolve([]),
          ]);
          if (mounted) {
            setCatalogSkills(skillsData || []);
            setSavedSkills(mySavedSkills || []);
          }
        }
      } catch (err: any) {
        if (mounted) {
          const appErr = toAppError(err);
          setCatalogError(appErr.message || 'Could not load your skills and categories.');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchCatalog();
    return () => {
      mounted = false;
    };
  }, [isHire, profile?.id, catalogAttempt]);

  // Compute unified "Your skills (n)" tray items (saved + catalog + AI + typed, case-insensitively deduplicated)
  const selectedSkillTray = useMemo(() => {
    const items: Array<{
      key: string;
      name: string;
      origin: 'saved' | 'catalog' | 'ai' | 'custom';
      skillId?: string;
      isPendingReview?: boolean;
    }> = [];
    const seenLower = new Set<string>();

    for (const s of savedSkills) {
      const lower = s.name.trim().toLowerCase();
      if (!seenLower.has(lower)) {
        seenLower.add(lower);
        items.push({
          key: `saved-${s.id}`,
          name: s.name,
          origin: 'saved',
          skillId: s.id,
          isPendingReview: s.source === 'user' && s.is_active === false,
        });
      }
    }

    for (const catId of selectedCatalogIds) {
      const catSkill = catalogSkills.find((c) => c.id === catId);
      if (catSkill) {
        const lower = catSkill.name.trim().toLowerCase();
        if (!seenLower.has(lower)) {
          seenLower.add(lower);
          items.push({
            key: `cat-${catSkill.id}`,
            name: catSkill.name,
            origin: 'catalog',
            skillId: catSkill.id,
          });
        }
      }
    }

    for (const aiName of selectedAiSkills) {
      const lower = aiName.trim().toLowerCase();
      if (!seenLower.has(lower)) {
        seenLower.add(lower);
        items.push({
          key: `ai-${lower}`,
          name: aiName.trim(),
          origin: 'ai',
        });
      }
    }

    for (const cName of customSkills) {
      const lower = cName.trim().toLowerCase();
      if (!seenLower.has(lower)) {
        seenLower.add(lower);
        items.push({
          key: `custom-${lower}`,
          name: cName.trim(),
          origin: 'custom',
        });
      }
    }

    return items;
  }, [savedSkills, selectedCatalogIds, catalogSkills, selectedAiSkills, customSkills]);

  // --- FREELANCER HANDLERS ---
  const toggleCatalogSkill = (id: string) => {
    setSaveError(null);
    setSkillsSaved(false);
    setZeroSkillsWarning(false);

    const alreadySaved = savedSkills.find((s) => s.id === id);
    if (alreadySaved) {
      handleRemoveTrayItem({
        key: `saved-${id}`,
        name: alreadySaved.name,
        origin: 'saved',
        skillId: id,
      });
      return;
    }

    if (selectedCatalogIds.includes(id)) {
      setSelectedCatalogIds((prev) => prev.filter((s) => s !== id));
      return;
    }

    if (selectedSkillTray.length >= MAX_PROFILE_SKILLS) {
      setSaveError(`Maximum limit of ${MAX_PROFILE_SKILLS} skills per profile reached.`);
      return;
    }

    setSelectedCatalogIds((prev) => [...prev, id]);
  };

  const toggleAiSkill = (skill: string) => {
    setSaveError(null);
    setSkillsSaved(false);
    setZeroSkillsWarning(false);

    const lower = skill.trim().toLowerCase();
    const savedMatch = savedSkills.find((s) => s.name.trim().toLowerCase() === lower);
    if (savedMatch) {
      handleRemoveTrayItem({
        key: `saved-${savedMatch.id}`,
        name: savedMatch.name,
        origin: 'saved',
        skillId: savedMatch.id,
      });
      return;
    }

    const exists = selectedAiSkills.some((s) => s.trim().toLowerCase() === lower);
    if (exists) {
      setSelectedAiSkills((prev) => prev.filter((s) => s.trim().toLowerCase() !== lower));
      return;
    }

    if (selectedSkillTray.length >= MAX_PROFILE_SKILLS) {
      setSaveError(`Maximum limit of ${MAX_PROFILE_SKILLS} skills per profile reached.`);
      return;
    }

    setSelectedAiSkills((prev) => [...prev, skill.trim()]);
  };

  const handleAddCustomSkill = () => {
    setSaveError(null);
    setSkillsSaved(false);
    setZeroSkillsWarning(false);

    const validation = profileService.validateSkillName(customInput);
    if (!validation.valid) {
      setSaveError(validation.error || 'Invalid skill name.');
      triggerShake();
      return;
    }

    const normalized = validation.normalized;
    const lower = normalized.toLowerCase();

    if (selectedSkillTray.some((item) => item.name.trim().toLowerCase() === lower)) {
      setCustomInput('');
      return;
    }

    if (selectedSkillTray.length >= MAX_PROFILE_SKILLS) {
      setSaveError(`Maximum limit of ${MAX_PROFILE_SKILLS} skills per profile reached.`);
      triggerShake();
      return;
    }

    const catalogMatch = catalogSkills.find((c) => c.name.trim().toLowerCase() === lower);
    if (catalogMatch) {
      setSelectedCatalogIds((prev) => [...prev, catalogMatch.id]);
    } else {
      setCustomSkills((prev) => [...prev, normalized]);
    }
    setCustomInput('');
  };

  const handleRemoveTrayItem = async (item: {
    key: string;
    name: string;
    origin: 'saved' | 'catalog' | 'ai' | 'custom';
    skillId?: string;
  }) => {
    setSaveError(null);
    setSkillsSaved(false);

    if (item.origin === 'saved' && item.skillId && profile?.id) {
      setSaving(true);
      try {
        await profileService.removeUserSkill(profile.id, item.skillId);
        const refreshed = await profileService.getUserSkills(profile.id);
        setSavedSkills(refreshed);
        const remainingTotal =
          refreshed.length +
          selectedCatalogIds.length +
          selectedAiSkills.length +
          customSkills.length;
        setZeroSkillsWarning(remainingTotal === 0);
      } catch (err: any) {
        const appErr = toAppError(err);
        setSaveError(appErr.message || 'Could not remove skill.');
      } finally {
        setSaving(false);
      }
      return;
    }

    if (item.origin === 'catalog' && item.skillId) {
      setSelectedCatalogIds((prev) => prev.filter((id) => id !== item.skillId));
    } else if (item.origin === 'ai') {
      setSelectedAiSkills((prev) =>
        prev.filter((s) => s.trim().toLowerCase() !== item.name.trim().toLowerCase())
      );
    } else if (item.origin === 'custom') {
      setCustomSkills((prev) =>
        prev.filter((s) => s.trim().toLowerCase() !== item.name.trim().toLowerCase())
      );
    }
  };

  const handleSuggestSkills = async () => {
    if (!workDescription.trim()) {
      setAiError('Please enter a short description of the work you do.');
      return;
    }

    setAiLoading(true);
    setAiError(null);
    setSkillsSaved(false);
    try {
      const suggestions = await aiService.suggestSkills(workDescription);
      setAiSuggestions(suggestions);

      const existingLower = new Set(
        selectedSkillTray.map((item) => item.name.trim().toLowerCase())
      );
      const nextAi = [...selectedAiSkills];
      for (const sug of suggestions) {
        if (existingLower.size >= MAX_PROFILE_SKILLS) break;
        const clean = sug.trim();
        const lower = clean.toLowerCase();
        if (!existingLower.has(lower)) {
          existingLower.add(lower);
          nextAi.push(clean);
        }
      }
      setSelectedAiSkills(nextAi);
    } catch (err: any) {
      const appErr = toAppError(err);
      setAiError(appErr.message || 'Could not fetch suggestions. You can add skills manually below.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleSaveSkills = async (): Promise<boolean> => {
    if (!profile?.id || inFlightRef.current) return false;
    setSaveError(null);
    setZeroSkillsWarning(false);

    const customNamesToSave = Array.from(new Set([...selectedAiSkills, ...customSkills]));
    if (selectedCatalogIds.length === 0 && customNamesToSave.length === 0) {
      if (savedSkills.length > 0) {
        setSkillsSaved(true);
        return true;
      }
      setSaveError('Please select or add at least 1 skill to save, or tap Skip for now.');
      triggerShake();
      return false;
    }

    inFlightRef.current = true;
    setSaving(true);
    try {
      await profileService.addProfileSkills(selectedCatalogIds, customNamesToSave);
      const refreshedFromDb = await profileService.getUserSkills(profile.id);
      setSavedSkills(refreshedFromDb);
      setSelectedCatalogIds([]);
      setSelectedAiSkills([]);
      setCustomSkills([]);
      setSkillsSaved(true);
      await refreshProfile();
      return true;
    } catch (err: any) {
      const appErr = toAppError(err);
      setSaveError(appErr.message || 'Failed to save skills. Please retry or skip for now.');
      triggerShake();
      return false;
    } finally {
      inFlightRef.current = false;
      setSaving(false);
    }
  };

  // --- CLIENT HANDLERS ---
  const totalSelectedInterests =
    selectedCategoryIds.length + selectedCustomCategories.length;

  const toggleCatalogCategory = (id: string) => {
    setSaveError(null);
    if (selectedCategoryIds.includes(id)) {
      setSelectedCategoryIds((prev) => prev.filter((c) => c !== id));
      return;
    }
    if (totalSelectedInterests >= MAX_HIRING_INTERESTS) {
      setSaveError(`You can select at most ${MAX_HIRING_INTERESTS} hiring interests.`);
      return;
    }
    setSelectedCategoryIds((prev) => [...prev, id]);
  };

  const toggleCustomCategory = (name: string) => {
    setSaveError(null);
    const exists = selectedCustomCategories.some(
      (c) => c.toLowerCase() === name.toLowerCase()
    );
    if (exists) {
      setSelectedCustomCategories((prev) =>
        prev.filter((c) => c.toLowerCase() !== name.toLowerCase())
      );
      return;
    }
    if (totalSelectedInterests >= MAX_HIRING_INTERESTS) {
      setSaveError(`You can select at most ${MAX_HIRING_INTERESTS} hiring interests.`);
      return;
    }
    setSelectedCustomCategories((prev) => [...prev, name]);
  };

  const handleAddCustomCategory = () => {
    const trimmed = customCategoryInput.trim();
    if (!trimmed) return;
    if (trimmed.length < 2 || trimmed.length > 50) {
      setSaveError('Category name must be between 2 and 50 characters.');
      return;
    }
    if (totalSelectedInterests >= MAX_HIRING_INTERESTS) {
      setSaveError(`You can select at most ${MAX_HIRING_INTERESTS} hiring interests.`);
      return;
    }
    const matchingCatalog = catalogCategories.find(
      (c) => c.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (matchingCatalog) {
      if (!selectedCategoryIds.includes(matchingCatalog.id)) {
        setSelectedCategoryIds((prev) => [...prev, matchingCatalog.id]);
      }
    } else if (
      !selectedCustomCategories.some((c) => c.toLowerCase() === trimmed.toLowerCase())
    ) {
      setSelectedCustomCategories((prev) => [...prev, trimmed]);
    }
    setCustomCategoryInput('');
    setSaveError(null);
  };

  const handleSuggestCategories = async () => {
    if (!helpDescription.trim()) {
      setAiError('Please describe what kind of help you usually look for.');
      return;
    }

    setAiLoading(true);
    setAiError(null);
    try {
      const suggestions = await aiService.suggestCategories(helpDescription);
      setAiCategorySuggestions(suggestions);

      const nextCatIds = [...selectedCategoryIds];
      const nextCustom = [...selectedCustomCategories];

      for (const s of suggestions) {
        if (nextCatIds.length + nextCustom.length >= MAX_HIRING_INTERESTS) break;
        const catalogMatch = catalogCategories.find(
          (c) => c.name.toLowerCase() === s.toLowerCase()
        );
        if (catalogMatch) {
          if (!nextCatIds.includes(catalogMatch.id)) {
            nextCatIds.push(catalogMatch.id);
          }
        } else if (!nextCustom.some((c) => c.toLowerCase() === s.toLowerCase())) {
          nextCustom.push(s);
        }
      }
      setSelectedCategoryIds(nextCatIds);
      setSelectedCustomCategories(nextCustom);
    } catch (err: any) {
      const appErr = toAppError(err);
      setAiError(
        appErr.message || 'Could not fetch category suggestions. You can pick or add categories below.'
      );
    } finally {
      setAiLoading(false);
    }
  };

  const handleContinue = async () => {
    if (inFlightRef.current || saving) return;
    setSaveError(null);

    if (isHire) {
      const trimmedBiz = businessName.trim();
      if (trimmedBiz.length > 0 && (trimmedBiz.length < 2 || trimmedBiz.length > 60)) {
        setSaveError('Business or organization name must be between 2 and 60 characters.');
        triggerShake();
        return;
      }
      const trimmedAbout = aboutHiring.trim();
      if (trimmedAbout.length > 300) {
        setSaveError('About hiring note must be 300 characters or fewer.');
        triggerShake();
        return;
      }
      if (totalSelectedInterests > MAX_HIRING_INTERESTS) {
        setSaveError(`You can select at most ${MAX_HIRING_INTERESTS} hiring interests.`);
        triggerShake();
        return;
      }

      const hasAnyInput =
        Boolean(clientType) ||
        trimmedBiz.length > 0 ||
        trimmedAbout.length > 0 ||
        selectedCategoryIds.length > 0 ||
        selectedCustomCategories.length > 0;

      if (!hasAnyInput) {
        router.push('/(onboarding)/step3-profile');
        return;
      }

      inFlightRef.current = true;
      setSaving(true);
      try {
        await profileService.saveHiringDetails({
          clientType: clientType || null,
          businessName: trimmedBiz,
          aboutHiring: trimmedAbout,
          categoryIds: selectedCategoryIds,
          customCategoryNames: selectedCustomCategories,
        });
        await refreshProfile();
        router.push('/(onboarding)/step3-profile');
      } catch (err: any) {
        const appErr = toAppError(err);
        setSaveError(appErr.message || 'Failed to save hiring details. Please retry or skip for now.');
        triggerShake();
      } finally {
        inFlightRef.current = false;
        setSaving(false);
      }
      return;
    }

    const customNamesToSave = Array.from(new Set([...selectedAiSkills, ...customSkills]));

    if (selectedCatalogIds.length === 0 && customNamesToSave.length === 0) {
      router.push('/(onboarding)/step3-profile');
      return;
    }

    const ok = await handleSaveSkills();
    if (ok) {
      router.push('/(onboarding)/step3-profile');
    }
  };

  const handleSkip = () => {
    if (saving) return;
    router.push('/(onboarding)/step3-profile');
  };

  const trayCard = (
    <Card
      headerTitle={`${strings.onboarding.yourSkillsTrayLabel} (${selectedSkillTray.length}/${MAX_PROFILE_SKILLS})`}
      headerIcon="ribbon-outline"
      headerRight={
        skillsSaved ? (
          <View style={[styles.savedBadge, { backgroundColor: theme.colors.successSoft }]}>
            <Text style={[styles.savedBadgeText, { color: theme.colors.successText }]}>
              ✓ {strings.onboarding.skillsSavedText}
            </Text>
          </View>
        ) : undefined
      }
      style={styles.card}
    >
      {zeroSkillsWarning && (
        <AlertBox
          tone="warning"
          message={strings.onboarding.zeroSkillsWarning}
          style={{ marginBottom: 12 }}
        />
      )}

      {selectedSkillTray.length === 0 ? (
        <Text style={[styles.cardDesc, { color: theme.colors.muted, marginBottom: 0 }]}>
          {strings.onboarding.yourSkillsEmptyHint}
        </Text>
      ) : (
        <>
          <View style={[styles.chipsWrap, { marginBottom: 14 }]}>
            {selectedSkillTray.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={[
                  styles.chip,
                  {
                    backgroundColor:
                      item.origin === 'saved'
                        ? theme.colors.primary
                        : theme.colors.primarySoft,
                    borderColor: theme.colors.primary,
                    flexDirection: 'row',
                    alignItems: 'center',
                  },
                ]}
                onPress={() => handleRemoveTrayItem(item)}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel={`Remove skill ${item.name}`}
              >
                <Text
                  style={[
                    styles.chipText,
                    {
                      color: item.origin === 'saved' ? theme.colors.heroText : theme.colors.primary,
                      fontWeight: '700',
                      marginRight: 6,
                    },
                  ]}
                >
                  {item.name}
                </Text>
                {item.isPendingReview && (
                  <View style={styles.pendingPill}>
                    <Text style={[styles.pendingPillText, { color: theme.colors.heroText }]}>
                      {strings.onboarding.pendingReviewBadge}
                    </Text>
                  </View>
                )}
                <Ionicons
                  name="close-circle"
                  size={16}
                  color={item.origin === 'saved' ? theme.colors.heroText : theme.colors.primary}
                  style={{ marginLeft: 2 }}
                />
              </TouchableOpacity>
            ))}
          </View>

          <Button
            title={saving ? strings.onboarding.savingSkillsText : strings.onboarding.saveSkillsBtn}
            onPress={handleSaveSkills}
            variant="soft"
            size="sm"
            icon="checkmark-circle-outline"
            loading={saving}
            disabled={saving}
            fullWidth
          />
        </>
      )}
    </Card>
  );

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
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/(onboarding)/step1-mode'))}
              accessibilityLabel="Back to Step 1"
            />
            <View style={styles.stepBadge}>
              <Ionicons name="sparkles" size={13} color={theme.colors.primary} />
              <Text style={[styles.stepIndicator, { color: theme.colors.primary }]}>
                Step 2 of 3
              </Text>
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
                {isHire ? 'Client Setup' : 'Freelancer Setup'}
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
          <View style={[styles.progressFill, { width: '66%', backgroundColor: theme.colors.primary }]} />
        </View>
        <Text style={[styles.title, { color: theme.colors.text }]}>
          {isHire ? strings.onboarding.hiringTitle : strings.onboarding.skillsTitle}
        </Text>
        <Text style={[styles.subtitle, { color: theme.colors.muted }]}>
          {isHire ? strings.onboarding.hiringSubtitle : strings.onboarding.skillsSubtitle}
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
          {catalogError ? (
            <AlertBox
              tone="danger"
              message={catalogError}
              actionLabel={strings.common.retry}
              onAction={() => setCatalogAttempt((attempt) => attempt + 1)}
              style={{ marginBottom: 16 }}
            />
          ) : null}
          {saveError && (
            <AlertBox
              tone="danger"
              message={saveError}
              actionLabel="Dismiss"
              onAction={() => setSaveError(null)}
              style={{ marginBottom: 16 }}
            />
          )}

          {isHire ? (
            <ClientHiringDetailsCard
              clientType={clientType}
              setClientType={setClientType}
              businessName={businessName}
              setBusinessName={setBusinessName}
              aboutHiring={aboutHiring}
              setAboutHiring={setAboutHiring}
              catalogCategories={catalogCategories}
              catalogLoading={loading}
              selectedCategoryIds={selectedCategoryIds}
              toggleCatalogCategory={toggleCatalogCategory}
              helpDescription={helpDescription}
              setHelpDescription={setHelpDescription}
              aiCategorySuggestions={aiCategorySuggestions}
              onSuggestCategories={handleSuggestCategories}
              aiLoading={aiLoading}
              aiError={aiError}
              selectedCustomCategories={selectedCustomCategories}
              toggleCustomCategory={toggleCustomCategory}
              customCategoryInput={customCategoryInput}
              setCustomCategoryInput={setCustomCategoryInput}
              onAddCustomCategory={handleAddCustomCategory}
              totalSelectedInterests={totalSelectedInterests}
              maxHiringInterests={MAX_HIRING_INTERESTS}
            />
          ) : isWide ? (
            <View style={styles.wideTwoCol}>
              <View style={styles.wideLeftCol}>
                <FreelancerSkillSections
                  workDescription={workDescription}
                  setWorkDescription={setWorkDescription}
                  aiSuggestions={aiSuggestions}
                  selectedAiSkills={selectedAiSkills}
                  toggleAiSkill={toggleAiSkill}
                  savedSkills={savedSkills}
                  aiLoading={aiLoading}
                  aiError={aiError}
                  onSuggestSkills={handleSuggestSkills}
                  catalogSkills={catalogSkills}
                  catalogLoading={loading}
                  selectedCatalogIds={selectedCatalogIds}
                  toggleCatalogSkill={toggleCatalogSkill}
                  customInput={customInput}
                  setCustomInput={setCustomInput}
                  onAddCustomSkill={handleAddCustomSkill}
                />
              </View>
              <View style={styles.wideRightCol}>
                {trayCard}
              </View>
            </View>
          ) : (
            <>
              {/* Active profile skills tray */}
              {trayCard}

              <FreelancerSkillSections
                workDescription={workDescription}
                setWorkDescription={setWorkDescription}
                aiSuggestions={aiSuggestions}
                selectedAiSkills={selectedAiSkills}
                toggleAiSkill={toggleAiSkill}
                savedSkills={savedSkills}
                aiLoading={aiLoading}
                aiError={aiError}
                onSuggestSkills={handleSuggestSkills}
                catalogSkills={catalogSkills}
                catalogLoading={loading}
                selectedCatalogIds={selectedCatalogIds}
                toggleCatalogSkill={toggleCatalogSkill}
                customInput={customInput}
                setCustomInput={setCustomInput}
                onAddCustomSkill={handleAddCustomSkill}
              />
            </>
          )}
        </Animated.View>
      </ScrollView>

      {/* Footer Navigation */}
      <StickyFooterBox maxWidth={520}>
        <Button
          title="Continue"
          onPress={handleContinue}
          loading={saving}
          disabled={saving}
          rightIcon="arrow-forward"
          fullWidth
        />
        <Button
          title={strings.onboarding.skipForNow}
          onPress={handleSkip}
          variant="ghost"
          size="sm"
          disabled={saving}
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
    maxWidth: 1120,
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
    gap: 12,
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
    maxWidth: 1120,
    alignSelf: 'center',
  },
  wideTwoCol: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 20,
  },
  wideLeftCol: {
    flex: 1.35,
  },
  wideRightCol: {
    flex: 0.85,
  },
  card: {
    marginBottom: 16,
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
    marginRight: 4,
  },
  pendingPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  cardDesc: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
  },
});
