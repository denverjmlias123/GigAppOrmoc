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
import { useAppTheme } from '../../app/theme';
import {
  applicantReportsService,
  FreelancerApplicationSummary,
} from '../../services/applicantReports';
import { formatPrice } from '../ui/GigCard';
import { Badge } from '../ui/Badge';
import { Card, StatBox } from '../ui/Card';
import { SegmentedControl } from '../ui/Chip';
import { Button } from '../ui/Button';

type FilterStatus = 'all' | 'pending' | 'accepted' | 'declined';

export const FreelancerApplicationReport: React.FC = () => {
  const theme = useAppTheme();
  const router = useRouter();
  const [data, setData] = useState<FreelancerApplicationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');

  const load = useCallback(async () => {
    try {
      const res = await applicantReportsService.getFreelancerReport();
      setData(res);
    } catch {
      // Fallback
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={[styles.loadingText, { color: theme.colors.muted }]}>
          Loading application reports...
        </Text>
      </View>
    );
  }

  const filteredApps = (data?.applications || []).filter((app) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'pending') {
      return app.status === 'applied' || app.status === 'countered';
    }
    if (statusFilter === 'accepted') {
      return app.status === 'accepted';
    }
    if (statusFilter === 'declined') {
      return app.status === 'declined';
    }
    return true;
  });

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />
      }
    >
      {/* Title */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.colors.text }]}>Application Status & Performance</Text>
        <Text style={[styles.subtitle, { color: theme.colors.muted }]}>
          Summary of your proposals, accepted gigs, and application history
        </Text>
      </View>

      {/* KPI Cards */}
      <View style={styles.kpiGrid}>
        <StatBox
          label="Total Applied"
          value={data?.totalApplied ?? 0}
          icon="paper-plane-outline"
          tone="primary"
          style={styles.kpiCard}
        />
        <StatBox
          label="Awaiting Review"
          value={data?.pendingCount ?? 0}
          icon="time-outline"
          tone="warning"
          style={styles.kpiCard}
        />
        <StatBox
          label="Accepted / Hired"
          value={data?.acceptedCount ?? 0}
          icon="checkmark-circle-outline"
          tone="success"
          style={styles.kpiCard}
        />
        <StatBox
          label="Declined"
          value={data?.declinedCount ?? 0}
          icon="close-circle-outline"
          tone="danger"
          style={styles.kpiCard}
        />
      </View>

      {/* Success Rate Banner */}
      <Card tone="role" padding="md">
        <View style={styles.rateBanner}>
          <View style={styles.rateInfo}>
            <Text style={[styles.rateTitle, { color: theme.colors.text }]}>Proposal Success Rate</Text>
            <Text style={[styles.rateSubtitle, { color: theme.colors.muted }]}>
              {data?.acceptedCount || 0} accepted out of {data?.totalApplied || 0} applications
            </Text>
          </View>
          <Text style={[styles.ratePercentage, { color: theme.colors.success }]}>
            {data?.successRate ?? 0}%
          </Text>
        </View>
      </Card>

      {/* Status Filter */}
      <View style={styles.statusFilterWrap}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Filter by Status</Text>
        <SegmentedControl
          value={statusFilter}
          onChange={(val) => setStatusFilter(val as FilterStatus)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'pending', label: 'Pending' },
            { value: 'accepted', label: 'Accepted' },
            { value: 'declined', label: 'Declined' },
          ]}
        />
      </View>

      {/* Application Records List */}
      <Text style={[styles.sectionTitle, { color: theme.colors.text, marginTop: 14 }]}>
        Application Records ({filteredApps.length})
      </Text>

      {filteredApps.length === 0 ? (
        <Card tone="inset" padding="lg" style={styles.emptyWrap}>
          <Ionicons name="briefcase-outline" size={38} color={theme.colors.muted} />
          <Text style={[styles.emptyText, { color: theme.colors.muted }]}>
            No applications match the selected filter.
          </Text>
        </Card>
      ) : (
        <View style={styles.appList}>
          {filteredApps.map((app) => (
            <Card key={app.id} style={styles.appCard}>
              <View style={styles.appHeader}>
                <View style={styles.gigTitleBlock}>
                  <Text style={[styles.gigTitle, { color: theme.colors.text }]} numberOfLines={1}>
                    {app.gig?.title || app.gig_title_snapshot || 'Gig Opportunity'}
                  </Text>
                  <Text style={[styles.dateText, { color: theme.colors.muted }]}>
                    Submitted {new Date(app.created_at).toLocaleDateString()}
                  </Text>
                </View>
                <Badge status={app.status} />
              </View>

              <Card tone="inset" padding="sm">
                <View style={styles.metaRow}>
                  <View style={styles.metaItem}>
                    <Text style={[styles.metaLabel, { color: theme.colors.muted }]}>Your Proposal</Text>
                    <Text style={[styles.metaVal, { color: theme.colors.text }]}>
                      {formatPrice(app.proposed_price)}
                    </Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Text style={[styles.metaLabel, { color: theme.colors.muted }]}>Est. Days</Text>
                    <Text style={[styles.metaVal, { color: theme.colors.text }]}>
                      {app.estimated_days} days
                    </Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Text style={[styles.metaLabel, { color: theme.colors.muted }]}>Outcome</Text>
                    <Text
                      style={[
                        styles.metaVal,
                        {
                          color:
                            app.status === 'accepted'
                              ? theme.colors.success
                              : app.status === 'declined'
                              ? theme.colors.danger
                              : theme.colors.warning,
                        },
                      ]}
                    >
                      {app.status === 'accepted'
                        ? 'Accepted'
                        : app.status === 'declined'
                        ? 'Declined'
                        : 'Pending'}
                    </Text>
                  </View>
                </View>
              </Card>

              {app.status_reason ? (
                <Text style={[styles.statusReason, { color: theme.colors.muted }]}>
                  Note: {app.status_reason}
                </Text>
              ) : null}

              {app.message ? (
                <Text style={[styles.appMessage, { color: theme.colors.muted }]} numberOfLines={2}>
                  Your message: "{app.message}"
                </Text>
              ) : null}

              {app.gig?.id ? (
                <Button
                  title="View Gig Post"
                  onPress={() => router.push({ pathname: '/gigs/[id]', params: { id: app.gig!.id } })}
                  variant="soft"
                  size="sm"
                  rightIcon="chevron-forward"
                  fullWidth
                />
              ) : null}
            </Card>
          ))}
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 40,
    gap: 12,
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
  header: {
    marginBottom: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  kpiCard: {
    flex: 1,
    minWidth: '45%',
  },
  rateBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rateInfo: {
    gap: 2,
  },
  rateTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  rateSubtitle: {
    fontSize: 12,
  },
  ratePercentage: {
    fontSize: 24,
    fontWeight: '800',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  statusFilterWrap: {
    gap: 8,
    marginTop: 6,
  },
  appList: {
    gap: 10,
  },
  appCard: {
    padding: 14,
    gap: 10,
  },
  appHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  gigTitleBlock: {
    flex: 1,
    gap: 2,
  },
  gigTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  dateText: {
    fontSize: 11,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metaItem: {
    gap: 2,
  },
  metaLabel: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  metaVal: {
    fontSize: 12,
    fontWeight: '700',
  },
  statusReason: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  appMessage: {
    fontSize: 12,
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
    textAlign: 'center',
  },
});
