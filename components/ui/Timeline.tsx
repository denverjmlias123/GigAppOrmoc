import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../app/theme';
import { strings } from '../../constants/strings';
import { formatPrice } from './GigCard';
import { Button } from './Button';

type LoopStageKey =
  | 'posted'
  | 'applied'
  | 'accepted'
  | 'milestones_set'
  | 'work_submitted'
  | 'approved'
  | 'payment_reported'
  | 'payment_confirmed'
  | 'done'
  | 'reviewed';

const LOOP_STAGE_ORDER: LoopStageKey[] = [
  'posted',
  'applied',
  'accepted',
  'milestones_set',
  'work_submitted',
  'approved',
  'payment_reported',
  'payment_confirmed',
  'done',
  'reviewed',
];

type NextActorRole = 'client' | 'freelancer' | 'both' | 'none';

export interface LoopStageState {
  currentStage: LoopStageKey;
  stageIndex: number;
  actor: NextActorRole;
  isViewerTurn: boolean;
  clientStatusLabel: string;
  freelancerStatusLabel: string;
  viewerStatusLabel: string;
  nextStepTitle: string;
  nextStepDescription: string;
}

interface ComputeAgreementLoopParams {
  viewerRole: 'client' | 'freelancer';
  agreementStatus: 'active' | 'completed' | 'cancelled' | 'disputed';
  agreedPriceCentavos: number;
  clientName?: string;
  freelancerName?: string;
  milestones: Array<{
    id?: string;
    seq?: number;
    title?: string;
    status: 'pending' | 'submitted' | 'approved' | 'revision_requested';
    revision_count?: number;
  }>;
  payments: Array<{
    id?: string;
    amount: number;
    status: 'reported_sent' | 'confirmed_received' | 'disputed';
  }>;
  reviews: Array<{
    reviewer_id: string;
  }>;
  viewerUserId?: string;
}

/**
 * Deterministically computes the shared relationship loop stage and "Next step" banner
 * strictly from database state (agreement, milestones, payments, reviews).
 * Both roles receive the exact same `currentStage` and `actor` for the same DB state.
 */
