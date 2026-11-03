import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { useAuth } from '../../hooks/useAuth';
import {
  ProfileCompleteBadge,
  ProfileCompletenessCard,
} from '../../components/ui/ProfileCompleteness';
import {
  profileService,
  Area,
  Category,
  ProfileCompleteness,
  CompletenessMissingItem,
} from '../../services/profile';
import { Button } from '../../components/ui/Button';
import { Card, AlertBox, PageHeaderBox, StickyFooterBox } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { showToast } from '../../components/ui/Toast';
import { strings } from '../../constants/strings';
import { PhotoUploadCard } from '../../components/profile/PhotoUploadCard';
import { FreelancerWorkSection } from '../../components/profile/FreelancerWorkSection';
import { ClientHiringProfileSection } from '../../components/profile/ClientHiringProfileSection';

const MAX_HIRING_INTERESTS = 8;

export default function EditProfileScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { isDesktop } = useResponsiveLayout();
  const params = useLocalSearchParams<{ focus?: string }>();
  const { user, profile, refreshProfile } = useAuth();
  const scrollRef = useRef<ScrollView>(null);

  const isHire = profile?.active_mode === 'hire';

  // Form fields (both roles)
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [headline, setHeadline] = useState(profile?.headline || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [area, setArea] = useState(profile?.area || '');
  const [preferredContact, setPreferredContact] = useState(
    profile?.preferred_contact || 'In-app chat'
  );
  const [languages, setLanguages] = useState<string[]>(profile?.languages || []);
  const [phone, setPhone] = useState('');
  const [initialPhone, setInitialPhone] = useState('');

  // Freelancer extras
  const [workTypes, setWorkTypes] = useState<string[]>(profile?.work_types || []);
  const [availability, setAvailability] = useState<
    'available_now' | 'part_time' | 'weekends' | 'not_taking_work' | ''
  >(profile?.availability || '');
  const [experienceYears, setExperienceYears] = useState<
    'lt_1' | '1_3' | '3_5' | '5_plus' | ''
  >(profile?.experience_years || '');
  const [startingRateNote, setStartingRateNote] = useState(
    profile?.starting_rate_note || ''
  );

  // Client extras
  const [clientType, setClientType] = useState<
    'individual' | 'business' | 'organization' | 'other' | ''
  >(profile?.client_type || '');
  const [businessName, setBusinessName] = useState(profile?.business_name || '');
  const [aboutHiring, setAboutHiring] = useState(profile?.about_hiring || '');
  const [categoriesList, setCategoriesList] = useState<Category[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [initialCategoryIds, setInitialCategoryIds] = useState<string[]>([]);
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [customCategoryInput, setCustomCategoryInput] = useState('');

  // Reference data & completeness
  const [areasList, setAreasList] = useState<Area[]>([]);
  const [completeness, setCompleteness] = useState<ProfileCompleteness | null>(null);

  // UI states
  const [loading, setLoading] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // Input refs for jumping to missing fields
  const nameInputRef = useRef<TextInput>(null);
  const headlineInputRef = useRef<TextInput>(null);
  const bioInputRef = useRef<TextInput>(null);
  const areaInputRef = useRef<TextInput>(null);
  const customCategoryInputRef = useRef<TextInput>(null);

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    setError(null);
    try {
      const [areasRes, catsRes, userInterests, compRes, privatePhone] = await Promise.all([
        profileService.getAreas(),
        profileService.getCategories(),
        profileService.getUserHiringInterests(user.id),
        profileService.getProfileCompleteness(user.id),
        profileService.getOwnPrivatePhone(user.id),
      ]);
      setAreasList(areasRes);
      setCategoriesList(catsRes);
      const interestIds = userInterests.map((c) => c.id);
      setSelectedCategoryIds(interestIds);
      setInitialCategoryIds(interestIds);
      setCompleteness(compRes);
      setPhone(privatePhone);
      setInitialPhone(privatePhone);
    } catch (err: any) {
      setError(err?.message || 'Could not load profile details.');
    }
  }, [user?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Focus requested field if navigated from a missing completeness item
  useEffect(() => {
    if (!params.focus) return;
    const frameId = requestAnimationFrame(() => {
      if (params.focus === 'display_name') nameInputRef.current?.focus();
      else if (params.focus === 'headline') headlineInputRef.current?.focus();
      else if (params.focus === 'bio') bioInputRef.current?.focus();
      else if (params.focus === 'area') areaInputRef.current?.focus();
      else if (params.focus === 'hiring_interests') customCategoryInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frameId);
  }, [params.focus]);

  const isDirty =
    displayName !== (profile?.display_name || '') ||
    headline !== (profile?.headline || '') ||
    bio !== (profile?.bio || '') ||
    area !== (profile?.area || '') ||
    preferredContact !== (profile?.preferred_contact || 'In-app chat') ||
    JSON.stringify([...languages].sort()) !== JSON.stringify([...(profile?.languages || [])].sort()) ||
    phone !== initialPhone ||
    JSON.stringify([...workTypes].sort()) !== JSON.stringify([...(profile?.work_types || [])].sort()) ||
    availability !== (profile?.availability || '') ||
    experienceYears !== (profile?.experience_years || '') ||
    startingRateNote !== (profile?.starting_rate_note || '') ||
    clientType !== (profile?.client_type || '') ||
    businessName !== (profile?.business_name || '') ||
    aboutHiring !== (profile?.about_hiring || '') ||
    JSON.stringify([...selectedCategoryIds].sort()) !== JSON.stringify([...initialCategoryIds].sort()) ||
    customCategories.length > 0;

  const navigateBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/profile');
    }
  };

  const handleBackPress = () => {
    if (isDirty && !loading) {
      setShowDiscardConfirm(true);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    navigateBack();
  };

  const toggleLanguage = (lang: string) => {
    setLanguages((prev) =>
      prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang]
    );
  };

  const toggleWorkType = (wt: string) => {
    setWorkTypes((prev) =>
      prev.includes(wt) ? prev.filter((item) => item !== wt) : [...prev, wt]
    );
  };

  const totalSelectedInterests = selectedCategoryIds.length + customCategories.length;

  const toggleHiringCategory = (id: string) => {
    setError(null);
    if (selectedCategoryIds.includes(id)) {
      setSelectedCategoryIds((prev) => prev.filter((c) => c !== id));
      return;
    }
    if (totalSelectedInterests >= MAX_HIRING_INTERESTS) {
      setError(`You can select at most ${MAX_HIRING_INTERESTS} hiring interests.`);
      return;
    }
    setSelectedCategoryIds((prev) => [...prev, id]);
  };

  const handleAddCustomCategory = () => {
    const trimmed = customCategoryInput.trim();
    if (!trimmed) return;
    if (trimmed.length < 2 || trimmed.length > 50) {
      setError('Category name must be between 2 and 50 characters.');
      return;
    }
    if (totalSelectedInterests >= MAX_HIRING_INTERESTS) {
      setError(`You can select at most ${MAX_HIRING_INTERESTS} hiring interests.`);
      return;
    }
    const existingCat = categoriesList.find(
      (c) => c.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (existingCat) {
      if (!selectedCategoryIds.includes(existingCat.id)) {
        setSelectedCategoryIds((prev) => [...prev, existingCat.id]);
      }
    } else if (!customCategories.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      setCustomCategories((prev) => [...prev, trimmed]);
    }
    setCustomCategoryInput('');
    setError(null);
  };

  const removeCustomCategory = (name: string) => {
    setCustomCategories((prev) => prev.filter((c) => c !== name));
  };

  const handlePickAvatar = async (source: 'library' | 'camera') => {
    if (!user || photoBusy) return;
    setError(null);
    setPhotoBusy(true);
    try {
      const url = await profileService.pickAndUploadAvatar(user.id, source);
      if (url) {
        await refreshProfile();
        const comp = await profileService.getProfileCompleteness(user.id).catch(() => null);
        setCompleteness(comp);
        setSuccessMsg('Profile photo updated.');
        showToast(strings.toasts.photoUpdated);
      }
    } catch (err: any) {
      setError(err?.message || 'Could not upload photo.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleRemoveAvatar = async () => {
    if (!user || photoBusy) return;
    setError(null);
    setPhotoBusy(true);
    try {
      await profileService.removeAvatar(user.id);
      await refreshProfile();
      const comp = await profileService.getProfileCompleteness(user.id).catch(() => null);
      setCompleteness(comp);
      setSuccessMsg('Profile photo removed.');
      showToast(strings.toasts.photoRemoved);
    } catch (err: any) {
      setError(err?.message || 'Could not remove photo.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleMissingItemTap = (item: CompletenessMissingItem) => {
    if (item.key === 'skills') {
      router.push('/profile/skills');
      return;
    }
    if (item.key === 'display_name') nameInputRef.current?.focus();
    else if (item.key === 'headline') headlineInputRef.current?.focus();
    else if (item.key === 'bio') bioInputRef.current?.focus();
    else if (item.key === 'area') areaInputRef.current?.focus();
    else if (item.key === 'hiring_interests') customCategoryInputRef.current?.focus();
    else if (item.key === 'photo') handlePickAvatar('library');
  };

  const validateFields = (): boolean => {
    const errs: Record<string, string> = {};
    const trimmedName = displayName.trim();
    if (trimmedName.length < 2 || trimmedName.length > 50) {
      errs.displayName = 'Display name must be between 2 and 50 characters.';
    }
    if (!isHire && headline.trim().length > 80) {
      errs.headline = 'Headline must be 80 characters or fewer.';
    }
    const trimmedBio = bio.trim();
    if (trimmedBio.length > 0 && (trimmedBio.length < 20 || trimmedBio.length > 500)) {
      errs.bio = 'Bio must be between 20 and 500 characters (or left empty).';
    }
    if (area.trim().length > 80) {
      errs.area = 'Area must be 80 characters or fewer.';
    }
    if (preferredContact.trim().length > 120) {
      errs.preferredContact = 'Preferred contact note must be 120 characters or fewer.';
    }
    if (phone.trim().length > 0 && !/^[0-9+() -]{7,20}$/.test(phone.trim())) {
      errs.phone = 'Enter a valid phone number (7 to 20 digits) or leave blank.';
    }
    if (!isHire && startingRateNote.trim().length > 120) {
      errs.startingRateNote = 'Starting rate note must be 120 characters or fewer.';
    }
    const trimmedBiz = businessName.trim();
    if (isHire && trimmedBiz.length > 0 && (trimmedBiz.length < 2 || trimmedBiz.length > 60)) {
      errs.businessName = 'Business or organization name must be between 2 and 60 characters.';
    }
    if (isHire && aboutHiring.trim().length > 300) {
      errs.aboutHiring = 'About hiring note must be 300 characters or fewer.';
    }
    if (isHire && totalSelectedInterests > MAX_HIRING_INTERESTS) {
      errs.hiringInterests = `You can select at most ${MAX_HIRING_INTERESTS} hiring interests.`;
    }

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!user || loading) return;
    setError(null);
    setSuccessMsg(null);

    if (!validateFields()) {
      setError('Please fix the highlighted fields below.');
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }

    setLoading(true);
    try {
      await profileService.updateProfileDetails({
        displayName: displayName.trim(),
        headline: headline.trim(),
        bio: bio.trim(),
        area: area.trim(),
        preferredContact: preferredContact.trim() || 'In-app chat',
        languages,
        phone: phone.trim(),
        workTypes,
        availability: availability || null,
        experienceYears: experienceYears || null,
        startingRateNote: startingRateNote.trim(),
        clientType: clientType || null,
        businessName: businessName.trim(),
        aboutHiring: aboutHiring.trim(),
      });

      if (isHire) {
        await profileService.saveHiringDetails({
          clientType: clientType || null,
          businessName: businessName.trim(),
          aboutHiring: aboutHiring.trim(),
          categoryIds: selectedCategoryIds,
          customCategoryNames: customCategories,
        });
      }

      setInitialPhone(phone.trim());
      setCustomCategories([]);
      await refreshProfile();
      await loadData();
      setSuccessMsg('Profile details saved.');
      showToast(strings.toasts.profileSaved);
    } catch (err: any) {
      setError(err?.message || 'Failed to update profile.');
    } finally {
      setLoading(false);
    }
  };

  const renderCoreIdentityFields = () => (
    <Card tone="raised" padding="lg" style={styles.sectionCard}>
      <Text style={[styles.sectionCardTitle, { color: theme.colors.text }]}>
        Core Profile Details
      </Text>

      {/* Display Name */}
      <View style={styles.inputGroup}>
        <Text style={[styles.label, { color: theme.colors.text }]}>
          Display Name (2–50 characters)
        </Text>
        <TextInput
          ref={nameInputRef}
          style={[
            styles.input,
            {
              borderColor: fieldErrors.displayName ? theme.colors.danger : theme.colors.border,
              color: theme.colors.text,
              backgroundColor: theme.colors.surfaceAlt,
            },
          ]}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="e.g. Maria Santos"
          placeholderTextColor={theme.colors.muted}
          maxLength={50}
        />
        {fieldErrors.displayName ? (
          <Text style={[styles.fieldError, { color: theme.colors.dangerText }]}>
            {fieldErrors.displayName}
          </Text>
        ) : null}
      </View>

      {/* Bio */}
      <View style={styles.inputGroup}>
        <Text style={[styles.label, { color: theme.colors.text }]}>
          Bio (20–500 characters)
        </Text>
        <TextInput
          ref={bioInputRef}
          style={[
            styles.input,
            styles.textArea,
            {
              borderColor: fieldErrors.bio ? theme.colors.danger : theme.colors.border,
              color: theme.colors.text,
              backgroundColor: theme.colors.surfaceAlt,
            },
          ]}
          value={bio}
          onChangeText={setBio}
          placeholder={
            isHire
              ? 'Tell freelancers in Ormoc about yourself or what projects you post...'
              : 'Tell clients in Ormoc about your skills and experience (at least 20 characters)...'
          }
          placeholderTextColor={theme.colors.muted}
          multiline
          numberOfLines={4}
          maxLength={500}
          textAlignVertical="top"
        />
        <Text style={[styles.helperText, { color: theme.colors.muted }]}>
          {bio.trim().length}/500 characters
        </Text>
        {fieldErrors.bio ? (
          <Text style={[styles.fieldError, { color: theme.colors.dangerText }]}>
            {fieldErrors.bio}
          </Text>
        ) : null}
      </View>

      {/* Area */}
      <View style={styles.inputGroup}>
        <Text style={[styles.label, { color: theme.colors.text }]}>Barangay / Area in Ormoc</Text>
        {areasList.length > 0 ? (
          <View style={styles.chipsWrap}>
            {areasList.map((a) => {
              const selected = area.toLowerCase() === a.name.toLowerCase();
              return (
                <Chip
                  key={a.id}
                  label={a.name}
                  selected={selected}
                  size="sm"
                  onPress={() => setArea(a.name)}
                />
              );
            })}
          </View>
        ) : null}
        <TextInput
          ref={areaInputRef}
          style={[
            styles.input,
            {
              borderColor: fieldErrors.area ? theme.colors.danger : theme.colors.border,
              color: theme.colors.text,
              backgroundColor: theme.colors.surfaceAlt,
            },
          ]}
          value={area}
          onChangeText={setArea}
          placeholder="e.g. Cogon, Ormoc City"
          placeholderTextColor={theme.colors.muted}
          maxLength={80}
        />
        {fieldErrors.area ? (
          <Text style={[styles.fieldError, { color: theme.colors.dangerText }]}>
            {fieldErrors.area}
          </Text>
        ) : null}
      </View>

      {/* Languages */}
      <View style={styles.inputGroup}>
        <Text style={[styles.label, { color: theme.colors.text }]}>Languages Spoken</Text>
        <View style={styles.chipsWrap}>
          {strings.profile.languagesList.map((lang) => {
            const selected = languages.includes(lang);
            return (
              <Chip
                key={lang}
                label={lang}
                selected={selected}
                size="sm"
                onPress={() => toggleLanguage(lang)}
              />
            );
          })}
        </View>
      </View>

      {/* Preferred Contact Note */}
      <View style={styles.inputGroup}>
        <Text style={[styles.label, { color: theme.colors.text }]}>
          Preferred Contact Method Note
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              borderColor: fieldErrors.preferredContact
                ? theme.colors.danger
                : theme.colors.border,
              color: theme.colors.text,
              backgroundColor: theme.colors.surfaceAlt,
            },
          ]}
          value={preferredContact}
          onChangeText={setPreferredContact}
          placeholder="In-app chat"
          placeholderTextColor={theme.colors.muted}
          maxLength={120}
        />
        {fieldErrors.preferredContact ? (
          <Text style={[styles.fieldError, { color: theme.colors.dangerText }]}>
            {fieldErrors.preferredContact}
          </Text>
        ) : null}
      </View>

      {/* Private Phone */}
      <View style={[styles.inputGroup, { marginBottom: 0 }]}>
        <View style={styles.privateLabelRow}>
          <Ionicons name="lock-closed" size={14} color={theme.colors.muted} />
          <Text style={[styles.label, { color: theme.colors.text, marginBottom: 0 }]}>
            Phone Number (Optional)
          </Text>
        </View>
        <Text style={[styles.helperText, { color: theme.colors.muted, marginBottom: 6 }]}>
          {strings.profile.privateFieldNote}
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              borderColor: fieldErrors.phone ? theme.colors.danger : theme.colors.border,
              color: theme.colors.text,
              backgroundColor: theme.colors.surfaceAlt,
            },
          ]}
          value={phone}
          onChangeText={setPhone}
          placeholder="e.g. 0917 123 4567"
          placeholderTextColor={theme.colors.muted}
          keyboardType="phone-pad"
          maxLength={20}
        />
        {fieldErrors.phone ? (
          <Text style={[styles.fieldError, { color: theme.colors.dangerText }]}>
            {fieldErrors.phone}
          </Text>
        ) : null}
      </View>
    </Card>
  );

  const renderRoleSpecificSection = () =>
    !isHire ? (
      <FreelancerWorkSection
        headline={headline}
        setHeadline={setHeadline}
        headlineInputRef={headlineInputRef}
        startingRateNote={startingRateNote}
        setStartingRateNote={setStartingRateNote}
        workTypes={workTypes}
        toggleWorkType={toggleWorkType}
        availability={availability}
        setAvailability={setAvailability}
        experienceYears={experienceYears}
        setExperienceYears={setExperienceYears}
        onNavigatePortfolio={() => router.push('/profile/portfolio')}
        onNavigateSkills={() => router.push('/profile/skills')}
        fieldErrors={fieldErrors}
      />
    ) : (
      /* Hiring Interests ({totalSelectedInterests}/{MAX_HIRING_INTERESTS}) */
      <ClientHiringProfileSection
        clientType={clientType}
        setClientType={setClientType}
        businessName={businessName}
        setBusinessName={setBusinessName}
        aboutHiring={aboutHiring}
        setAboutHiring={setAboutHiring}
        categoriesList={categoriesList}
        selectedCategoryIds={selectedCategoryIds}
        toggleHiringCategory={toggleHiringCategory}
        customCategories={customCategories}
        removeCustomCategory={removeCustomCategory}
        customCategoryInput={customCategoryInput}
        setCustomCategoryInput={setCustomCategoryInput}
        onAddCustomCategory={handleAddCustomCategory}
        customCategoryInputRef={customCategoryInputRef}
        totalSelectedInterests={totalSelectedInterests}
        maxHiringInterests={MAX_HIRING_INTERESTS}
        fieldErrors={fieldErrors}
      />
    );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <PageHeaderBox
        title="Edit Profile"
        subtitle="Manage your core identity, contact details, and role preferences"
        onBack={handleBackPress}
        rightAction={completeness?.complete ? <ProfileCompleteBadge /> : undefined}
        maxWidth={960}
      />

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.innerWrap}>
          {showDiscardConfirm ? (
            <AlertBox
              tone="warning"
              title={strings.profile.unsavedChangesTitle}
              message={strings.profile.unsavedChangesBody}
              style={{ marginBottom: 16 }}
              action={
                <View style={styles.discardActions}>
                  <Button
                    title={strings.profile.keepEditingBtn}
                    variant="secondary"
                    size="sm"
                    fullWidth={false}
                    onPress={() => setShowDiscardConfirm(false)}
                  />
                  <Button
                    title={strings.profile.discardBtn}
                    variant="danger"
                    size="sm"
                    fullWidth={false}
                    onPress={navigateBack}
                  />
                </View>
              }
            />
          ) : null}

          {error ? (
            <AlertBox
              tone="danger"
              message={error}
              style={{ marginBottom: 16 }}
              action={
                <Button
                  title={strings.common.retry}
                  variant="ghost"
                  size="xs"
                  fullWidth={false}
                  onPress={loadData}
                />
              }
            />
          ) : null}

          {successMsg ? (
            <AlertBox tone="success" message={successMsg} style={{ marginBottom: 16 }} />
          ) : null}

          {isDesktop ? (
            <View style={styles.desktopGrid}>
              <View style={styles.desktopLeftCol}>
                <PhotoUploadCard
                  displayName={displayName || profile?.display_name || ''}
                  avatarPath={profile?.avatar_path}
                  photoBusy={photoBusy}
                  onPickLibrary={() => handlePickAvatar('library')}
                  onPickCamera={() => handlePickAvatar('camera')}
                  onRemovePhoto={handleRemoveAvatar}
                />
                <ProfileCompletenessCard
                  completeness={completeness}
                  onSelectMissingItem={handleMissingItemTap}
                />
              </View>
              <View style={styles.desktopRightCol}>
                {renderCoreIdentityFields()}
                {renderRoleSpecificSection()}
              </View>
            </View>
          ) : (
            <View>
              <ProfileCompletenessCard
                completeness={completeness}
                onSelectMissingItem={handleMissingItemTap}
              />
              <PhotoUploadCard
                displayName={displayName || profile?.display_name || ''}
                avatarPath={profile?.avatar_path}
                photoBusy={photoBusy}
                onPickLibrary={() => handlePickAvatar('library')}
                onPickCamera={() => handlePickAvatar('camera')}
                onRemovePhoto={handleRemoveAvatar}
              />
              {renderCoreIdentityFields()}
              {renderRoleSpecificSection()}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Sticky Save Footer */}
      <StickyFooterBox maxWidth={960}>
        <Button
          title="Save Changes"
          icon="checkmark-circle-outline"
          onPress={handleSave}
          disabled={loading}
          loading={loading}
        />
      </StickyFooterBox>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 100,
  },
  innerWrap: {
    maxWidth: 1120,
    width: '100%',
    alignSelf: 'center',
  },
  desktopGrid: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 24,
  },
  desktopLeftCol: {
    width: 340,
  },
  desktopRightCol: {
    flex: 1,
    minWidth: 0,
  },
  sectionCard: {
    marginBottom: 20,
  },
  sectionCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 14,
  },
  discardActions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
  },
  textArea: {
    minHeight: 80,
  },
  fieldError: {
    fontSize: 12,
    marginTop: 4,
  },
  helperText: {
    fontSize: 12,
  },
  privateLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
});
