import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput as RNTextInput,
  RefreshControl,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { useAuth } from '../../hooks/useAuth';
import { gigsService } from '../../services/gigs';
import { applicationsService } from '../../services/applications';
import { profileService, Category, FreelancerSummary } from '../../services/profile';
import { GigCard, GigSummary } from '../../components/ui/GigCard';
import { FreelancerCard } from '../../components/ui/FreelancerCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { SkeletonGigList } from '../../components/ui/Skeleton';
import { Button, IconButton } from '../../components/ui/Button';
import { Chip, SegmentedControl } from '../../components/ui/Chip';
import { ScreenBackground } from '../../components/ui/ScreenBackground';
import { mapSqlErrorToFriendlyMessage, strings } from '../../constants/strings';
import { confirmDialog } from '../../lib/dialog';
import { showToast } from '../../components/ui/Toast';

type WorkTypeFilter = 'all' | 'remote' | 'face_to_face' | 'hybrid';
type ClientSegment = 'my_gigs' | 'find_freelancers' | 'marketplace';
type ClientStatusFilter = 'all' | 'open' | 'draft' | 'in_progress' | 'closed';

export default function GigsScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { isWide, isDesktop, topSpace } = useResponsiveLayout();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ tab?: string; categoryId?: string }>();

  const isClient = theme.isClient;

  // Freelancer / Shared Browse State
  const [gigs, setGigs] = useState<GigSummary[]>([]);
  const [freelancers, setFreelancers] = useState<FreelancerSummary[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [workTypeFilter, setWorkTypeFilter] = useState<WorkTypeFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [showMobileCategories, setShowMobileCategories] = useState(false);

  // Client Specific State
  const [clientSegment, setClientSegment] = useState<ClientSegment>('my_gigs');
  const [myGigs, setMyGigs] = useState<GigSummary[]>([]);
  const [clientStatusFilter, setClientStatusFilter] = useState<ClientStatusFilter>('all');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingGigId, setDeletingGigId] = useState<string | null>(null);

  // Sync route params when navigating into this screen
  React.useEffect(() => {
    if (params.tab === 'find_freelancers') {
      setClientSegment('find_freelancers');
    }
    if (params.categoryId) {
      setSelectedCategory(params.categoryId);
    }
  }, [params.tab, params.categoryId]);

  const hasLoadedRef = useRef(false);
  const lastSegmentRef = useRef<string>(clientSegment);

  const loadData = async (searchOverride = searchQuery, isRefresh = false) => {
    const isSegmentChange = lastSegmentRef.current !== clientSegment;
    lastSegmentRef.current = clientSegment;

    if (!isRefresh && (!hasLoadedRef.current || isSegmentChange)) {
      setLoading(true);
    }
    setError(null);
    try {
      if (isClient && clientSegment === 'my_gigs') {
        if (user) {
          const myGigsData = await gigsService.getMyGigs(user.id);
          setMyGigs(myGigsData);
        }
      } else if (isClient && clientSegment === 'find_freelancers') {
        const [categoriesData, freelancersData] = await Promise.all([
          gigsService.getBrowseCategories(),
          profileService.getTopFreelancers({
            searchQuery: searchOverride.trim() || undefined,
            categoryId: selectedCategory || undefined,
            limit: 30,
          }),
        ]);
        setCategories(categoriesData);
        setFreelancers(freelancersData);
      } else {
        const [categoriesData, gigsData] = await Promise.all([
          gigsService.getBrowseCategories(),
          gigsService.getGigs({
            categoryId: selectedCategory || undefined,
            workType: workTypeFilter === 'all' ? undefined : workTypeFilter,
            searchQuery: searchOverride.trim() || undefined,
          }),
        ]);
        setCategories(categoriesData);
        setGigs(gigsData);
      }
      hasLoadedRef.current = true;
    } catch (err: any) {
      setError(err?.message || 'Failed to load data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadDataRef = useRef(loadData);
  loadDataRef.current = loadData;

  useFocusEffect(
    useCallback(() => {
      void loadDataRef.current();
      return gigsService.subscribeToGigChanges(
        () => void loadDataRef.current(undefined, true),
        isClient && clientSegment === 'my_gigs' ? user?.id : undefined
      );
    }, [isClient, clientSegment, selectedCategory, workTypeFilter, user?.id])
  );

  const hasActiveFilters = Boolean(
    selectedCategory ||
    workTypeFilter !== 'all' ||
    searchQuery.trim().length > 0
  );

  const handleClearFilters = useCallback(() => {
    setSearchQuery('');
    setSelectedCategory(null);
    setWorkTypeFilter('all');
  }, []);

  const handleGigPress = useCallback((gigId: string) => {
    router.push({ pathname: '/gigs/[id]', params: { id: gigId } });
  }, [router]);

  const handleSearchSubmit = () => {
    void loadData();
  };

  const onRefresh = () => {
    setRefreshing(true);
    void loadData(searchQuery, true);
  };

  const handleDeleteGig = async (gig: GigSummary) => {
    try {
      const applications = await applicationsService.getGigApplicants(gig.id);
      const pending = applications.filter((app) => app.status === 'applied' || app.status === 'countered').length;
      const confirmed = await confirmDialog({
        title: strings.gigs.deleteGigTitle,
        message: pending > 0
          ? pending === 1 ? strings.gigs.deleteGigApplicantsOneMessage : strings.gigs.deleteGigApplicantsManyMessage.replace('{count}', String(pending))
          : strings.gigs.deleteGigNoApplicantsMessage,
        confirmText: strings.gigs.deleteGigConfirm,
        cancelText: strings.gigs.keepGig,
        destructive: true,
      });
      if (!confirmed) return;
      setDeletingGigId(gig.id);
      const notified = await gigsService.deleteGig(gig.id, 'Deleted by client');
      await loadData();
      showToast(notified === 1 ? strings.toasts.gigDeletedOneApplicant : notified > 1 ? strings.toasts.gigDeletedApplicants.replace('{count}', String(notified)) : strings.toasts.gigDeleted);
    } catch (err: any) {
      showToast(mapSqlErrorToFriendlyMessage(err, 'Could not delete this gig.'), 'error');
    } finally {
      setDeletingGigId(null);
    }
  };

  const workFilters: { id: WorkTypeFilter; label: string; icon?: React.ComponentProps<typeof Ionicons>['name'] }[] = [
    { id: 'all', label: strings.gigs.filterAll },
    { id: 'remote', label: strings.gigs.filterRemote, icon: 'laptop-outline' },
    { id: 'face_to_face', label: strings.gigs.filterFaceToFace, icon: 'people-outline' },
    { id: 'hybrid', label: strings.gigs.filterHybrid, icon: 'swap-horizontal-outline' },
  ];

  const clientStatusFilters: { id: ClientStatusFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'open', label: 'Open' },
    { id: 'draft', label: 'Drafts' },
    { id: 'in_progress', label: 'In Progress' },
    { id: 'closed', label: 'Closed' },
  ];

  const clientStatusCounts = React.useMemo(() => {
    const counts: Record<ClientStatusFilter, number> = {
      all: myGigs.length,
      open: 0,
      draft: 0,
      in_progress: 0,
      closed: 0,
    };
    for (const g of myGigs) {
      const s = (g.status || '').toLowerCase().trim();
      if (s === 'open' || s === 'active') {
        counts.open += 1;
      } else if (s === 'draft' || s === 'drafts') {
        counts.draft += 1;
      } else if (s === 'in_progress' || s === 'in-progress' || s === 'progress') {
        counts.in_progress += 1;
      } else if (['completed', 'cancelled', 'expired', 'closed'].includes(s)) {
        counts.closed += 1;
      }
    }
    return counts;
  }, [myGigs]);

  const filteredMyGigs = myGigs.filter((g) => {
    const s = (g.status || '').toLowerCase().trim();
    if (clientStatusFilter === 'all') return true;
    if (clientStatusFilter === 'closed') {
      return ['completed', 'cancelled', 'expired', 'closed'].includes(s);
    }
    if (clientStatusFilter === 'open') {
      return s === 'open' || s === 'active';
    }
    if (clientStatusFilter === 'draft') {
      return s === 'draft' || s === 'drafts';
    }
    if (clientStatusFilter === 'in_progress') {
      return s === 'in_progress' || s === 'in-progress' || s === 'progress';
    }
    return s === clientStatusFilter;
  });

  const selectedCategoryName = categories.find((c) => c.id === selectedCategory)?.name;

  return (
    <ScreenBackground style={styles.container}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: theme.colors.surface,
            borderBottomColor: theme.colors.border,
            paddingTop: isWide ? 24 : topSpace,
          },
        ]}
      >
        <View style={styles.headerInner}>
          <View style={styles.titleRow}>
            <Text style={[theme.type.title, { color: theme.colors.text }]}>
              {isClient ? 'My Gigs' : 'Browse Gigs'}
            </Text>
            {isClient && (
              <Button
                title="Post Gig"
                icon="add"
                size="sm"
                fullWidth={false}
                onPress={() => router.push('/gigs/post')}
              />
            )}
          </View>

          {/* Client Segmented Control: My Gigs vs Find Freelancers vs Market Feed */}
          {isClient && (
            <View style={[{ marginBottom: 12 }, isWide && { maxWidth: theme.layout.authMaxWidth }]}>
              <SegmentedControl<ClientSegment>
                options={[
                  { value: 'my_gigs', label: 'My Gigs', count: myGigs.length },
                  { value: 'find_freelancers', label: 'Find Freelancers' },
                  { value: 'marketplace', label: 'Market Feed' },
                ]}
                value={clientSegment}
                onChange={setClientSegment}
              />
            </View>
          )}

          {/* Search Input for Browse / Marketplace / Find Freelancers */}
          {(!isClient || clientSegment === 'marketplace' || clientSegment === 'find_freelancers') && (
            <>
              <View style={styles.searchFilterBar}>
                <View
                  style={[
                    styles.searchBox,
                    {
                      backgroundColor: searchFocused ? theme.colors.surface : theme.colors.surfaceAlt,
                      borderRadius: theme.radii.input,
                      borderColor: searchFocused ? theme.colors.primary : theme.colors.border,
                      borderWidth: 1,
                    },
                  ]}
                >
                  <Ionicons
                    name="search"
                    size={18}
                    color={searchFocused ? theme.colors.primary : theme.colors.muted}
                  />
                  <RNTextInput
                    style={[
                      styles.searchInput,
                      { color: theme.colors.text },
                      Platform.OS === 'web' && ({ outlineStyle: 'none' } as any),
                    ]}
                    placeholder={
                      clientSegment === 'find_freelancers'
                        ? 'Search freelancers by name, skill (e.g. Graphic Design, Web)...'
                        : 'Search gigs by title, skill, or keyword...'
                    }
                    placeholderTextColor={theme.colors.muted}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => setSearchFocused(false)}
                    onSubmitEditing={handleSearchSubmit}
                    returnKeyType="search"
                  />
                  {searchQuery ? (
                    <Pressable
                      onPress={() => {
                        setSearchQuery('');
                        void loadData('');
                      }}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Clear search"
                    >
                      <Ionicons name="close-circle" size={18} color={theme.colors.muted} />
                    </Pressable>
                  ) : null}
                  <Button
                    title="Search"
                    size="xs"
                    fullWidth={false}
                    onPress={handleSearchSubmit}
                  />
                </View>

                {!isWide && categories.length > 0 && (
                  <IconButton
                    icon="options-outline"
                    variant={selectedCategory ? 'soft' : 'secondary'}
                    size="md"
                    onPress={() => setShowMobileCategories((prev) => !prev)}
                    accessibilityLabel="Toggle category filter"
                  />
                )}
              </View>

              {/* Work type filters only apply to job posts */}
              {(!isClient || clientSegment === 'marketplace') && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                  {workFilters.map((f) => (
                    <Chip
                      key={f.id}
                      label={f.label}
                      icon={f.icon}
                      selected={workTypeFilter === f.id}
                      onPress={() => setWorkTypeFilter(f.id)}
                    />
                  ))}
                  {!isWide && selectedCategoryName && !showMobileCategories ? (
                    <Chip
                      label={selectedCategoryName}
                      selected
                      onPress={() => setSelectedCategory(null)}
                      onRemove={() => setSelectedCategory(null)}
                    />
                  ) : null}
                </ScrollView>
              )}

              {categories.length > 0 && (isWide || showMobileCategories || clientSegment === 'find_freelancers') && (
                <ScrollView
                  horizontal={!isWide}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={[
                    styles.filterRow,
                    { marginTop: 6 },
                    isWide && { flexWrap: 'wrap' },
                  ]}
                >
                  <Chip
                    key="cat-all"
                    label={strings.gigs.filterAllCategories}
                    selected={selectedCategory === null}
                    onPress={() => setSelectedCategory(null)}
                  />
                  {categories.map((cat) => (
                    <Chip
                      key={`cat-${cat.id}`}
                      label={cat.name}
                      selected={selectedCategory === cat.id}
                      onPress={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
                    />
                  ))}
                </ScrollView>
              )}
            </>
          )}

          {/* Status Filters for Client My Gigs */}
          {isClient && clientSegment === 'my_gigs' && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {clientStatusFilters.map((f) => (
                <Chip
                  key={f.id}
                  label={f.label}
                  count={clientStatusCounts[f.id]}
                  selected={clientStatusFilter === f.id}
                  onPress={() => setClientStatusFilter(f.id)}
                />
              ))}
            </ScrollView>
          )}
        </View>
      </View>

      {/* List Body */}
      <ScrollView
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
          />
        }
      >
        <View style={styles.listInner}>
          {error ? (
            <ErrorState message={error} onRetry={() => loadData()} />
          ) : loading ? (
            <SkeletonGigList count={3} />
          ) : isClient && clientSegment === 'my_gigs' ? (
            filteredMyGigs.length === 0 ? (
              <EmptyState
                icon="briefcase-outline"
                title="No posted gigs found"
                description={
                  clientStatusFilter !== 'all'
                    ? `You have no ${clientStatusFilters.find((f) => f.id === clientStatusFilter)?.label.toLowerCase() || clientStatusFilter} gigs.`
                    : "You have not created any gigs yet."
                }
                actionTitle={clientStatusFilter !== 'all' ? "View All Gigs" : "Post a Gig"}
                onAction={
                  clientStatusFilter !== 'all'
                    ? () => setClientStatusFilter('all')
                    : () => router.push('/gigs/post')
                }
              />
            ) : (
              <View style={isWide ? styles.gridContainer : undefined}>
                {filteredMyGigs.map((gig) => (
                  <GigCard
                    key={gig.id}
                    gig={gig}
                    onPress={() => handleGigPress(gig.id)}
                    onDelete={['open', 'draft', 'cancelled', 'expired'].includes(gig.status) ? () => handleDeleteGig(gig) : undefined}
                    deleting={deletingGigId === gig.id}
                    style={isWide ? styles.gridCard : undefined}
                  />
                ))}
              </View>
            )
          ) : isClient && clientSegment === 'find_freelancers' ? (
            freelancers.length === 0 ? (
              <EmptyState
                icon="search-outline"
                title="No freelancers found"
                description={
                  hasActiveFilters
                    ? "No freelancers match your search or category filter in Ormoc City."
                    : "No freelancers match your search or category filter."
                }
                actionTitle={hasActiveFilters ? "Clear Filters" : "Refresh"}
                onAction={hasActiveFilters ? handleClearFilters : () => void loadData()}
              />
            ) : (
              <View style={isWide ? styles.gridContainer : undefined}>
                {freelancers.map((freelancer) => (
                  <FreelancerCard
                    key={freelancer.id}
                    freelancer={freelancer}
                    style={isWide ? styles.gridCard : undefined}
                    onPress={() =>
                      router.push({
                        pathname: '/profile/[id]',
                        params: { id: freelancer.id },
                      })
                    }
                  />
                ))}
              </View>
            )
          ) : gigs.length === 0 ? (
            <EmptyState
              icon="search-outline"
              title={hasActiveFilters ? "No matching gigs found" : strings.gigs.noGigsTitle}
              description={
                hasActiveFilters
                  ? "No open gigs match your search keyword or active filters in Ormoc City. Try clearing them to see all available work."
                  : strings.gigs.noGigsDesc
              }
              actionTitle={hasActiveFilters ? "Clear Filters" : "Refresh"}
              onAction={hasActiveFilters ? handleClearFilters : () => void loadData()}
            />
          ) : (
            <View style={isWide ? styles.gridContainer : undefined}>
              {gigs.map((gig) => (
                <GigCard
                  key={gig.id}
                  gig={gig}
                  onPress={() => handleGigPress(gig.id)}
                  style={isWide ? styles.gridCard : undefined}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerInner: {
    maxWidth: 1120,
    width: '100%',
    alignSelf: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  searchFilterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 6,
    height: 46,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 15, height: '100%' },
  filterRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  listContent: { padding: 16, paddingBottom: 40 },
  listInner: {
    maxWidth: 1120,
    width: '100%',
    alignSelf: 'center',
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  gridCard: {
    flexBasis: '48.8%',
    flexGrow: 1,
    marginBottom: 0,
  },
});