export function computeAgreementLoopState(
  params: ComputeAgreementLoopParams
): LoopStageState {
  const {
    viewerRole,
    agreementStatus,
    agreedPriceCentavos,
    clientName = ' the client',
    freelancerName = 'the freelancer',
    milestones,
    payments,
    reviews,
    viewerUserId,
  } = params;

  const isClient = viewerRole === 'client';
  const cleanClientName = clientName.trim() || 'Client';
  const cleanFreelancerName = freelancerName.trim() || 'Freelancer';

  // Cancelled or Disputed terminal/special states
  if (agreementStatus === 'cancelled') {
    const idx = LOOP_STAGE_ORDER.indexOf('accepted');
    return {
      currentStage: 'accepted',
      stageIndex: idx,
      actor: 'none',
      isViewerTurn: false,
      clientStatusLabel: 'Agreement cancelled',
      freelancerStatusLabel: 'Agreement cancelled',
      viewerStatusLabel: 'Agreement cancelled',
      nextStepTitle: 'Next step: Agreement cancelled',
      nextStepDescription: 'This agreement was cancelled before completion. No further actions are required.',
    };
  }

  if (agreementStatus === 'disputed') {
    const idx = LOOP_STAGE_ORDER.indexOf('work_submitted');
    return {
      currentStage: 'work_submitted',
      stageIndex: idx,
      actor: 'none',
      isViewerTurn: false,
      clientStatusLabel: 'Disputed — under admin review',
      freelancerStatusLabel: 'Disputed — under admin review',
      viewerStatusLabel: 'Disputed — under admin review',
      nextStepTitle: 'Next step: Moderator review in progress',
      nextStepDescription: 'A dispute has been flagged on this agreement. You can still communicate via chat.',
    };
  }

  // Completed agreement: check reviews
  if (agreementStatus === 'completed') {
    const hasViewerReviewed = Boolean(
      viewerUserId && reviews.some((r) => r.reviewer_id === viewerUserId)
    );
    const allReviewed = reviews.length >= 2;

    if (allReviewed) {
      const idx = LOOP_STAGE_ORDER.indexOf('reviewed');
      return {
        currentStage: 'reviewed',
        stageIndex: idx,
        actor: 'none',
        isViewerTurn: false,
        clientStatusLabel: `Reviewed ${cleanFreelancerName}`,
        freelancerStatusLabel: `Reviewed ${cleanClientName}`,
        viewerStatusLabel: isClient
          ? `Reviewed ${cleanFreelancerName}`
          : `Reviewed ${cleanClientName}`,
        nextStepTitle: 'Next step: All done — both reviews submitted',
        nextStepDescription: 'Both sides have completed the agreement and shared their feedback.',
      };
    }

    const idx = LOOP_STAGE_ORDER.indexOf('done');
    const actor: NextActorRole = hasViewerReviewed
      ? isClient
        ? 'freelancer'
        : 'client'
      : 'both';
    const isViewerTurn = !hasViewerReviewed;

    return {
      currentStage: 'done',
      stageIndex: idx,
      actor,
      isViewerTurn,
      clientStatusLabel: `Completed: Review ${cleanFreelancerName}`,
      freelancerStatusLabel: `Completed: Review ${cleanClientName}`,
      viewerStatusLabel: isClient
        ? `Completed: Review ${cleanFreelancerName}`
        : `Completed: Review ${cleanClientName}`,
      nextStepTitle: isViewerTurn
        ? `Next step: You — Leave a review for ${isClient ? cleanFreelancerName : cleanClientName}`
        : `Next step: Waiting for ${isClient ? cleanFreelancerName : cleanClientName} to leave a review`,
      nextStepDescription: isViewerTurn
        ? 'The agreement is completed. Share your honest feedback within 14 days.'
        : 'You have submitted your review. Waiting on the other side to submit theirs.',
    };
  }

  // Active agreement stages
  // 1. No milestones defined yet -> 'accepted' stage (Client must define milestones)
  if (!milestones || milestones.length === 0) {
    const idx = LOOP_STAGE_ORDER.indexOf('accepted');
    const isViewerTurn = isClient;
    return {
      currentStage: 'accepted',
      stageIndex: idx,
      actor: 'client',
      isViewerTurn,
      clientStatusLabel: `Hired ${cleanFreelancerName}`,
      freelancerStatusLabel: 'You got the job',
      viewerStatusLabel: isClient ? `Hired ${cleanFreelancerName}` : 'You got the job',
      nextStepTitle: isClient
        ? `Next step: You — Define milestones totaling ${formatPrice(agreedPriceCentavos)}`
        : `Next step: ${cleanClientName} — Define project milestones`,
      nextStepDescription: isClient
        ? `Hired ${cleanFreelancerName}. Set 1 to 5 milestones so work can begin.`
        : `You got the job! Waiting for ${cleanClientName} to set the milestones.`,
    };
  }

  const submittedMilestones = milestones.filter((m) => m.status === 'submitted');
  const revisionMilestones = milestones.filter((m) => m.status === 'revision_requested');
  const approvedMilestones = milestones.filter((m) => m.status === 'approved');
  const allMilestonesApproved =
    milestones.length > 0 && approvedMilestones.length === milestones.length;

  const reportedPayments = payments.filter((p) => p.status === 'reported_sent');
  const confirmedPaymentsCentavos = payments
    .filter((p) => p.status === 'confirmed_received')
    .reduce((sum, p) => sum + p.amount, 0);
  const isFullyPaid =
    agreedPriceCentavos > 0 && confirmedPaymentsCentavos >= agreedPriceCentavos;

  // 2. Payment reported (pending freelancer confirmation)
  if (reportedPayments.length > 0) {
    const idx = LOOP_STAGE_ORDER.indexOf('payment_reported');
    const isViewerTurn = !isClient;
    return {
      currentStage: 'payment_reported',
      stageIndex: idx,
      actor: 'freelancer',
      isViewerTurn,
      clientStatusLabel: 'Payment reported',
      freelancerStatusLabel: 'Payment reported: Confirm received',
      viewerStatusLabel: isClient
        ? 'Payment reported'
        : 'Payment reported: Confirm received',
      nextStepTitle: isClient
        ? `Next step: ${cleanFreelancerName} — Confirm payment received`
        : `Next step: You — Confirm receipt of payment from ${cleanClientName}`,
      nextStepDescription: isClient
        ? `Payment reported. Waiting for ${cleanFreelancerName} to verify and confirm receipt.`
        : `${cleanClientName} reported sending ${formatPrice(reportedPayments[0]?.amount || 0)}. Check your account and tap Confirm Received.`,
    };
  }

  // 3. Payment confirmed & all milestones approved -> ready to Complete Agreement ('payment_confirmed')
  if (allMilestonesApproved && isFullyPaid) {
    const idx = LOOP_STAGE_ORDER.indexOf('payment_confirmed');
    return {
      currentStage: 'payment_confirmed',
      stageIndex: idx,
      actor: 'both',
      isViewerTurn: true,
      clientStatusLabel: 'Payment confirmed by freelancer',
      freelancerStatusLabel: 'Payment confirmed — ready to complete',
      viewerStatusLabel: isClient
        ? 'Payment confirmed by freelancer'
        : 'Payment confirmed — ready to complete',
      nextStepTitle: 'Next step: You — Tap "Complete Agreement" to finish',
      nextStepDescription:
        'All milestones are approved and full payment is confirmed. Either side can now mark the agreement complete.',
    };
  }

  // 4. All milestones approved, waiting for client to report payment ('approved')
  if (allMilestonesApproved && !isFullyPaid) {
    const idx = LOOP_STAGE_ORDER.indexOf('approved');
    const isViewerTurn = isClient;
    return {
      currentStage: 'approved',
      stageIndex: idx,
      actor: 'client',
      isViewerTurn,
      clientStatusLabel: 'Approved',
      freelancerStatusLabel: 'Approved',
      viewerStatusLabel: 'Approved',
      nextStepTitle: isClient
        ? `Next step: You — Send and report payment to ${cleanFreelancerName}`
        : `Next step: ${cleanClientName} — Report payment`,
      nextStepDescription: isClient
        ? 'All milestones are approved! Send payment outside Gigormoc and tap "Report Payment".'
        : `All milestones are approved! Waiting for ${cleanClientName} to send and report payment.`,
    };
  }

  // 5. Work submitted on at least one milestone -> Client must review ('work_submitted')
  if (submittedMilestones.length > 0) {
    const idx = LOOP_STAGE_ORDER.indexOf('work_submitted');
    const isViewerTurn = isClient;
    return {
      currentStage: 'work_submitted',
      stageIndex: idx,
      actor: 'client',
      isViewerTurn,
      clientStatusLabel: `${cleanFreelancerName} submitted work: Review`,
      freelancerStatusLabel: 'Submitted, waiting for review',
      viewerStatusLabel: isClient
        ? `${cleanFreelancerName} submitted work: Review`
        : 'Submitted, waiting for review',
      nextStepTitle: isClient
        ? `Next step: You — Review ${cleanFreelancerName}'s submitted work`
        : `Next step: ${cleanClientName} — Review your submitted work`,
      nextStepDescription: isClient
        ? `${cleanFreelancerName} submitted work: Review and approve or request a revision.`
        : `Submitted, waiting for review by ${cleanClientName}.`,
    };
  }

  // 6. Revision requested on a milestone -> Freelancer must resubmit ('work_submitted' revision stage)
  if (revisionMilestones.length > 0) {
    const revMilestone = revisionMilestones[0];
    const revNum = revMilestone.revision_count || 1;
    const idx = LOOP_STAGE_ORDER.indexOf('work_submitted');
    const isViewerTurn = !isClient;
    const revLabel = `Revision requested (${revNum} of 2)`;
    return {
      currentStage: 'work_submitted',
      stageIndex: idx,
      actor: 'freelancer',
      isViewerTurn,
      clientStatusLabel: revLabel,
      freelancerStatusLabel: `${revLabel} — Resubmit`,
      viewerStatusLabel: isClient ? revLabel : `${revLabel} — Resubmit`,
      nextStepTitle: isClient
        ? `Next step: ${cleanFreelancerName} — Resubmit revised work`
        : `Next step: You — Resubmit work for ${revLabel}`,
      nextStepDescription: isClient
        ? `${revLabel}. Waiting for ${cleanFreelancerName} to resubmit deliverables.`
        : `${cleanClientName} requested a revision (${revNum} of 2). Review feedback and tap "Resubmit".`,
    };
  }

  // 7. Default with milestones defined and pending work -> 'milestones_set' (Freelancer must submit work)
  const idx = LOOP_STAGE_ORDER.indexOf('milestones_set');
  const isViewerTurn = !isClient;
  return {
    currentStage: 'milestones_set',
    stageIndex: idx,
    actor: 'freelancer',
    isViewerTurn,
    clientStatusLabel: 'Milestones set, waiting for work',
    freelancerStatusLabel: 'Your milestones',
    viewerStatusLabel: isClient ? 'Milestones set, waiting for work' : 'Your milestones',
    nextStepTitle: isClient
      ? `Next step: ${cleanFreelancerName} — Submit milestone work`
      : 'Next step: You — Submit work for your active milestone',
    nextStepDescription: isClient
      ? 'Milestones set, waiting for work from the freelancer.'
      : 'Your milestones are set with amounts and due dates. Submit work when ready.',
  };
}

