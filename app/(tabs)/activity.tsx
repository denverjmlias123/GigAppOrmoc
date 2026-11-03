import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { useAuth } from '../../hooks/useAuth';
import {
  applicationsService,
  ApplicationItem,
  AgreementItem,
} from '../../services/applications';
import { gigsService } from '../../services/gigs';
import { milestonesService } from '../../services/milestones';
import { paymentsService } from '../../services/payments';
import { reviewsService } from '../../services/reviews';
import { chatService } from '../../services/chat';
import { notificationsService } from '../../services/notifications';
import { GigSummary, formatPrice } from '../../components/ui/GigCard';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip, SegmentedControl } from '../../components/ui/Chip';
import { ScreenBackground } from '../../components/ui/ScreenBackground';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { SkeletonActivityList } from '../../components/ui/Skeleton';
import { showToast } from '../../components/ui/Toast';
import { confirmDialog } from '../../lib/dialog';
import { mapSqlErrorToFriendlyMessage, strings } from '../../constants/strings';
import {
  Timeline,
  NextStepBanner,
  LoopStageState,
  computeAgreementLoopState,
  computePreAgreementLoopState,
} from '../../components/ui/Timeline';
import { ClientApplicantReport } from '../../components/reports/ClientApplicantReport';
import { FreelancerApplicationReport } from '../../components/reports/FreelancerApplicationReport';

type ActivityFilter = 'all' | 'action_needed' | 'active' | 'past';
type ActivityTab = 'primary' | 'agreements' | 'reports';

