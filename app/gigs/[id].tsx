import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { useAuth } from '../../hooks/useAuth';
import { gigsService, GigDetail } from '../../services/gigs';
import {
  applicationsService,
  ApplicationItem,
  AgreementItem,
} from '../../services/applications';
import { milestonesService } from '../../services/milestones';
import { paymentsService } from '../../services/payments';
import { reviewsService } from '../../services/reviews';
import { chatService } from '../../services/chat';
import { notificationsService } from '../../services/notifications';
import { Badge } from '../../components/ui/Badge';
import { showToast } from '../../components/ui/Toast';
import { confirmDialog } from '../../lib/dialog';
import { Button } from '../../components/ui/Button';
import { AlertBox, PageHeaderBox, StickyFooterBox } from '../../components/ui/Card';
import { ScreenBackground } from '../../components/ui/ScreenBackground';
import {
  Timeline,
  NextStepBanner,
  LoopStageState,
  computeAgreementLoopState,
  computePreAgreementLoopState,
} from '../../components/ui/Timeline';
import { GigDetailInfo } from '../../components/gigs/GigDetailInfo';
import { ManageGigModal } from '../../components/gigs/ManageGigModal';
import { mapSqlErrorToFriendlyMessage, strings } from '../../constants/strings';

export default function GigDetailScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { isWide, isDesktop } = useResponsiveLayout();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, profile } = useAuth();

  const [gig, setGig] = useState<GigDetail | null>(null);
  const [myApplication, setMyApplication] = useState<ApplicationItem | null>(null);
  const [gigAgreement, setGigAgreement] = useState<AgreementItem | null>(null);
  const [loopState, setLoopState] = useState<LoopStageState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [manageSheetVisible, setManageSheetVisible] = useState(false);

  const loadGigAndLoop = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await gigsService.getGig(id);
      if (!data) {
        // Closed gigs are intentionally hidden from the public gigs query. Keep
        // participant history reachable through the agreement row instead.
        const myAgreements = user ? await applicationsService.getMyAgreements() : [];
        const matchingAgr = myAgreements.find((agreement) => agreement.gig_id === id) || null;
        if (matchingAgr) {
          router.replace({ pathname: '/agreements/[id]', params: { id: matchingAgr.id } });
          return;
        }
        setGigAgreement(null);
        return;
      }
      setGig(data);

      const isOwner = user?.id === data.client_id;
      const viewerRole: 'client' | 'freelancer' = isOwner
        ? 'client'
        : profile?.active_mode === 'hire'
        ? 'client'
        : 'freelancer';

      // Check if an agreement exists for this gig where caller is a participant
      const myAgreements = user ? await applicationsService.getMyAgreements() : [];
      const matchingAgr = myAgreements.find((a) => a.gig_id === data.id) || null;
      setGigAgreement(matchingAgr);

      if (matchingAgr && user) {
        const [mls, pays, revs] = await Promise.all([
          milestonesService.getAgreementMilestones(matchingAgr.id),
          paymentsService.getAgreementPayments(matchingAgr.id),
          reviewsService.getAgreementReviews(matchingAgr.id),
        ]);
        const agrViewerRole: 'client' | 'freelancer' =
          user.id === matchingAgr.client_id ? 'client' : 'freelancer';
        setLoopState(
          computeAgreementLoopState({
            viewerRole: agrViewerRole,
            agreementStatus: matchingAgr.status,
            agreedPriceCentavos: matchingAgr.agreed_price,
            clientName: matchingAgr.client?.display_name || data.client.display_name || 'Client',
            freelancerName: matchingAgr.freelancer?.display_name || 'Freelancer',
            milestones: mls,
            payments: pays,
            reviews: revs,
            viewerUserId: user.id,
          })
        );
        return;
      }

      if (isOwner) {
        const apps = await applicationsService.getGigApplicants(data.id);
        const pendingCount = apps.filter(
          (a) => a.status === 'applied' || a.status === 'countered'
        ).length;
        setLoopState(
          computePreAgreementLoopState({
            viewerRole: 'client',
            gigStatus: data.status,
            applicantCount: pendingCount,
            clientName: data.client.display_name,
          })
        );
      } else if (user) {
        const myApps = await applicationsService.getMyApplications();
        const foundApp = myApps.find((a) => a.gig_id === data.id) || null;
        setMyApplication(foundApp);
        setLoopState(
          computePreAgreementLoopState({
            viewerRole,
            gigStatus: data.status,
            applicationStatus: foundApp?.status || null,
            clientName: data.client.display_name,
            counterPriceCentavos: foundApp?.counter_price,
          })
        );
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load gig details.');
    } finally {
      setLoading(false);
    }
  }, [id, user?.id, profile?.active_mode]);

  useFocusEffect(
    useCallback(() => {
      void loadGigAndLoop();
      if (!user?.id) return;
      return notificationsService.subscribeToNotifications(user.id, () => {
        void loadGigAndLoop();
      });
    }, [loadGigAndLoop, user?.id])
  );

  if (loading) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (error || !gig) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.colors.background }]}>
        <Text style={[styles.errorTitle, { color: theme.colors.text }]}>
          {error ? strings.common.errorTitle : strings.gigs.gigUnavailableTitle}
        </Text>
        <Text style={[styles.errorDesc, { color: theme.colors.muted }]}>
          {error || strings.gigs.gigUnavailable}
        </Text>
        {gigAgreement ? (
          <>
            <Text style={[styles.errorDesc, { color: theme.colors.muted }]}>
              {strings.gigs.unavailableAgreementDesc}
            </Text>
            <Button
              title={strings.gigs.openAgreement}
              onPress={() => router.push({ pathname: '/agreements/[id]', params: { id: gigAgreement.id } })}
              style={{ marginBottom: 10 }}
            />
          </>
        ) : null}
        {error ? (
          <Button
            title={strings.common.retry}
            onPress={loadGigAndLoop}
            variant="secondary"
            style={{ marginBottom: 10 }}
          />
        ) : null}
        <Button
          title={strings.common.back}
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

  const isOwner = user?.id === gig.client_id;
  const isFreelancerMode = profile?.active_mode === 'find_work';
  const viewerRole: 'client' | 'freelancer' = isOwner
    ? 'client'
    : isFreelancerMode
    ? 'freelancer'
    : 'client';

  const handleApplyPress = () => {
    if (gigAgreement) {
      router.push({ pathname: '/agreements/[id]', params: { id: gigAgreement.id } });
      return;
    }
    if (isOwner) {
      if (gig.status !== 'open') return;
      router.push({ pathname: '/gigs/[id]/applicants', params: { id: gig.id } });
      return;
    }
    if (gig.status !== 'open') return;
    if (!isFreelancerMode) {
      showToast(
        'You are currently in Hire Someone mode. To apply for gigs, you must switch to Find Work mode.',
        'info'
      );
      return;
    }
    router.push({ pathname: '/gigs/[id]/apply', params: { id: gig.id } });
  };

  const handleOpenChat = async () => {
    try {
      if (gigAgreement) {
        const convId = await chatService.getOrCreateConversation({
          agreementId: gigAgreement.id,
        });
        router.push({
          pathname: '/chat/[conversationId]',
          params: {
            conversationId: convId,
            partnerName: isOwner
              ? gigAgreement.freelancer?.display_name || 'Freelancer'
              : gig.client.display_name || 'Client',
          },
        });
      } else if (myApplication) {
        const convId = await chatService.getOrCreateConversation({
          applicationId: myApplication.id,
        });
        router.push({
          pathname: '/chat/[conversationId]',
          params: {
            conversationId: convId,
            partnerName: gig.client.display_name || 'Client',
          },
        });
      }
    } catch (err: any) {
      showToast(err?.message || 'Could not open conversation.', 'error');
    }
  };

  const handleCancelGig = async () => {
    const confirmed = await confirmDialog({
      title: 'Cancel Gig',
      message: 'Are you sure you want to cancel this gig? Pending applicants will be notified.',
      confirmText: 'Cancel Gig',
      cancelText: 'Keep Gig',
      destructive: true,
    });

    if (!confirmed) return;

    setCancelling(true);
    try {
      await gigsService.cancelGig(gig.id, 'Cancelled by client from gig details');
      await loadGigAndLoop();
      showToast(strings.toasts.gigCancelled);
    } catch (err: any) {
      showToast(err?.message || 'Failed to cancel gig.', 'error');
    } finally {
      setCancelling(false);
    }
  };

  const handleDeleteGig = async () => {
    try {
      const apps = await applicationsService.getGigApplicants(gig.id);
      const pending = apps.filter((app) => app.status === 'applied' || app.status === 'countered').length;
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
      setDeleting(true);
      const notified = await gigsService.deleteGig(gig.id, 'Deleted by client');
      showToast(notified === 1 ? strings.toasts.gigDeletedOneApplicant : notified > 1 ? strings.toasts.gigDeletedApplicants.replace('{count}', String(notified)) : strings.toasts.gigDeleted);
      router.replace('/(tabs)/gigs');
    } catch (err: any) {
      showToast(mapSqlErrorToFriendlyMessage(err, 'Could not delete this gig.'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handlePublishDraft = async () => {
    const confirmed = await confirmDialog({
      title: strings.gigs.publishDraftTitle,
      message: strings.gigs.publishDraftMessage,
      confirmText: strings.gigs.publishDraftConfirm,
      cancelText: strings.common.cancel,
    });
    if (!confirmed) return;

    setPublishing(true);
    try {
      await gigsService.publishGig(gig.id);
      await loadGigAndLoop();
      showToast(strings.toasts.gigPublished, 'success');
    } catch (err: any) {
      showToast(err?.message || strings.gigs.publishDraftFailed, 'error');
    } finally {
      setPublishing(false);
    }
  };

  const bannerActionLabel = gigAgreement
    ? 'Open Agreement ›'
    : isOwner && gig.status === 'open'
    ? 'View Applicants ›'
    : isFreelancerMode && gig.status === 'open' && !myApplication
    ? strings.gigs.applyBtn
    : undefined;

  const bannerActionPress =
    gigAgreement || (isOwner && gig.status === 'open') || (isFreelancerMode && gig.status === 'open' && !myApplication)
      ? handleApplyPress
      : undefined;

  return (
    <ScreenBackground>
      <View style={styles.container}>
        <PageHeaderBox
          title={gig.title}
          subtitle={gig.category_name || 'Gig Details'}
          onBack={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(tabs)/gigs');
            }
          }}
          rightAction={<Badge status={gig.status} />}
        />

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* NextStepBanner at top */}
          {loopState && !isDesktop && (
            <View style={{ marginBottom: 14 }}>
              <NextStepBanner
                loopState={loopState}
                actionLabel={bannerActionLabel}
                onActionPress={bannerActionPress}
                onOpenChatPress={gigAgreement || myApplication ? handleOpenChat : undefined}
              />
            </View>
          )}

          {gig.status === 'completed' || gig.status === 'cancelled' || gig.status === 'expired' ? (
            <AlertBox
              tone={gig.status === 'completed' ? 'success' : 'neutral'}
              title={
                gig.status === 'completed'
                  ? strings.gigs.completedReadOnlyTitle
                  : strings.gigs.closedReadOnlyTitle
              }
              message={
                gig.status === 'completed'
                  ? strings.gigs.completedReadOnlyDesc
                  : strings.gigs.closedReadOnlyDesc
              }
              style={{ marginBottom: 14 }}
            />
          ) : null}

          <View style={isDesktop ? styles.desktopTwoCol : undefined}>
            {/* Left Column: Main Gig Info, Description, Requirements, and Poster Profile */}
            <View style={isDesktop ? styles.desktopLeftCol : undefined}>
              <GigDetailInfo
                gig={gig}
                theme={theme}
                onClientPress={() => {
                  if (gig.client_id) {
                    router.push({ pathname: '/profile/[id]', params: { id: gig.client_id } });
                  }
                }}
              />
            </View>

            {/* Right Column on Desktop (or collapsible below GigDetailInfo on Mobile): Next Step & Relationship Timeline */}
            {loopState && (
              <View style={isDesktop ? styles.desktopRightCol : styles.loopSection}>
                {isDesktop && (
                  <NextStepBanner
                    loopState={loopState}
                    actionLabel={bannerActionLabel}
                    onActionPress={bannerActionPress}
                    onOpenChatPress={gigAgreement || myApplication ? handleOpenChat : undefined}
                  />
                )}
                <Timeline
                  currentStage={loopState.currentStage}
                  viewerRole={viewerRole}
                  loopState={loopState}
                  collapsible={!isWide}
                  defaultCollapsed={!isWide}
                />
              </View>
            )}
          </View>
        </ScrollView>

        {/* Sticky Bottom Action Bar */}
        <StickyFooterBox maxWidth={1120}>
          {gigAgreement ? (
            <View style={{ width: '100%', gap: 8 }}>
              <Button
                title={gig.status === 'completed' ? 'View Completed Agreement' : 'View Agreement'}
                onPress={() => router.push({ pathname: '/agreements/[id]', params: { id: gigAgreement.id } })}
                variant="primary"
              />
              {isOwner && gig.status !== 'completed' ? (
                <Button
                  title={deleting ? strings.gigs.deletingGig : strings.gigs.deleteGigBtn}
                  onPress={handleDeleteGig}
                  variant="danger-soft"
                  disabled={deleting || gigAgreement.status !== 'cancelled'}
                  loading={deleting}
                />
              ) : null}
              {isOwner && gig.status !== 'completed' && gigAgreement.status !== 'cancelled' ? (
                <Text style={[styles.reasonText, { color: theme.colors.muted }]}>
                  {strings.gigs.alreadyHiredDeleteBlock}
                </Text>
              ) : null}
            </View>
          ) : isOwner && (gig.status === 'open' || gig.status === 'draft') ? (
            <View style={styles.ownerActionBar}>
              <View style={{ flex: 1 }}>
                {gig.status === 'draft' ? (
                  <Button
                    title={strings.gigs.publishBtn}
                    onPress={handlePublishDraft}
                    variant="primary"
                    loading={publishing}
                    disabled={publishing || cancelling || deleting}
                  />
                ) : (
                  <Button title="View Applicants" icon="people-outline" onPress={handleApplyPress} variant="primary" />
                )}
              </View>
              <Button
                title="Options"
                icon="ellipsis-horizontal"
                variant="secondary"
                fullWidth={false}
                onPress={() => setManageSheetVisible(true)}
              />
            </View>
          ) : isOwner && gig.status !== 'completed' ? (
            <View style={{ width: '100%', gap: 8 }}>
              <Text style={[styles.reasonText, { color: theme.colors.muted }]}>{strings.gigs.closedReadOnlyDesc}</Text>
              <Button
                title={deleting ? strings.gigs.deletingGig : strings.gigs.deleteGigBtn}
                onPress={handleDeleteGig}
                variant="danger-soft"
                loading={deleting}
                disabled={deleting}
              />
            </View>
          ) : isOwner ? (
            <Text style={[styles.reasonText, { color: theme.colors.muted }]}>
              {gig.status === 'completed'
                ? strings.gigs.completedReadOnlyDesc
                : strings.gigs.closedReadOnlyDesc}
            </Text>
          ) : isFreelancerMode ? (
            <View style={{ width: '100%' }}>
              {myApplication ? (
                <>
                  <Text style={[styles.reasonText, { color: theme.colors.muted }]}>
                    You have already submitted a proposal ({myApplication.status}).
                  </Text>
                  <Button
                    title="View My Proposal in Activity"
                    onPress={() => router.push('/(tabs)/activity')}
                    variant="secondary"
                  />
                </>
              ) : (
                <>
                  {gig.status !== 'open' && (
                    <Text style={[styles.reasonText, { color: theme.colors.muted }]}>
                      {gig.status === 'in_progress'
                        ? 'This gig is already in progress.'
                        : gig.status === 'completed'
                        ? 'This gig has been completed.'
                        : 'This gig is not open for applications.'}
                    </Text>
                  )}
                  {gig.status === 'open' ? (
                    gig.application_deadline && new Date(gig.application_deadline).getTime() <= Date.now() ? (
                      <Text style={[styles.reasonText, { color: theme.colors.muted }]}>
                        The application deadline for this gig has passed.
                      </Text>
                    ) : (
                      <Button
                        title={strings.gigs.applyBtn}
                        onPress={handleApplyPress}
                        variant="primary"
                        rightIcon="arrow-forward"
                      />
                    )
                  ) : null}
                </>
              )}
            </View>
          ) : (
            <View style={{ width: '100%' }}>
              {gig.status === 'open' ? (
                <>
                  <Text style={[styles.reasonText, { color: theme.colors.muted }]}>
                    Switch to Find Work mode in your Profile settings to apply.
                  </Text>
                  <Button
                    title="Apply for this Gig"
                    onPress={handleApplyPress}
                    variant="secondary"
                    disabled={true}
                  />
                </>
              ) : (
                <Text style={[styles.reasonText, { color: theme.colors.muted }]}>
                  {gig.status === 'completed'
                    ? strings.gigs.completedReadOnlyDesc
                    : strings.gigs.closedReadOnlyDesc}
                </Text>
              )}
            </View>
          )}
        </StickyFooterBox>

        {/* Modularized Manage Gig Bottom Sheet Modal */}
        <ManageGigModal
          visible={manageSheetVisible}
          onClose={() => setManageSheetVisible(false)}
          gig={gig}
          theme={theme}
          editTitle={strings.gigs.editGig}
          cancelTitle={strings.gigs.cancelGigBtn}
          deleteTitle={strings.gigs.deleteGigBtn}
          onEdit={() => {
            setManageSheetVisible(false);
            router.push({ pathname: '/gigs/post', params: { editGigId: gig?.id } });
          }}
          onCancel={async () => {
            setManageSheetVisible(false);
            await handleCancelGig();
          }}
          onDelete={async () => {
            setManageSheetVisible(false);
            await handleDeleteGig();
          }}
          publishing={publishing}
          cancelling={cancelling}
          deleting={deleting}
        />
      </View>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  errorDesc: {
    fontSize: 14,
    marginBottom: 20,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 140,
    maxWidth: 1120,
    width: '100%',
    alignSelf: 'center',
  },
  desktopTwoCol: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 24,
  },
  desktopLeftCol: {
    flex: 1.55,
  },
  desktopRightCol: {
    flex: 1,
    gap: 12,
  },
  loopSection: {
    gap: 12,
    marginBottom: 14,
  },
  ownerActionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
  },
  reasonText: {
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 8,
  },
});