/**
 * Computes the loop stage and "Next step" banner for a pre-agreement application or open gig.
 */
export function computePreAgreementLoopState(params: {
  viewerRole: 'client' | 'freelancer';
  gigStatus: string;
  applicationStatus?: 'applied' | 'accepted' | 'declined' | 'countered' | 'withdrawn' | null;
  applicantCount?: number;
  clientName?: string;
  freelancerName?: string;
  counterPriceCentavos?: number | null;
}): LoopStageState {
  const {
    viewerRole,
    gigStatus,
    applicationStatus,
    applicantCount = 0,
    clientName = 'the client',
    freelancerName = 'the freelancer',
    counterPriceCentavos,
  } = params;

  const isClient = viewerRole === 'client';
  const cleanClientName = clientName.trim() || 'Client';
  const cleanFreelancerName = freelancerName.trim() || 'Freelancer';

  if (applicationStatus === 'accepted' || gigStatus === 'in_progress') {
    const idx = LOOP_STAGE_ORDER.indexOf('accepted');
    return {
      currentStage: 'accepted',
      stageIndex: idx,
      actor: 'client',
      isViewerTurn: isClient,
      clientStatusLabel: `Hired ${cleanFreelancerName}`,
      freelancerStatusLabel: 'You got the job',
      viewerStatusLabel: isClient ? `Hired ${cleanFreelancerName}` : 'You got the job',
      nextStepTitle: isClient
        ? 'Next step: You — Open the agreement and set milestones'
        : `Next step: ${cleanClientName} — Set milestones on the agreement`,
      nextStepDescription: isClient
        ? `Hired ${cleanFreelancerName}. Open Hired agreements to manage milestones.`
        : 'You got the job! Open your Jobs tab to view the agreement.',
    };
  }

  if (applicationStatus === 'countered') {
    const idx = LOOP_STAGE_ORDER.indexOf('applied');
    const isViewerTurn = !isClient;
    const priceText = counterPriceCentavos ? ` (${formatPrice(counterPriceCentavos)})` : '';
    return {
      currentStage: 'applied',
      stageIndex: idx,
      actor: 'freelancer',
      isViewerTurn,
      clientStatusLabel: `Counteroffer sent${priceText}`,
      freelancerStatusLabel: `Client sent counteroffer${priceText}`,
      viewerStatusLabel: isClient
        ? `Counteroffer sent${priceText}`
        : `Client sent counteroffer${priceText}`,
      nextStepTitle: isClient
        ? `Next step: ${cleanFreelancerName} — Respond to your counteroffer`
        : `Next step: You — Accept or decline ${cleanClientName}'s counteroffer${priceText}`,
      nextStepDescription: isClient
        ? `Waiting for ${cleanFreelancerName} to accept or decline your counteroffer.`
        : `${cleanClientName} sent a counteroffer${priceText}. Accept to start the agreement or decline.`,
    };
  }

  if (applicationStatus === 'applied' || applicantCount > 0) {
    const idx = LOOP_STAGE_ORDER.indexOf('applied');
    const isViewerTurn = isClient;
    return {
      currentStage: 'applied',
      stageIndex: idx,
      actor: 'client',
      isViewerTurn,
      clientStatusLabel: 'New applicant',
      freelancerStatusLabel: 'Proposal sent',
      viewerStatusLabel: isClient ? 'New applicant' : 'Proposal sent',
      nextStepTitle: isClient
        ? 'Next step: You — Review applicant proposals (Accept, Counter, or Decline)'
        : `Next step: ${cleanClientName} — Review your proposal`,
      nextStepDescription: isClient
        ? 'New applicant under Applicants. Review their proposal and respond.'
        : 'Proposal sent under Proposals. Waiting for the client to respond.',
    };
  }

  // Default: 'posted' stage
  const idx = LOOP_STAGE_ORDER.indexOf('posted');
  const isViewerTurn = !isClient && gigStatus === 'open';
  return {
    currentStage: 'posted',
    stageIndex: idx,
    actor: gigStatus === 'open' ? 'freelancer' : 'none',
    isViewerTurn,
    clientStatusLabel: gigStatus === 'draft' ? 'Draft gig — publish when ready' : 'Your gig is live',
    freelancerStatusLabel: 'Open gig in Browse',
    viewerStatusLabel: isClient
      ? gigStatus === 'draft'
        ? 'Draft gig — publish when ready'
        : 'Your gig is live'
      : 'Open gig in Browse',
    nextStepTitle: isClient
      ? gigStatus === 'draft'
        ? 'Next step: You — Publish your gig so freelancers can apply'
        : 'Next step: Waiting for freelancers in Ormoc to send proposals'
      : gigStatus === 'open'
      ? 'Next step: You — Send a proposal to apply for this gig'
      : 'Next step: This gig is no longer open for new proposals',
    nextStepDescription: isClient
      ? 'Your gig is live in My gigs. You will be notified as soon as a freelancer applies.'
      : 'Review the gig requirements and budget below, then tap Apply to send a proposal.',
  };
}