export default function ActivityScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { isWide, isDesktop, topSpace } = useResponsiveLayout();
  const { user, profile } = useAuth();

  const isFindWork = profile?.active_mode === 'find_work';
  const isHire = profile?.active_mode === 'hire';

  const [activeTab, setActiveTab] = useState<ActivityTab>('primary');
  const [statusFilter, setStatusFilter] = useState<ActivityFilter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [counterBusyId, setCounterBusyId] = useState<string | null>(null);

  // Freelancer state
  const [myApplications, setMyApplications] = useState<ApplicationItem[]>([]);

  // Client state
  const [myGigs, setMyGigs] = useState<GigSummary[]>([]);
  const [gigApplicantCounts, setGigApplicantCounts] = useState<Record<string, number>>({});

  // Shared state
  const [myAgreements, setMyAgreements] = useState<AgreementItem[]>([]);
  const [agreementLoopMap, setAgreementLoopMap] = useState<Record<string, LoopStageState>>({});

  const loadData = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoadError(null);
    try {
      let agrs: AgreementItem[] = [];

      if (isFindWork) {
        const [apps, agreementsRes] = await Promise.all([
          applicationsService.getMyApplications(),
          applicationsService.getMyAgreements(),
        ]);
        setMyApplications(apps);
        agrs = agreementsRes;
      } else if (isHire) {
        const [gigs, agreementsRes] = await Promise.all([
          gigsService.getMyGigs(user.id),
          applicationsService.getMyAgreements(),
        ]);
        setMyGigs(gigs);
        agrs = agreementsRes;

        // Fetch applicant counts for each client gig from DB so the Next step banner is accurate
        const countsMap: Record<string, number> = {};
        const openGigs = gigs.filter((gig) => gig.status === 'open');
        await Promise.all(
          openGigs.map(async (g) => {
            const apps = await applicationsService.getGigApplicants(g.id);
            countsMap[g.id] = apps.filter(
              (a) => a.status === 'applied' || a.status === 'countered'
            ).length;
          })
        );
        setGigApplicantCounts(countsMap);
      } else {
        agrs = await applicationsService.getMyAgreements();
      }

      setMyAgreements(agrs);

      // Compute authoritative DB loop stage for each agreement
      const loopMap: Record<string, LoopStageState> = {};
      await Promise.all(
        agrs.map(async (agr) => {
          const agrRole: 'client' | 'freelancer' =
            user.id === agr.client_id ? 'client' : 'freelancer';

          if (agr.status === 'cancelled' || agr.status === 'disputed') {
            loopMap[agr.id] = computeAgreementLoopState({
              viewerRole: agrRole,
              agreementStatus: agr.status,
              agreedPriceCentavos: agr.agreed_price,
              clientName: agr.client?.display_name || 'Client',
              freelancerName: agr.freelancer?.display_name || 'Freelancer',
              milestones: [],
              payments: [],
              reviews: [],
              viewerUserId: user.id,
            });
            return;
          }

          const [mls, pays, revs] = await Promise.all([
            milestonesService.getAgreementMilestones(agr.id),
            paymentsService.getAgreementPayments(agr.id),
            reviewsService.getAgreementReviews(agr.id),
          ]);
          loopMap[agr.id] = computeAgreementLoopState({
            viewerRole: agrRole,
            agreementStatus: agr.status,
            agreedPriceCentavos: agr.agreed_price,
            clientName: agr.client?.display_name || 'Client',
            freelancerName: agr.freelancer?.display_name || 'Freelancer',
            milestones: mls,
            payments: pays,
            reviews: revs,
            viewerUserId: user.id,
          });
        })
      );
      setAgreementLoopMap(loopMap);
    } catch (err) {
      setLoadError(mapSqlErrorToFriendlyMessage(err, 'Failed to load activity data.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, isFindWork, isHire]);

  useFocusEffect(
    useCallback(() => {
      void loadData();
      if (!user?.id) return;
      return notificationsService.subscribeToNotifications(user.id, () => {
        void loadData();
      });
    }, [loadData, user?.id])
  );

  const onRefresh = () => {
    setRefreshing(true);
    void loadData();
  };

  const handleOpenApplicationChat = useCallback(async (applicationId: string, partnerName: string) => {
    try {
      const convId = await chatService.getOrCreateConversation({ applicationId });
      router.push({
        pathname: '/chat/[conversationId]',
        params: { conversationId: convId, partnerName },
      });
    } catch (err: any) {
      showToast(err?.message || 'Could not open conversation.', 'error');
    }
  }, [router]);

  const handleRespondToCounter = useCallback(async (
    app: ApplicationItem,
    action: 'accept' | 'decline' | 'withdraw'
  ) => {
    if (action === 'withdraw') {
      const confirmed = await confirmDialog({
        title: 'Withdraw Proposal',
        message: 'Are you sure you want to withdraw this application? This action cannot be undone.',
        confirmText: 'Withdraw',
        cancelText: 'Cancel',
      });
      if (!confirmed) return;
    }

    setCounterBusyId(app.id);
    try {
      const agreementId = await applicationsService.respondToCounter(app.id, action);
      showToast(
        action === 'accept'
          ? strings.toasts.counterAccepted
          : action === 'withdraw'
          ? 'Proposal withdrawn successfully.'
          : strings.toasts.counterDeclined
      );
      await loadData();
      if (action === 'accept' && agreementId) {
        router.push({ pathname: '/agreements/[id]', params: { id: agreementId } });
      }
    } catch (err: any) {
      showToast(err?.message || 'Could not process proposal action.', 'error');
    } finally {
      setCounterBusyId(null);
    }
  }, [loadData, router]);

  const renderFreelancerPrimaryTab = () => {
    const filteredApps = myApplications.filter((app) => {
      if (statusFilter === 'all') return true;
      if (statusFilter === 'action_needed') return app.status === 'countered';
      if (statusFilter === 'active') return app.status === 'applied' || app.status === 'accepted';
      if (statusFilter === 'past') return ['declined', 'withdrawn'].includes(app.status) || app.status_reason === 'gig_deleted';
      return true;
    });

    if (filteredApps.length === 0) {
      return (
        <EmptyState
          title="No applications yet"
          description="Browse open gigs in Ormoc and submit your first proposal."
          actionTitle="Browse Gigs"
          onAction={() => router.push('/(tabs)/gigs')}
        />
      );
    }

    return (
      <View style={[styles.list, isDesktop && styles.gridList]}>
        {filteredApps.map((app) => {
          const deleted = app.status_reason === 'gig_deleted';
          const preLoop = computePreAgreementLoopState({
            viewerRole: 'freelancer',
            gigStatus: 'open',
            applicationStatus: app.status,
            counterPriceCentavos: app.counter_price,
          });
          const isBusy = counterBusyId === app.id;

          return (
            <Card
              key={app.id}
              tone="raised"
              padding="md"
              style={[styles.card, isDesktop && styles.gridCardItem]}
            >
              <Pressable
                onPress={() => {
                  if (app.gig_id && !deleted) {
                    router.push({ pathname: '/gigs/[id]', params: { id: app.gig_id } });
                  }
                }}
              >
                <View style={styles.cardHeader}>
                  <Text style={[styles.cardTitle, { color: theme.colors.text }]} numberOfLines={1}>
                    {app.gig?.title || app.gig_title_snapshot || 'Gig'}
                  </Text>
                  {deleted ? <Badge status="deleted" label={strings.gigs.deletedGigProposal} /> : <Badge status={app.status} />}
                </View>

                <View style={styles.cardRow}>
                  <Text style={[styles.cardMetaLabel, { color: theme.colors.muted }]}>
                    My Proposal:
                  </Text>
                  <Text style={[styles.cardPrice, { color: theme.colors.primary }]}>
                    {formatPrice(app.proposed_price)}
                  </Text>
                </View>
              </Pressable>

              {/* Compact Shared Timeline & Next Step Banner */}
              {deleted ? (
                <Text style={[styles.cardMetaLabel, { color: theme.colors.muted, marginVertical: 10 }]}>
                  {strings.gigs.deletedGigProposalDesc}
                </Text>
              ) : (
                <>
                  <Timeline
                    currentStage={preLoop.currentStage}
                    viewerRole="freelancer"
                    loopState={preLoop}
                    compact
                  />
                  <NextStepBanner
                    loopState={preLoop}
                    compact
                    onOpenChatPress={() => handleOpenApplicationChat(app.id, app.gig?.client?.display_name || 'Client')}
                  />
                </>
              )}

              {/* Counteroffer response actions if status === 'countered' */}
              {!deleted && app.status === 'countered' && app.counter_price && (
                <View style={styles.counterActionRow}>
                  <Button
                    title={isBusy ? 'Saving...' : `Accept ${formatPrice(app.counter_price)}`}
                    variant="primary"
                    size="sm"
                    fullWidth={false}
                    loading={isBusy}
                    disabled={isBusy}
                    onPress={() => handleRespondToCounter(app, 'accept')}
                    style={{ flexGrow: 1 }}
                  />
                  <Button
                    title="Decline"
                    variant="danger-soft"
                    size="sm"
                    fullWidth={false}
                    disabled={isBusy}
                    onPress={() => handleRespondToCounter(app, 'decline')}
                  />
                  <Button
                    title="Withdraw"
                    variant="secondary"
                    size="sm"
                    fullWidth={false}
                    disabled={isBusy}
                    onPress={() => handleRespondToCounter(app, 'withdraw')}
                  />
                </View>
              )}

              {/* Withdraw action if proposal is pending (status === 'applied') */}
              {!deleted && app.status === 'applied' && (
                <View style={[styles.counterActionRow, { justifyContent: 'flex-end' }]}>
                  <Button
                    title={isBusy ? 'Processing...' : 'Withdraw Proposal'}
                    variant="secondary"
                    size="sm"
                    fullWidth={false}
                    disabled={isBusy}
                    onPress={() => handleRespondToCounter(app, 'withdraw')}
                  />
                </View>
              )}

              <View style={[styles.cardFooter, { borderTopColor: theme.colors.border }]}>
                <Text style={[styles.cardFooterText, { color: theme.colors.muted }]}>
                  Est. {app.estimated_days} day{app.estimated_days > 1 ? 's' : ''} • Applied{' '}
                  {new Date(app.created_at).toLocaleDateString()}
                </Text>
              </View>
            </Card>
          );
        })}
      </View>
    );
  };

  const renderClientPrimaryTab = () => {
    const openGigs = myGigs.filter((gig) => gig.status === 'open').filter((gig) => {
      const pendingApplicants = gigApplicantCounts[gig.id] || 0;
      if (statusFilter === 'action_needed') return pendingApplicants > 0;
      return true;
    });
    if (openGigs.length === 0) {
      return (
        <EmptyState
          title={strings.gigs.noOpenClientGigsTitle}
          description={strings.gigs.noOpenClientGigsDesc}
          actionTitle={strings.gigs.viewMyGigs}
          onAction={() => router.push('/(tabs)/gigs')}
        />
      );
    }

    return (
      <View style={[styles.list, isDesktop && styles.gridList]}>
        {openGigs.map((gig) => {
          const pendingApplicants = gigApplicantCounts[gig.id] || 0;
          const preLoop = computePreAgreementLoopState({
            viewerRole: 'client',
            gigStatus: gig.status,
            applicantCount: pendingApplicants,
          });

          return (
            <Card
              key={gig.id}
              tone="raised"
              padding="md"
              style={[styles.card, isDesktop && styles.gridCardItem]}
              onPress={() => {
                router.push({ pathname: '/gigs/[id]/applicants', params: { id: gig.id } });
              }}
            >
              <View style={styles.cardHeader}>
                <Text style={[styles.cardTitle, { color: theme.colors.text }]} numberOfLines={1}>
                  {gig.title}
                </Text>
                <Badge status={gig.status} />
              </View>

              <View style={styles.cardRow}>
                <Text style={[styles.cardMetaLabel, { color: theme.colors.muted }]}>
                  Budget Range:
                </Text>
                <Text style={[styles.cardPrice, { color: theme.colors.primary }]}>
                  {formatPrice(gig.price_min)} - {formatPrice(gig.price_max)}
                </Text>
              </View>

              {/* Compact Shared Timeline & Next Step Banner */}
              <Timeline
                currentStage={preLoop.currentStage}
                viewerRole="client"
                loopState={preLoop}
                compact
              />

              <NextStepBanner
                loopState={preLoop}
                compact
                actionLabel={pendingApplicants > 0 ? `Review Applicants (${pendingApplicants})` : undefined}
                onActionPress={
                  pendingApplicants > 0
                    ? () => router.push({ pathname: '/gigs/[id]/applicants', params: { id: gig.id } })
                    : undefined
                }
              />

              <View style={[styles.cardFooter, { borderTopColor: theme.colors.border }]}>
                <Text style={[styles.cardFooterLink, { color: theme.colors.primary }]}>
                  👥 View Applicants {pendingApplicants > 0 ? `(${pendingApplicants})` : ''} ›
                </Text>
              </View>
            </Card>
          );
        })}
      </View>
    );
  };

  const renderAgreementsTab = () => {
    const filteredAgreements = myAgreements.filter((agr) => {
      if (statusFilter === 'all') return true;
      if (statusFilter === 'active' || statusFilter === 'action_needed') return agr.status === 'active';
      if (statusFilter === 'past') return ['completed', 'cancelled', 'disputed'].includes(agr.status);
      return true;
    });

    if (filteredAgreements.length === 0) {
      return (
        <EmptyState
          title="No active agreements"
          description="When a proposal is accepted, an agreement is created here."
        />
      );
    }

    return (
      <View style={[styles.list, isDesktop && styles.gridList]}>
        {filteredAgreements.map((agr) => {
          const isAgrClient = user?.id === agr.client_id;
          const counterParty = isAgrClient ? agr.freelancer : agr.client;
          const roleLabel = isAgrClient ? 'Freelancer' : 'Client';
          const agrLoop =
            agreementLoopMap[agr.id] ||
            computeAgreementLoopState({
              viewerRole: isAgrClient ? 'client' : 'freelancer',
              agreementStatus: agr.status,
              agreedPriceCentavos: agr.agreed_price,
              clientName: agr.client?.display_name || 'Client',
              freelancerName: agr.freelancer?.display_name || 'Freelancer',
              milestones: [],
              payments: [],
              reviews: [],
              viewerUserId: user?.id,
            });

          return (
            <Card
              key={agr.id}
              tone="raised"
              padding="md"
              style={[styles.card, isDesktop && styles.gridCardItem]}
              onPress={() => {
                router.push({ pathname: '/agreements/[id]', params: { id: agr.id } });
              }}
            >
              <View style={styles.cardHeader}>
                <Text style={[styles.cardTitle, { color: theme.colors.text }]} numberOfLines={1}>
                  {agr.gig?.title || 'Gig Agreement'}
                </Text>
                <Badge status={agr.status} />
              </View>

              <View style={styles.cardRow}>
                <Text style={[styles.cardMetaLabel, { color: theme.colors.muted }]}>
                  Agreed Price:
                </Text>
                <Text style={[styles.cardPrice, { color: theme.colors.primary }]}>
                  {formatPrice(agr.agreed_price)}
                </Text>
              </View>

              {counterParty && (
                <View style={styles.cardRow}>
                  <Text style={[styles.cardMetaLabel, { color: theme.colors.muted }]}>
                    {roleLabel}:
                  </Text>
                  <Text style={[styles.cardMetaValue, { color: theme.colors.text }]}>
                    {counterParty.display_name}
                  </Text>
                </View>
              )}

              {/* Compact Shared Timeline & Next Step Banner */}
              <Timeline
                currentStage={agrLoop.currentStage}
                viewerRole={isAgrClient ? 'client' : 'freelancer'}
                loopState={agrLoop}
                compact
              />

              <NextStepBanner
                loopState={agrLoop}
                compact
                actionLabel="Open Agreement ›"
                onActionPress={() =>
                  router.push({ pathname: '/agreements/[id]', params: { id: agr.id } })
                }
              />

              <View style={[styles.cardFooter, { borderTopColor: theme.colors.border }]}>
                <Text style={[styles.cardFooterText, { color: theme.colors.muted }]}>
                  Deadline: {new Date(agr.deadline).toLocaleDateString()}
                </Text>
                <Text style={[styles.cardFooterLink, { color: theme.colors.primary }]}>
                  View Agreement ›
                </Text>
              </View>
            </Card>
          );
        })}
      </View>
    );
  };

  return (
    <ScreenBackground style={styles.container}>
      <View
        style={[
          styles.topArea,
          {
            backgroundColor: theme.colors.surface,
            borderBottomColor: theme.colors.border,
            paddingTop: isWide ? 24 : topSpace,
          },
        ]}
      >
        <View style={styles.topAreaInner}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Activity</Text>
            <Text style={[styles.headerSubtitle, { color: theme.colors.muted }]}>
              {isFindWork
                ? 'Track your proposals & active work'
                : 'Manage your posted gigs & agreements'}
            </Text>
          </View>

          {/* Segmented Control Tabs */}
          <View style={[styles.tabBar, isWide && { maxWidth: theme.layout.authMaxWidth }]}>
            <SegmentedControl<ActivityTab>
              options={[
                { value: 'primary', label: isFindWork ? 'Proposals' : 'Applicants' },
                {
                  value: 'agreements',
                  label: isFindWork ? 'Jobs' : 'Hired',
                  count: myAgreements.length > 0 ? myAgreements.length : undefined,
                },
                { value: 'reports', label: 'Reports', icon: 'bar-chart-outline' },
              ]}
              value={activeTab}
              onChange={(nextTab) => {
                if (nextTab === 'reports') {
                  setActiveTab('reports');
                } else {
                  setActiveTab(nextTab);
                }
              }}
            />
          </View>

          {/* Status Filter Chips (hidden when viewing reports) */}
          {activeTab !== 'reports' && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterChipsRow}
            >
              <Chip
                label="All"
                selected={statusFilter === 'all'}
                onPress={() => setStatusFilter('all')}
              />
              <Chip
                label="Action Needed"
                selected={statusFilter === 'action_needed'}
                onPress={() => setStatusFilter('action_needed')}
              />
              <Chip
                label="Active"
                selected={statusFilter === 'active'}
                onPress={() => setStatusFilter('active')}
              />
              <Chip
                label="Past"
                selected={statusFilter === 'past'}
                onPress={() => setStatusFilter('past')}
              />
            </ScrollView>
          )}
        </View>
      </View>

      {/* Content */}
      {loading ? (
        <SkeletonActivityList count={3} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <View style={styles.scrollInner}>
            {loadError ? (
              <ErrorState message={loadError} onRetry={loadData} />
            ) : activeTab === 'reports' ? (
              isFindWork ? (
                <FreelancerApplicationReport />
              ) : (
                <ClientApplicantReport clientId={user?.id || ''} />
              )
            ) : activeTab === 'primary' ? (
              isFindWork ? (
                renderFreelancerPrimaryTab()
              ) : (
                renderClientPrimaryTab()
              )
            ) : (
              renderAgreementsTab()
            )}
          </View>
        </ScrollView>
      )}
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topArea: {
    borderBottomWidth: 1,
  },
  topAreaInner: {
    maxWidth: 1120,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 14,
    marginTop: 4,
  },
  tabBar: {
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  filterChipsRow: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 8,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    flexGrow: 1,
  },
  scrollInner: {
    maxWidth: 1120,
    width: '100%',
    alignSelf: 'center',
  },
  list: {
    gap: 12,
  },
  gridList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  card: {
    gap: 8,
  },
  gridCardItem: {
    flexBasis: '48.8%',
    flexGrow: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardMetaLabel: {
    fontSize: 13,
  },
  cardMetaValue: {
    fontSize: 13,
    fontWeight: '500',
  },
  cardPrice: {
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  counterActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
  },
  cardFooterText: {
    fontSize: 12,
  },
  cardFooterLink: {
    fontSize: 13,
    fontWeight: '700',
  },
});
