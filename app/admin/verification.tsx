import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { adminService, VerificationQueueItem } from '../../services/admin';
import { LegitBadge } from '../../components/ui/LegitBadge';
import { Card, StatBox, AlertBox } from '../../components/ui/Card';
import { SegmentedControl } from '../../components/ui/Chip';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { showToast } from '../../components/ui/Toast';
import { confirmDialog } from '../../lib/dialog';

type FilterType = 'all' | 'ai_flagged' | 'approved' | 'rejected';

export default function AdminVerificationScreen() {
  const theme = useAppTheme();
  const { isWide } = useResponsiveLayout();
  const router = useRouter();

  const [queue, setQueue] = useState<VerificationQueueItem[]>([]);
  const [isSuperAdminUser, setIsSuperAdminUser] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const isSuper = await adminService.isSuperAdmin();
      setIsSuperAdminUser(isSuper);
      if (!isSuper) {
        setLoading(false);
        setRefreshing(false);
        return;
      }
      const data = await adminService.listVerificationQueue();
      setQueue(data);
    } catch (err: any) {
      showToast(err?.message || 'Could not load verification queue', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleApprove = async (item: VerificationQueueItem) => {
    if (!isSuperAdminUser) return;
    const confirmed = await confirmDialog({
      title: 'Approve Legit Badge',
      message: `Confirm granting the official Legit Account badge to ${item.display_name}? As Super Admin, your human decision will certify this account.`,
      confirmText: 'Approve Badge',
      cancelText: 'Cancel',
    });
    if (!confirmed) return;

    setActionBusyId(item.id);
    try {
      await adminService.approveLegitimacyBadge(item.id);
      showToast(`Legit Badge approved for ${item.display_name}`, 'success');
      await load();
    } catch (err: any) {
      showToast(err?.message || 'Failed to approve badge', 'error');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleReject = async (item: VerificationQueueItem) => {
    if (!isSuperAdminUser) return;
    const confirmed = await confirmDialog({
      title: 'Decline Verification',
      message: `Decline legitimacy badge for ${item.display_name}? The user can update their profile and request review again later.`,
      confirmText: 'Decline',
      cancelText: 'Cancel',
    });
    if (!confirmed) return;

    setActionBusyId(item.id);
    try {
      await adminService.rejectLegitimacyBadge(item.id);
      showToast(`Verification declined for ${item.display_name}`, 'info');
      await load();
    } catch (err: any) {
      showToast(err?.message || 'Failed to reject verification', 'error');
    } finally {
      setActionBusyId(null);
    }
  };

  const filteredItems = queue.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'ai_flagged') {
      return item.verification_status === 'ai_flagged' || (item.verification_status as any) === 'pending';
    }
    return item.verification_status === filter;
  });

  if (isSuperAdminUser === false) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background, minHeight: 360 }]}>
        <AlertBox
          tone="danger"
          title="Super Admin Access Required"
          message="Super Admin credentials are required to certify accounts and review the legitimacy queue."
          action={
            <Button
              title="Return to Dashboard"
              variant="secondary"
              size="sm"
              fullWidth={false}
              onPress={() => router.replace('/admin/dashboard')}
            />
          }
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={[styles.container, isWide && styles.containerWide]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          tintColor={theme.colors.primary}
        />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Ionicons name="shield-checkmark" size={26} color={theme.colors.primary} />
          <Text style={[styles.title, { color: theme.colors.text }]}>
            AI Screening & Legitimacy Queue
          </Text>
        </View>
        <Text style={[styles.subtitle, { color: theme.colors.muted }]}>
          Human-in-the-Loop decision center: The AI monitors accounts and flags candidates; Super Admin makes the final confirmation.
        </Text>
      </View>

      {/* KPI Stats */}
      <View style={styles.kpiRow}>
        <StatBox
          value={queue.filter((i) => i.verification_status === 'ai_flagged' || (i.verification_status as any) === 'pending').length}
          label="AI Flagged (Pending)"
          tone="warning"
          icon="alert-circle-outline"
          style={{ flex: 1 }}
        />
        <StatBox
          value={queue.filter((i) => i.verification_status === 'approved' || i.is_legit_verified).length}
          label="Super Admin Approved"
          tone="success"
          icon="shield-checkmark-outline"
          style={{ flex: 1 }}
        />
        <StatBox
          value={queue.filter((i) => i.verification_status === 'rejected').length}
          label="Declined"
          tone="danger"
          icon="close-circle-outline"
          style={{ flex: 1 }}
        />
      </View>

      {/* Filters */}
      <SegmentedControl
        options={[
          { value: 'all', label: 'All', count: queue.length },
          { value: 'ai_flagged', label: 'Pending Review' },
          { value: 'approved', label: 'Approved' },
          { value: 'rejected', label: 'Declined' },
        ]}
        value={filter}
        onChange={(val) => setFilter(val as FilterType)}
      />

      {/* List */}
      {loading && !queue.length ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={[styles.loadingText, { color: theme.colors.muted }]}>
            Loading verification queue...
          </Text>
        </View>
      ) : filteredItems.length === 0 ? (
        <EmptyState
          icon="checkmark-circle-outline"
          title="No accounts in this queue"
          description="Accounts screened by AI will appear here for Super Admin approval."
        />
      ) : (
        <View style={styles.itemsList}>
          {filteredItems.map((item) => {
            const isBusy = actionBusyId === item.id;
            const report = item.ai_legitimacy_report || {};
            const score = item.ai_legitimacy_score || report.score || 0;
            const isApproved = item.verification_status === 'approved' || item.is_legit_verified;
            const isRejected = item.verification_status === 'rejected';

            return (
              <Card key={item.id} tone="raised" padding="md" style={styles.itemCard}>
                {/* User Header */}
                <View style={styles.itemHeader}>
                  <View style={styles.userInfoCol}>
                    <View style={styles.userTitleRow}>
                      <Text style={[styles.userName, { color: theme.colors.text }]}>
                        {item.display_name}
                      </Text>
                      {isApproved && <LegitBadge size="small" role={item.active_mode} />}
                    </View>
                    <Text style={[styles.userSub, { color: theme.colors.muted }]}>
                      Role: {item.active_mode === 'hire' ? 'Client' : 'Freelancer'} • {item.area || 'Ormoc City'}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.statusPill,
                      isApproved
                        ? { backgroundColor: theme.colors.successSoft }
                        : isRejected
                        ? { backgroundColor: theme.colors.dangerSoft }
                        : { backgroundColor: theme.colors.warningSoft },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusPillText,
                        {
                          color: isApproved
                            ? theme.colors.successText
                            : isRejected
                            ? theme.colors.dangerText
                            : theme.colors.warningText,
                        },
                      ]}
                    >
                      {isApproved
                        ? 'Confirmed Legit'
                        : isRejected
                        ? 'Declined'
                        : 'AI Flagged (Awaiting Admin)'}
                    </Text>
                  </View>
                </View>

                {/* AI Screening Box */}
                <Card tone="muted" padding="sm" style={styles.aiBox}>
                  <View style={styles.aiHeaderRow}>
                    <View style={styles.aiTag}>
                      <Ionicons name="sparkles" size={14} color={theme.colors.primary} />
                      <Text style={[styles.aiTagText, { color: theme.colors.primary }]}>
                        AI Screening Analysis
                      </Text>
                    </View>
                    <View style={[styles.aiScoreBadge, { backgroundColor: theme.colors.primarySoft }]}>
                      <Text style={[styles.aiScoreText, { color: theme.colors.primaryDark }]}>
                        Score: {score}%
                      </Text>
                    </View>
                  </View>

                  <Text style={[styles.aiSummaryText, { color: theme.colors.text }]}>
                    {report.aiSummary || 'AI evaluated account parameters and recommends human verification review.'}
                  </Text>

                  {/* Criteria Checklist */}
                  {Array.isArray(report.checklist) && (
                    <View style={[styles.checklistWrap, { borderTopColor: theme.colors.border }]}>
                      {report.checklist.map((c: any) => (
                        <View key={c.id || c.label} style={styles.checkItem}>
                          <Ionicons
                            name={c.passed ? 'checkmark-circle' : 'close-circle'}
                            size={16}
                            color={c.passed ? theme.colors.success : theme.colors.danger}
                          />
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.checkLabel, { color: theme.colors.text }]}>
                              {c.label}
                            </Text>
                            <Text style={[styles.checkNotes, { color: theme.colors.muted }]}>
                              {c.notes}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                </Card>

                {/* Super Admin Action Controls */}
                {!isApproved ? (
                  <View style={styles.actionRow}>
                    <Button
                      title="Approve Legit Badge"
                      icon="shield-checkmark-outline"
                      onPress={() => handleApprove(item)}
                      loading={isBusy}
                      style={{ flex: 2 }}
                    />
                    <Button
                      title="Decline"
                      variant="secondary"
                      onPress={() => handleReject(item)}
                      disabled={isBusy}
                      style={{ flex: 1 }}
                    />
                  </View>
                ) : (
                  <View style={styles.approvedNoticeRow}>
                    <Ionicons name="checkmark-done" size={18} color={theme.colors.success} />
                    <Text style={[styles.approvedNoticeText, { color: theme.colors.success }]}>
                      Certified by Super Admin on {item.verified_at ? new Date(item.verified_at).toLocaleDateString() : 'Today'}
                    </Text>
                  </View>
                )}
              </Card>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 40,
    gap: 14,
  },
  containerWide: {
    maxWidth: 1120,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    gap: 4,
    marginBottom: 4,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  kpiRow: {
    flexDirection: 'row',
    gap: 10,
  },
  itemsList: {
    gap: 14,
  },
  itemCard: {
    gap: 12,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  userInfoCol: {
    flex: 1,
    gap: 3,
  },
  userTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  userName: {
    fontSize: 16,
    fontWeight: '700',
  },
  userSub: {
    fontSize: 12,
  },
  statusPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  aiBox: {
    gap: 8,
  },
  aiHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  aiTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  aiTagText: {
    fontSize: 12,
    fontWeight: '700',
  },
  aiScoreBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  aiScoreText: {
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  aiSummaryText: {
    fontSize: 13,
    lineHeight: 18,
  },
  checklistWrap: {
    gap: 6,
    marginTop: 4,
    borderTopWidth: 1,
    paddingTop: 8,
  },
  checkItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  checkLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  checkNotes: {
    fontSize: 11,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  approvedNoticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  approvedNoticeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  center: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },
});