interface NextStepBannerProps {
  loopState: LoopStageState;
  onActionPress?: () => void;
  actionLabel?: string;
  onOpenChatPress?: () => void;
  compact?: boolean;
}

export const NextStepBanner: React.FC<NextStepBannerProps> = ({
  loopState,
  onActionPress,
  actionLabel,
  onOpenChatPress,
  compact = false,
}) => {
  const theme = useAppTheme();
  const isTurn = loopState.isViewerTurn;

  return (
    <View
      style={[
        styles.bannerContainer,
        compact && styles.bannerCompact,
        {
          backgroundColor: isTurn ? theme.colors.surfaceAlt : theme.colors.surface,
          borderColor: isTurn ? theme.colors.primary : theme.colors.border,
        },
      ]}
      accessibilityRole="summary"
    >
      <View style={styles.bannerTopRow}>
        <View
          style={[
            styles.turnPill,
            {
              backgroundColor: isTurn ? theme.colors.primary : theme.colors.border,
            },
          ]}
        >
          <Ionicons
            name={isTurn ? 'flash' : 'time-outline'}
            size={12}
            color={isTurn ? theme.colors.heroText : theme.colors.text}
          />
          <Text
            style={[
              styles.turnPillText,
              { color: isTurn ? theme.colors.heroText : theme.colors.text },
            ]}
          >
            {isTurn ? strings.loop.yourTurnBadge : strings.loop.waitingBadge}
          </Text>
        </View>

        <Text style={[styles.stageStatusTag, { color: theme.colors.primary }]}>
          {loopState.viewerStatusLabel}
        </Text>
      </View>

      <Text
        style={[
          compact ? styles.bannerTitleCompact : styles.bannerTitle,
          { color: theme.colors.text },
        ]}
      >
        {loopState.nextStepTitle}
      </Text>

      {!compact && (
        <Text style={[styles.bannerDesc, { color: theme.colors.muted }]}>
          {loopState.nextStepDescription}
        </Text>
      )}

      {(onActionPress || onOpenChatPress) && (
        <View style={styles.bannerActionsRow}>
          {onActionPress && actionLabel && (
            <Button
              title={actionLabel}
              onPress={onActionPress}
              variant="primary"
              size="sm"
              rightIcon="arrow-forward"
            />
          )}

          {onOpenChatPress && (
            <Button
              title={strings.loop.openChatBtn}
              onPress={onOpenChatPress}
              variant="secondary"
              size="sm"
              icon="chatbubble-ellipses-outline"
            />
          )}
        </View>
      )}
    </View>
  );
};

