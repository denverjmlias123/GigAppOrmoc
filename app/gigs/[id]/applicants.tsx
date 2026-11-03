import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useAppTheme, useResponsiveLayout } from '../../theme';
import { applicationsService, ApplicationItem } from '../../../services/applications';
import { chatService } from '../../../services/chat';
import { formatPrice } from '../../../components/ui/GigCard';
import { Badge } from '../../../components/ui/Badge';
import { LegitBadge } from '../../../components/ui/LegitBadge';
import { Avatar } from '../../../components/ui/Avatar';
import { Button } from '../../../components/ui/Button';
import { Card, AlertBox, PageHeaderBox } from '../../../components/ui/Card';
import { TextInput } from '../../../components/ui/TextInput';
import { Chip } from '../../../components/ui/Chip';
import { showToast } from '../../../components/ui/Toast';
import { confirmDialog } from '../../../lib/dialog';
import { EmptyState } from '../../../components/ui/EmptyState';
import { NextStepBanner, computePreAgreementLoopState } from '../../../components/ui/Timeline';
import { strings } from '../../../constants/strings';

type StatusFilter = 'all' | 'applied' | 'countered' | 'accepted' | 'declined';

export default function GigApplicantsScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { isDesktop, insets } = useResponsiveLayout();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [applicants, setApplicants] = useState<ApplicationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [counterAppId, setCounterAppId] = useState<string | null>(null);
  const [counterPriceStr, setCounterPriceStr] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [error, setError] = useState<string | null>(null);

  const loadApplicants = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const data = await applicationsService.getGigApplicants(id);
      setApplicants(data);
    } catch (err: any) {
      setError(err?.message || 'Could not load applicants.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void loadApplicants();
      if (!id) return;
      return applicationsService.subscribeToGigApplicants(id, () => {
        void loadApplicants();
      });
    }, [id, loadApplicants])
  );

  const handleOpenApplicantChat = async (app: ApplicationItem) => {
    try {
      const convId = await chatService.getOrCreateConversation({ applicationId: app.id });
      router.push({
        pathname: '/chat/[conversationId]',
        params: {
          conversationId: convId,
          partnerName: app.freelancer?.display_name || 'Freelancer',
        },
      });
    } catch (err: any) {
      showToast(err?.message || 'Could not open conversation.', 'error');
    }
  };

  const handleAccept = async (app: ApplicationItem) => {
    const confirmed = await confirmDialog({
      title: 'Accept Proposal',
      message: `Accept ${app.freelancer?.display_name || 'this freelancer'}'s proposal for ${formatPrice(app.proposed_price)}? This will create an active agreement and close the gig to other applicants.`,
      confirmText: 'Accept Proposal',
      cancelText: 'Cancel',
    });

    if (!confirmed) return;

    setActionBusy(app.id);
    try {
      const agreementId = await applicationsService.respondToApplication(app.id, 'accept');
      showToast(strings.toasts.applicationAccepted);
      if (agreementId) {
        router.replace({ pathname: '/agreements/[id]', params: { id: agreementId } });
      } else {
        router.replace('/(tabs)/activity');
      }
    } catch (err: any) {
      showToast(err?.message || 'Could not accept proposal.', 'error');
    } finally {
      setActionBusy(null);
    }
  };

  const handleDecline = async (appId: string, freelancerName?: string) => {
    const confirmed = await confirmDialog({
      title: 'Decline Proposal',
      message: `Are you sure you want to decline ${freelancerName || 'this freelancer'}'s proposal?`,
      confirmText: 'Decline',
      cancelText: 'Cancel',
      destructive: true,
    });
    if (!confirmed) return;

    setActionBusy(appId);
    try {
      await applicationsService.respondToApplication(appId, 'decline');
      showToast(strings.toasts.applicationDeclined);
      await loadApplicants();
    } catch (err: any) {
      showToast(err?.message || 'Could not decline proposal.', 'error');
    } finally {
      setActionBusy(null);
    }
  };

  const handleSendCounter = async (appId: string) => {
    const priceNum = parseFloat(counterPriceStr);
    if (isNaN(priceNum) || priceNum < 100) {
      showToast('Counteroffer must be at least ₱100.00.', 'error');
      return;
    }

    setActionBusy(appId);
    try {
      const priceCentavos = Math.round(priceNum * 100);
      await applicationsService.respondToApplication(appId, 'counter', priceCentavos);
      setCounterAppId(null);
      setCounterPriceStr('');
      showToast(strings.toasts.counterSent);
      await loadApplicants();
    } catch (err: any) {
      showToast(err?.message || 'Could not submit counteroffer.', 'error');
    } finally {
      setActionBusy(null);
    }
  };

  const pendingApplicantsCount = applicants.filter(
    (a) => a.status === 'applied' || a.status === 'countered'
  ).length;
  const acceptedApplicant = applicants.find((a) => a.status === 'accepted');

  const filteredApplicants = useMemo(() => {
    if (statusFilter === 'all') return applicants;
    return applicants.filter((a) => a.status === statusFilter);
  }, [applicants, statusFilter]);

  const topLoopState = computePreAgreementLoopState({
    viewerRole: 'client',
    gigStatus: acceptedApplicant ? 'in_progress' : 'open',
    applicationStatus: acceptedApplicant ? 'accepted' : pendingApplicantsCount > 0 ? 'applied' : null,
    applicantCount: pendingApplicantsCount,
    freelancerName: acceptedApplicant?.freelancer?.display_name || 'the freelancer',
  });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <PageHeaderBox
        title={`Applicants (${applicants.length})`}
        subtitle="Review proposals, open chat, or send counter-offers"
        onBack={() => {
          if (router.canGoBack()) {
            router.back();
          } else if (id) {
            router.replace({ pathname: '/gigs/[id]', params: { id } });
          } else {
            router.replace('/(tabs)/gigs');
          }
        }}
        maxWidth={960}
      />

      {error && (
        <View style={[styles.centeredBlock, { paddingHorizontal: 16, marginTop: 12 }]}>
          <AlertBox tone="danger" message={error} />
        </View>
      )}

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom + 32, 40) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.centeredBlock}>
          {!loading && (
            <View style={{ marginBottom: 14 }}>
              <NextStepBanner loopState={topLoopState} />
            </View>
          )}

          {!loading && applicants.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
            >
              <Chip
                label="All"
                count={applicants.length}
                selected={statusFilter === 'all'}
                onPress={() => setStatusFilter('all')}
              />
              <Chip
                label="Pending"
                count={applicants.filter((a) => a.status === 'applied').length}
                selected={statusFilter === 'applied'}
                onPress={() => setStatusFilter('applied')}
              />
              <Chip
                label="Countered"
                count={applicants.filter((a) => a.status === 'countered').length}
                selected={statusFilter === 'countered'}
                onPress={() => setStatusFilter('countered')}
              />
              <Chip
                label="Accepted"
                count={applicants.filter((a) => a.status === 'accepted').length}
                selected={statusFilter === 'accepted'}
                onPress={() => setStatusFilter('accepted')}
              />
              <Chip
                label="Declined"
                count={applicants.filter((a) => a.status === 'declined').length}
                selected={statusFilter === 'declined'}
                onPress={() => setStatusFilter('declined')}
              />
            </ScrollView>
          )}

          {loading ? (
            <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginTop: 32 }} />
          ) : applicants.length === 0 ? (
            <EmptyState
              title="No applicants yet"
              description="When freelancers submit proposals for this gig, their details and proposals will appear here."
              actionTitle="Refresh"
              onAction={loadApplicants}
            />
          ) : filteredApplicants.length === 0 ? (
            <EmptyState
              title="No matching proposals"
              description="No proposals match the selected status filter."
              actionTitle="Show All"
              onAction={() => setStatusFilter('all')}
            />
          ) : (
            <View style={isDesktop ? styles.desktopGrid : undefined}>
              {filteredApplicants.map((app) => {
                const isBusy = actionBusy === app.id;
                const isCounteringThis = counterAppId === app.id;
                const freelancerName = app.freelancer?.display_name || 'Freelancer';

                return (
                  <Card
                    key={app.id}
                    tone="raised"
                    padding="md"
                    style={[
                      styles.card,
                      isDesktop && styles.desktopGridItem,
                    ]}
                  >
                    {/* Header with clickable profile avatar & link */}
                    <View style={styles.cardHeader}>
                      <Pressable
                        style={styles.freelancerProfileTouch}
                        onPress={() => {
                          if (app.freelancer_id) {
                            router.push({ pathname: '/profile/[id]', params: { id: app.freelancer_id } });
                          }
                        }}
                      >
                        <Avatar
                          name={freelancerName}
                          uri={(app.freelancer as any)?.avatar_url}
                          size={44}
                        />
                        <View style={styles.freelancerCol}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <Text style={[styles.freelancerName, { color: theme.colors.text }]}>
                              {freelancerName}
                            </Text>
                            {app.freelancer?.is_legit_verified ? (
                              <LegitBadge size="small" role="freelancer" />
                            ) : null}
                          </View>
                          <Text style={[styles.freelancerStats, { color: theme.colors.muted }]}>
                            <Text style={{ color: theme.colors.warning }}>★</Text>{' '}
                            {Number(app.freelancer?.freelancer_rating_avg || 0).toFixed(1)} ({app.freelancer?.freelancer_rating_count || 0}) • {app.freelancer?.freelancer_completed_gigs || 0} completed
                          </Text>
                          <Text style={[styles.viewProfileHint, { color: theme.colors.primary }]}>
                            View Profile →
                          </Text>
                        </View>
                      </Pressable>
                      <Badge status={app.status} />
                    </View>

                    {/* Proposal details */}
                    <View style={[styles.proposalInfo, { backgroundColor: theme.colors.surfaceAlt }]}>
                      <Text style={[styles.priceTag, { color: theme.colors.text }]}>
                        Proposed: {formatPrice(app.proposed_price)}
                      </Text>
                      <Text style={[styles.daysTag, { color: theme.colors.muted }]}>
                        ⏱️ {app.estimated_days} day(s) estimated
                      </Text>
                    </View>

                    {app.counter_price ? (
                      <AlertBox
                        tone="warning"
                        message={`Counteroffer: ${formatPrice(app.counter_price)}`}
                        style={{ marginBottom: 8 }}
                      />
                    ) : null}

                    <Card tone="inset" padding="sm" style={{ marginBottom: 12 }}>
                      <Text style={[styles.messageText, { color: theme.colors.text }]}>
                        "{app.message}"
                      </Text>
                    </Card>

                    <Button
                      title={`Open Chat with ${freelancerName}`}
                      icon="chatbubble-ellipses-outline"
                      variant="soft"
                      size="sm"
                      onPress={() => handleOpenApplicantChat(app)}
                      style={{ marginBottom: 10 }}
                    />

                    {/* Counter Input Row */}
                    {isCounteringThis && (
                      <View style={[styles.counterInputRow, { borderColor: theme.colors.border }]}>
                        <View style={{ flex: 1, minWidth: 140 }}>
                          <TextInput
                            label="Counter Fee (₱)"
                            prefixText="₱"
                            placeholder="1200"
                            value={counterPriceStr}
                            onChangeText={setCounterPriceStr}
                            keyboardType="numeric"
                            containerStyle={{ marginBottom: 0 }}
                          />
                        </View>
                        <Button
                          title="Send"
                          variant="primary"
                          size="sm"
                          fullWidth={false}
                          loading={isBusy}
                          disabled={isBusy}
                          onPress={() => handleSendCounter(app.id)}
                        />
                        <Button
                          title="Cancel"
                          variant="ghost"
                          size="sm"
                          fullWidth={false}
                          onPress={() => setCounterAppId(null)}
                        />
                      </View>
                    )}

                    {/* Action buttons (only when status is 'applied') */}
                    {app.status === 'applied' && !isCounteringThis && (
                      <View style={[styles.actionButtonsRow, { borderTopColor: theme.colors.border }]}>
                        <Button
                          title="Accept"
                          variant="primary"
                          size="sm"
                          fullWidth={false}
                          loading={isBusy}
                          disabled={isBusy}
                          onPress={() => handleAccept(app)}
                          style={{ flex: 1.4 }}
                        />
                        <Button
                          title="Counter"
                          variant="secondary"
                          size="sm"
                          fullWidth={false}
                          disabled={isBusy}
                          onPress={() => {
                            setCounterAppId(app.id);
                            setCounterPriceStr('');
                          }}
                          style={{ flex: 1 }}
                        />
                        <Button
                          title="Decline"
                          variant="danger-soft"
                          size="sm"
                          fullWidth={false}
                          disabled={isBusy}
                          onPress={() => handleDecline(app.id, freelancerName)}
                          style={{ flex: 1 }}
                        />
                      </View>
                    )}
                  </Card>
                );
              })}
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
    padding: 16,
  },
  centeredBlock: {
    width: '100%',
    maxWidth: 1120,
    alignSelf: 'center',
  },
  filterRow: {
    gap: 8,
    paddingBottom: 14,
  },
  desktopGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  desktopGridItem: {
    width: '48.5%' as any,
    marginBottom: 0,
  },
  card: {
    marginBottom: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    gap: 10,
  },
  freelancerProfileTouch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  freelancerCol: {
    flex: 1,
  },
  freelancerName: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 2,
  },
  freelancerStats: {
    fontSize: 12,
  },
  viewProfileHint: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  proposalInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 10,
  },
  priceTag: {
    fontSize: 16,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  daysTag: {
    fontSize: 13,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  counterInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 10,
    borderTopWidth: 1,
  },
});
