import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { useAuth } from '../../hooks/useAuth';
import { profileService, Category } from '../../services/profile';
import {
  gigsService,
  SuggestedGigCategory,
  SimilarCategory,
} from '../../services/gigs';
import { aiService } from '../../services/ai';
import { TextInput } from '../../components/ui/TextInput';
import { Button } from '../../components/ui/Button';
import { Card, AlertBox, PageHeaderBox } from '../../components/ui/Card';
import { GigCard, GigSummary } from '../../components/ui/GigCard';
import { showToast } from '../../components/ui/Toast';
import { confirmDialog } from '../../lib/dialog';
import { strings } from '../../constants/strings';
import { GigCategoryPicker } from '../../components/gigs/GigCategoryPicker';
import { GigTermsForm, WorkType } from '../../components/gigs/GigTermsForm';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUuid = (val?: string | null): boolean => Boolean(val && UUID_REGEX.test(val.trim()));

export default function PostGigScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { isDesktop } = useResponsiveLayout();
  const { profile } = useAuth();
  const { editGigId } = useLocalSearchParams<{ editGigId?: string }>();

  const [existingGigStatus, setExistingGigStatus] = useState<'draft' | 'open' | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const selectedCategoryId = selectedCategoryIds[0] || '';
  const setSelectedCategoryId = (id: string) => setSelectedCategoryIds(id ? [id] : []);
  const [customCategoryName, setCustomCategoryName] = useState<string>('');
  const [categoryQuery, setCategoryQuery] = useState<string>('');

  // Suggestions & "Did you mean...?" state
  const [suggestedCategories, setSuggestedCategories] = useState<SuggestedGigCategory[]>([]);
  const [aiProposedCategory, setAiProposedCategory] = useState<string | null>(null);
  const [similarCategories, setSimilarCategories] = useState<SimilarCategory[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [requirements, setRequirements] = useState('');
  const [priceMinStr, setPriceMinStr] = useState('');
  const [priceMaxStr, setPriceMaxStr] = useState('');
  const [workType, setWorkType] = useState<WorkType>('remote');
  const [area, setArea] = useState('');
  const [appDays, setAppDays] = useState('7');
  const [completionDays, setCompletionDays] = useState('14');

  const [loading, setLoading] = useState(false);
  const [catsLoading, setCatsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isHireMode = profile?.active_mode === 'hire';

  useEffect(() => {
    let mounted = true;
    profileService
      .getCategories()
      .then((data) => {
        if (mounted) {
          setCategories(data);
          if (data.length > 0 && selectedCategoryIds.length === 0) {
            setSelectedCategoryIds([data[0].id]);
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setCatsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!editGigId) return;
    let active = true;
    gigsService
      .getGig(editGigId)
      .then((g) => {
        if (!active || !g) return;
        setTitle(g.title);
        setDescription(g.description);
        setRequirements(g.requirements || '');
        setPriceMinStr((g.price_min / 100).toString());
        setPriceMaxStr((g.price_max / 100).toString());
        setWorkType(g.work_type);
        setArea(g.area || '');
        setExistingGigStatus(g.status as any);
        if (g.category_id) {
          const loadedCats = [g.category_id, ...(g.secondary_category_ids || [])].filter(Boolean);
          setSelectedCategoryIds(loadedCats);
        }
        // Populate application & completion days from existing deadlines
        const nowMs = Date.now();
        if (g.application_deadline) {
          const diffApp = Math.max(
            1,
            Math.ceil((new Date(g.application_deadline).getTime() - nowMs) / (24 * 60 * 60 * 1000))
          );
          setAppDays(String(diffApp));
        }
        if (g.deadline) {
          const diffComp = Math.max(
            1,
            Math.ceil((new Date(g.deadline).getTime() - nowMs) / (24 * 60 * 60 * 1000))
          );
          setCompletionDays(String(diffComp));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [editGigId]);

  // Source 1 (DB fuzzy match): Auto-suggest existing categories when title/description change
  useEffect(() => {
    const cleanTitle = title.trim();
    const cleanDesc = description.trim();
    if (cleanTitle.length < 3 && cleanDesc.length < 10) {
      return;
    }

    let cancelled = false;
    gigsService
      .suggestCategoriesForGig(cleanTitle, cleanDesc)
      .then((rows) => {
        if (!cancelled && rows.length > 0) {
          setSuggestedCategories(rows);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [title, description]);

  // "Did you mean...?" fuzzy search while typing in the category box
  useEffect(() => {
    const trimmed = categoryQuery.trim();
    if (trimmed.length < 2) {
      setSimilarCategories([]);
      return;
    }

    let cancelled = false;
    gigsService
      .findSimilarCategories(trimmed)
      .then((rows) => {
        if (!cancelled) {
          setSimilarCategories(rows);
        }
      })
      .catch(() => {
        if (!cancelled) {
          const lower = trimmed.toLowerCase();
          const localMatches = categories
            .filter((c) => c.name.toLowerCase().includes(lower))
            .slice(0, 5)
            .map((c) => ({
              id: c.id,
              name: c.name,
              slug: c.slug,
              similarity_score: 0.7,
            }));
          setSimilarCategories(localMatches);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [categoryQuery, categories]);

  const handleSelectExistingCategory = (catId: string) => {
    let resolvedId = catId;
    const exactCat = categories.find((c) => c.id === catId);
    if (exactCat) {
      resolvedId = exactCat.id;
    } else {
      const sug = suggestedCategories.find((s) => s.id === catId);
      if (sug) {
        const nameMatch = categories.find(
          (c) => c.name.trim().toLowerCase() === sug.name.trim().toLowerCase()
        );
        if (nameMatch && isValidUuid(nameMatch.id)) {
          resolvedId = nameMatch.id;
        } else if (isValidUuid(sug.id)) {
          resolvedId = sug.id;
        } else {
          handleSelectCustomCategory(sug.name);
          return;
        }
      }
    }

    if (!isValidUuid(resolvedId)) {
      const nameMatch = categories.find(
        (c) => c.name.trim().toLowerCase() === catId.trim().toLowerCase()
      );
      if (nameMatch && isValidUuid(nameMatch.id)) {
        resolvedId = nameMatch.id;
      } else {
        handleSelectCustomCategory(catId);
        return;
      }
    }

    setSelectedCategoryIds((prev) => {
      if (prev.includes(resolvedId)) {
        return prev.filter((id) => id !== resolvedId);
      }
      if (prev.length >= 3) {
        showToast('You can select up to 3 categories.', 'info');
        return prev;
      }
      return [...prev, resolvedId];
    });
    setCustomCategoryName('');
    setError(null);
  };

  const handleSelectCustomCategory = (name: string) => {
    const trimmed = name.trim();
    if (trimmed.length < 3 || trimmed.length > 40) {
      setError('Custom category name must be between 3 and 40 characters.');
      return;
    }
    const exact = categories.find(
      (c) => c.name.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (exact) {
      handleSelectExistingCategory(exact.id);
      return;
    }
    setSelectedCategoryIds([]);
    setCustomCategoryName(trimmed);
    setError(null);
  };

  const handleAiSuggestCategory = async () => {
    const cleanTitle = title.trim();
    const cleanDesc = description.trim();
    if (!cleanTitle && !cleanDesc) {
      setError('Please enter a title or description first so our assistant has context.');
      return;
    }

    setSuggestLoading(true);
    setError(null);
    try {
      const result = await gigsService.suggestCategoriesWithAiFallback(cleanTitle, cleanDesc);
      setSuggestedCategories(result.suggestions);
      setAiProposedCategory(result.proposed_new_category);

      if (result.suggestions.length > 0) {
        handleSelectExistingCategory(result.suggestions[0].id);
      } else if (result.proposed_new_category) {
        handleSelectCustomCategory(result.proposed_new_category);
      }
    } catch (err: any) {
      setError(err?.message || 'Could not suggest categories right now.');
    } finally {
      setSuggestLoading(false);
    }
  };

  const validateAndBuildParams = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) throw new Error('Gig title is required.');
    if (trimmedTitle.length < 5 || trimmedTitle.length > 80) {
      throw new Error('Gig title must be between 5 and 80 characters.');
    }

    const trimmedCustomCat = customCategoryName.trim();
    let finalCategoryId: string | null = null;
    let finalCategoryName: string | null = null;
    const secondaryCategoryIds: string[] = [];

    const primaryCatId = selectedCategoryIds[0] || selectedCategoryId;
    if (primaryCatId) {
      if (isValidUuid(primaryCatId)) {
        finalCategoryId = primaryCatId;
      } else {
        const cat =
          categories.find((c) => c.id === primaryCatId) ||
          suggestedCategories.find((s) => s.id === primaryCatId);
        if (cat) {
          const matchInDb = categories.find(
            (c) => c.name.trim().toLowerCase() === cat.name.trim().toLowerCase()
          );
          if (matchInDb && isValidUuid(matchInDb.id)) {
            finalCategoryId = matchInDb.id;
          } else {
            finalCategoryName = cat.name.trim();
          }
        } else {
          finalCategoryName = primaryCatId;
        }
      }
    } else if (trimmedCustomCat) {
      const matchInDb = categories.find(
        (c) => c.name.trim().toLowerCase() === trimmedCustomCat.toLowerCase()
      );
      if (matchInDb && isValidUuid(matchInDb.id)) {
        finalCategoryId = matchInDb.id;
      } else {
        finalCategoryName = trimmedCustomCat;
      }
    }

    // Resolve any secondary categories (slots 2 & 3)
    for (const secId of selectedCategoryIds.slice(1)) {
      if (isValidUuid(secId) && secId !== finalCategoryId && !secondaryCategoryIds.includes(secId)) {
        secondaryCategoryIds.push(secId);
      }
    }

    if (!finalCategoryId && !finalCategoryName) {
      throw new Error('Please select at least 1 category or enter a new category name (3–40 characters).');
    }

    if (!finalCategoryId && finalCategoryName && (finalCategoryName.length < 3 || finalCategoryName.length > 40)) {
      throw new Error('New category name must be between 3 and 40 characters.');
    }

    const trimmedDesc = description.trim();
    if (!trimmedDesc) throw new Error('Gig description is required.');
    if (trimmedDesc.length < 30 || trimmedDesc.length > 2000) {
      throw new Error('Gig description must be between 30 and 2000 characters.');
    }

    const pMin = parseFloat(priceMinStr);
    const pMax = parseFloat(priceMaxStr || priceMinStr);

    if (isNaN(pMin) || pMin < 100) {
      throw new Error('Minimum budget must be at least ₱100.00 PHP.');
    }
    if (isNaN(pMax) || pMax < pMin) {
      throw new Error('Maximum budget cannot be less than minimum budget.');
    }

    const appD = parseInt(appDays, 10);
    const compD = parseInt(completionDays, 10);
    if (isNaN(appD) || appD < 1) throw new Error('Application deadline must be at least 1 day in the future.');
    if (isNaN(compD) || compD < appD) throw new Error('Completion deadline must be greater than or equal to the application deadline.');

    const now = new Date();
    const appDate = new Date(now.getTime() + appD * 24 * 60 * 60 * 1000);
    const compDate = new Date(now.getTime() + compD * 24 * 60 * 60 * 1000);

    return {
      title: trimmedTitle,
      description: trimmedDesc,
      requirements: requirements.trim(),
      category_id: finalCategoryId,
      category_name: finalCategoryName,
      secondary_category_ids: secondaryCategoryIds,
      price_min: Math.round(pMin * 100),
      price_max: Math.round(pMax * 100),
      work_type: workType,
      area: area.trim(),
      application_deadline: appDate.toISOString(),
      deadline: compDate.toISOString(),
    };
  };

  const handlePolishDescription = async () => {
    if (!description.trim() || polishing) return;
    setPolishing(true);
    try {
      const polished = await aiService.polishGigDescription(description);
      setDescription(polished);
      showToast('Gig description polished!', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Could not polish description.', 'error');
    } finally {
      setPolishing(false);
    }
  };

  const inFlightRef = React.useRef(false);
  const [submitted, setSubmitted] = useState(false);

  const handleBackPress = async () => {
    const hasUnsaved = Boolean(title.trim() || description.trim() || priceMinStr.trim());
    if (hasUnsaved && !submitted && !editGigId) {
      const discard = await confirmDialog({
        title: 'Discard Gig Draft?',
        message: 'You have unsaved changes. Would you like to leave without saving?',
        confirmText: 'Leave',
        cancelText: 'Keep Editing',
        destructive: true,
      });
      if (!discard) return;
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/gigs');
    }
  };

  const handleSaveDraft = async () => {
    if (inFlightRef.current || loading || submitted) return;
    setError(null);
    try {
      const params = validateAndBuildParams();
      inFlightRef.current = true;
      setLoading(true);
      if (editGigId) {
        await gigsService.updateGig(editGigId, params);
        setSubmitted(true);
        showToast('Gig changes saved successfully!');
        router.replace('/(tabs)/gigs');
        return;
      }
      await gigsService.createDraftGig(params);
      setSubmitted(true);
      showToast(strings.toasts.gigDraftSaved);
      router.replace('/(tabs)/gigs');
    } catch (err: any) {
      setError(err?.message || 'Could not save draft.');
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  const handlePublish = async () => {
    if (inFlightRef.current || loading || submitted) return;
    setError(null);
    try {
      const params = validateAndBuildParams();

      const confirmed = await confirmDialog({
        title: 'Confirm Post Gig',
        message:
          editGigId && existingGigStatus === 'open'
            ? 'Are you sure you want to update and publish these changes?'
            : 'Are you sure you want to publish this gig? Freelancers in Ormoc will be able to view and apply immediately.',
        confirmText: strings.gigs.publishDraftConfirm,
        cancelText: strings.common.cancel,
      });
      if (!confirmed) return;

      inFlightRef.current = true;
      setLoading(true);
      if (editGigId) {
        await gigsService.updateGig(editGigId, params);
        if (existingGigStatus === 'draft') {
          await gigsService.publishGig(editGigId);
          showToast(strings.toasts.gigPublished);
        } else {
          showToast('Gig updated successfully!');
        }
        setSubmitted(true);
        router.replace('/(tabs)/gigs');
        return;
      }
      const { id: draftId } = await gigsService.createDraftGig(params);
      await gigsService.publishGig(draftId);
      setSubmitted(true);
      showToast(strings.toasts.gigPublished);
      router.replace('/(tabs)/gigs');
    } catch (err: any) {
      setError(err?.message || 'Could not publish gig.');
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  if (!isHireMode) {
    return (
      <View style={[styles.container, styles.blockedContainer, { backgroundColor: theme.colors.background }]}>
        <Ionicons name="lock-closed-outline" size={36} color={theme.colors.muted} style={{ marginBottom: 12 }} />
        <Text style={[styles.blockedTitle, { color: theme.colors.text }]}>
          {strings.gigs.hireModeRequiredTitle}
        </Text>
        <Text style={[styles.blockedDesc, { color: theme.colors.muted }]}>
          {strings.gigs.hireModeRequiredDesc}
        </Text>
        <Button
          title="Go to Account Settings"
          onPress={() => router.push('/(tabs)/profile')}
          variant="primary"
          style={{ marginTop: 16, marginBottom: 8 }}
        />
        <Button
          title="Go Back"
          icon="arrow-back"
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(tabs)/gigs');
            }
          }}
          variant="secondary"
        />
      </View>
    );
  }

  const activeCategoryName =
    customCategoryName.trim() ||
    selectedCategoryIds
      .map((id) => categories.find((c) => c.id === id)?.name || suggestedCategories.find((s) => s.id === id)?.name)
      .filter(Boolean)
      .join(', ') ||
    'General Category';

  const previewMin = Math.max(0, Math.round((parseFloat(priceMinStr) || 0) * 100));
  const previewMax = Math.max(previewMin, Math.round((parseFloat(priceMaxStr || priceMinStr) || 0) * 100));
  const previewDays = Math.max(1, parseInt(completionDays, 10) || 14);
  const previewAppDays = Math.max(1, parseInt(appDays, 10) || 7);
  const previewGig: GigSummary = {
    id: 'preview',
    title: title.trim() || 'Your Gig Title Preview',
    category_name: activeCategoryName,
    price_min: previewMin || 50000,
    price_max: previewMax || 150000,
    work_type: workType,
    area: area.trim() || 'Ormoc City',
    status: existingGigStatus || 'open',
    application_deadline: new Date(Date.now() + previewAppDays * 24 * 60 * 60 * 1000).toISOString(),
    deadline: new Date(Date.now() + previewDays * 24 * 60 * 60 * 1000).toISOString(),
    client: {
      display_name: profile?.display_name || 'You',
      client_rating_avg: profile?.client_rating_avg || 5.0,
      client_rating_count: profile?.client_rating_count || 1,
    },
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <PageHeaderBox
        title={editGigId ? 'Edit Gig' : strings.gigs.postGigTitle}
        subtitle="Describe your task, set a fair PHP budget, and publish to Ormoc freelancers"
        onBack={handleBackPress}
      />

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={[styles.contentInner, isDesktop && styles.desktopTwoCol]}>
          <View style={isDesktop ? styles.desktopFormCol : undefined}>
            {error && (
              <AlertBox tone="danger" message={error} style={{ marginBottom: 16 }} />
            )}

            <Card
              tone="raised"
              padding="md"
              headerTitle="Gig Overview"
              headerSubtitle="Clear titles and structured descriptions attract better proposals"
              headerIcon="document-text-outline"
              style={{ marginBottom: 16 }}
            >
              <TextInput
                label="Gig Title *"
                placeholder="e.g. Need experienced tutor for Grade 10 Math"
                value={title}
                onChangeText={setTitle}
                maxLength={80}
                showCharCount
              />

              <TextInput
                label="Description *"
                placeholder="Detailed explanation of the project or task..."
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={4}
                style={{ minHeight: 90 }}
                maxLength={2000}
                showCharCount
              />

              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 }}>
                <Button
                  title={polishing ? 'Polishing...' : 'Polish with AI'}
                  variant="ai"
                  size="sm"
                  fullWidth={false}
                  loading={polishing}
                  disabled={polishing || !description.trim()}
                  onPress={handlePolishDescription}
                />
              </View>
            </Card>

            {/* Unlocked Multi-Category Picker (features: strings.gigs.didYouMeanLabel, strings.gigs.confirmCreateNewCategoryPrefix, Max 3 categories) */}
            <GigCategoryPicker
              categories={categories}
              catsLoading={catsLoading}
              selectedCategoryId={selectedCategoryId}
              selectedCategoryIds={selectedCategoryIds}
              maxCategories={3}
              customCategoryName={customCategoryName}
              setCustomCategoryName={setCustomCategoryName}
              categoryQuery={categoryQuery}
              setCategoryQuery={setCategoryQuery}
              suggestedCategories={suggestedCategories}
              aiProposedCategory={aiProposedCategory}
              similarCategories={similarCategories}
              suggestLoading={suggestLoading}
              onAiSuggestCategory={handleAiSuggestCategory}
              onSelectExistingCategory={handleSelectExistingCategory}
              onSelectCustomCategory={handleSelectCustomCategory}
            />

            {/* Terms, Budget & Deadlines */}
            <GigTermsForm
              requirements={requirements}
              setRequirements={setRequirements}
              priceMinStr={priceMinStr}
              setPriceMinStr={setPriceMinStr}
              priceMaxStr={priceMaxStr}
              setPriceMaxStr={setPriceMaxStr}
              workType={workType}
              setWorkType={setWorkType}
              area={area}
              setArea={setArea}
              appDays={appDays}
              setAppDays={setAppDays}
              completionDays={completionDays}
              setCompletionDays={setCompletionDays}
              editGigId={editGigId}
              existingGigStatus={existingGigStatus}
              loading={loading}
              onPublish={handlePublish}
              onSaveDraft={handleSaveDraft}
            />
          </View>

          {isDesktop && (
            <View style={styles.desktopPreviewCol}>
              <Text style={[styles.previewTitle, { color: theme.colors.muted }]}>
                LIVE GIG CARD PREVIEW
              </Text>
              <GigCard gig={previewGig} />
              <AlertBox
                tone="info"
                icon="bulb-outline"
                title="Tips for Fast Proposals"
                message={'• Clear deliverables & budget ranges attract 2× more Ormoc freelancers.\n• Use "Polish with AI" to structure your scope clearly.'}
              />
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 60,
  },
  contentInner: {
    maxWidth: 1120,
    width: '100%',
    alignSelf: 'center',
  },
  desktopTwoCol: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 28,
  },
  desktopFormCol: {
    flex: 1.5,
  },
  desktopPreviewCol: {
    flex: 1,
    gap: 12,
  },
  previewTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  blockedContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  blockedIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  blockedTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  blockedDesc: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
});