interface TimelineProps {
  currentStage: LoopStageKey;
  viewerRole: 'client' | 'freelancer';
  loopState?: LoopStageState;
  compact?: boolean;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export const Timeline: React.FC<TimelineProps> = ({
  currentStage,
  viewerRole,
  loopState,
  compact = false,
  collapsible = false,
  defaultCollapsed = false,
}) => {
  const theme = useAppTheme();
  const activeIdx = LOOP_STAGE_ORDER.indexOf(currentStage);
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);

  const getStageRoleHint = (stage: LoopStageKey): string => {
    const isClient = viewerRole === 'client';
    switch (stage) {
      case 'posted':
        return isClient ? 'Your gig is live' : 'Gig in Browse';
      case 'applied':
        return isClient ? 'New applicant' : 'Proposal sent';
      case 'accepted':
        return isClient ? 'Hired freelancer' : 'You got the job';
      case 'milestones_set':
        return isClient ? 'Milestones set, waiting for work' : 'Your milestones';
      case 'work_submitted':
        return isClient ? 'Freelancer submitted work: Review' : 'Submitted, waiting for review';
      case 'approved':
        return 'Approved / Revision check';
      case 'payment_reported':
        return isClient ? 'Payment reported' : 'Payment reported: Confirm received';
      case 'payment_confirmed':
        return 'Confirmed by freelancer';
      case 'done':
        return 'Completed: Leave review';
      case 'reviewed':
        return 'Both sides reviewed';
    }
  };

  if (compact) {
    return (
      <View style={styles.compactTimelineWrap}>
        <View style={styles.compactDotsRow}>
          {LOOP_STAGE_ORDER.map((stage, index) => {
            const isDone = index < activeIdx;
            const isCurrent = index === activeIdx;
            return (
              <React.Fragment key={stage}>
                <View
                  style={[
                    styles.compactDot,
                    {
                      backgroundColor: isDone
                        ? theme.colors.success
                        : isCurrent
                        ? theme.colors.primary
                        : theme.colors.border,
                      transform: [{ scale: isCurrent ? 1.25 : 1 }],
                    },
                  ]}
                />
                {index < LOOP_STAGE_ORDER.length - 1 && (
                  <View
                    style={[
                      styles.compactLine,
                      {
                        backgroundColor: isDone ? theme.colors.success : theme.colors.border,
                      },
                    ]}
                  />
                )}
              </React.Fragment>
            );
          })}
        </View>
        <View style={styles.compactLabelRow}>
          <Text style={[styles.compactCurrentStage, { color: theme.colors.primary }]}>
            ● {strings.loop.youAreHereBadge}: {strings.loop.stages[currentStage]} (
            {activeIdx + 1}/{LOOP_STAGE_ORDER.length})
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.timelineCard,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
      ]}
    >
      <TouchableOpacity
        disabled={!collapsible}
        activeOpacity={0.75}
        onPress={() => setCollapsed((prev) => !prev)}
        style={[styles.timelineHeaderRow, collapsed && { marginBottom: 6 }]}
      >
        <Text style={[styles.timelineTitle, { color: theme.colors.text }]}>
          {strings.loop.timelineTitle}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[styles.timelineStepCounter, { color: theme.colors.muted }]}>
            Stage {activeIdx + 1} of {LOOP_STAGE_ORDER.length}
          </Text>
          {collapsible ? (
            <Ionicons
              name={collapsed ? 'chevron-down' : 'chevron-up'}
              size={16}
              color={theme.colors.primary}
            />
          ) : null}
        </View>
      </TouchableOpacity>

      {collapsible && collapsed ? (
        <View style={styles.compactTimelineWrap}>
          <View style={styles.compactDotsRow}>
            {LOOP_STAGE_ORDER.map((stage, index) => {
              const isDone = index < activeIdx;
              const isCurrent = index === activeIdx;
              return (
                <React.Fragment key={stage}>
                  <View
                    style={[
                      styles.compactDot,
                      {
                        backgroundColor: isDone
                          ? theme.colors.success
                          : isCurrent
                          ? theme.colors.primary
                          : theme.colors.border,
                        transform: [{ scale: isCurrent ? 1.25 : 1 }],
                      },
                    ]}
                  />
                  {index < LOOP_STAGE_ORDER.length - 1 && (
                    <View
                      style={[
                        styles.compactLine,
                        {
                          backgroundColor: isDone ? theme.colors.success : theme.colors.border,
                        },
                      ]}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </View>
          <View style={styles.compactLabelRow}>
            <Text style={[styles.compactCurrentStage, { color: theme.colors.primary }]}>
              ● {strings.loop.youAreHereBadge}: {strings.loop.stages[currentStage]} — Tap to view all stages
            </Text>
          </View>
        </View>
      ) : (
      <View style={styles.stagesList}>
        {LOOP_STAGE_ORDER.map((stage, index) => {
          const isCompleted = index < activeIdx;
          const isCurrent = index === activeIdx;
          const isUpcoming = index > activeIdx;

          return (
            <View key={stage} style={styles.stageRow}>
              {/* Left rail indicator */}
              <View style={styles.railCol}>
                <View
                  style={[
                    styles.stageCircle,
                    {
                      backgroundColor: isCompleted
                        ? theme.colors.success
                        : isCurrent
                        ? theme.colors.primary
                        : theme.colors.surfaceAlt,
                      borderColor: isCompleted
                        ? theme.colors.success
                        : isCurrent
                        ? theme.colors.primary
                        : theme.colors.border,
                    },
                  ]}
                >
                  {isCompleted ? (
                    <Ionicons name="checkmark" size={12} color={theme.colors.heroText} />
                  ) : (
                    <Text
                      style={[
                        styles.stageNumberText,
                        {
                          color: isCurrent ? theme.colors.heroText : theme.colors.muted,
                        },
                      ]}
                    >
                      {index + 1}
                    </Text>
                  )}
                </View>
                {index < LOOP_STAGE_ORDER.length - 1 && (
                  <View
                    style={[
                      styles.railLine,
                      {
                        backgroundColor: isCompleted
                          ? theme.colors.success
                          : theme.colors.border,
                      },
                    ]}
                  />
                )}
              </View>

              {/* Right stage label + role description */}
              <View style={[styles.stageContent, isCurrent && styles.stageContentCurrent]}>
                <View style={styles.stageTitleRow}>
                  <Text
                    style={[
                      styles.stageName,
                      {
                        color: isUpcoming ? theme.colors.muted : theme.colors.text,
                        fontWeight: isCurrent ? '800' : isCompleted ? '600' : '500',
                      },
                    ]}
                  >
                    {strings.loop.stages[stage]}
                  </Text>

                  {isCurrent && (
                    <View
                      style={[
                        styles.youAreHerePill,
                        { backgroundColor: theme.colors.primary },
                      ]}
                    >
                      <Text style={[styles.youAreHereText, { color: theme.colors.heroText }]}>
                        {strings.loop.youAreHereBadge}
                      </Text>
                    </View>
                  )}
                </View>

                {(isCurrent || isCompleted) && (
                  <Text
                    style={[
                      styles.stageRoleSubtitle,
                      {
                        color: isCurrent ? theme.colors.primary : theme.colors.muted,
                        fontWeight: isCurrent ? '600' : '400',
                      },
                    ]}
                  >
                    {isCurrent && loopState
                      ? loopState.viewerStatusLabel
                      : getStageRoleHint(stage)}
                  </Text>
                )}
              </View>
            </View>
          );
        })}
      </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  bannerContainer: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  bannerCompact: {
    padding: 10,
    borderRadius: 10,
    gap: 4,
  },
  bannerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  turnPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  turnPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  stageStatusTag: {
    fontSize: 12,
    fontWeight: '700',
  },
  bannerTitle: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
    marginTop: 2,
  },
  bannerTitleCompact: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  bannerDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  bannerActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  timelineCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
  },
  timelineHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  timelineTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  timelineStepCounter: {
    fontSize: 12,
    fontWeight: '600',
  },
  stagesList: {
    gap: 0,
  },
  stageRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  railCol: {
    width: 28,
    alignItems: 'center',
  },
  stageCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageNumberText: {
    fontSize: 11,
    fontWeight: '700',
  },
  railLine: {
    width: 2,
    flex: 1,
    minHeight: 14,
    marginVertical: 2,
  },
  stageContent: {
    flex: 1,
    paddingLeft: 10,
    paddingBottom: 12,
  },
  stageContentCurrent: {
    paddingBottom: 14,
  },
  stageTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  stageName: {
    fontSize: 14,
  },
  youAreHerePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  youAreHereText: {
    fontSize: 10,
    fontWeight: '800',
  },
  stageRoleSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  compactTimelineWrap: {
    marginTop: 6,
    gap: 4,
  },
  compactDotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  compactDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  compactLine: {
    flex: 1,
    height: 2,
  },
  compactLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  compactCurrentStage: {
    fontSize: 11,
    fontWeight: '700',
  },
});
