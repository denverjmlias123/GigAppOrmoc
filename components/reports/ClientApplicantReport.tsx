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
  ClientApplicantSummary,
} from '../../services/applicantReports';
import { formatPrice } from '../ui/GigCard';
import { Badge } from '../ui/Badge';
import { LegitBadge } from '../ui/LegitBadge';
import { Avatar } from '../ui/Avatar';
import { Card, StatBox } from '../ui/Card';
import { Chip, SegmentedControl } from '../ui/Chip';
import { Button } from '../ui/Button';

interface Props {
  clientId: string;
}

type FilterStatus = 'all' | 'pending' | 'accepted' | 'declined';

export const ClientApplicantReport: React.FC<Props> = ({ clientId }) => {
  const theme = useAppTheme();
  const router = useRouter();
  const [data, setData] = useState<ClientApplicantSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [selectedGigId, setSelectedGigId] = useState<string | 'all'>('all');

  const load = useCallback(async () => {
    try {
      const res = await applicantReportsService.getClientReport(clientId);
      setData(res);
    } catch {
      // Fallback
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={[styles.loadingText, { color: theme.colors.muted }]}>
          Loading applicant reports...
        </Text>
      </View>
    );
  }

  const filteredApplicants = (data?.allApplicants || []).filter((app) => {
    if (selectedGigId !== 'all' && app.gig_id !== selectedGigId) {
      return false;
    }
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
        <Text style={[styles.title, { color: theme.colors.text }]}>Applicant Analytics & Reports</Text>
        <Text style={[styles.subtitle, { color: theme.colors.muted }]}>
          Overview of candidates applying to your posted gigs
        </Text>
      </View>

      {/* KPI Cards */}
      <View style={styles.kpiGrid}>
        <StatBox
          label="Total Applicants"
          value={data?.totalApplicants ?? 0}
          icon="people-outline"
          tone="primary"
          style={styles.kpiCard}
        />
        <StatBox
          label="Pending Review"
          value={data?.pendingCount ?? 0}
          icon="time-outline"
          tone="warning"
          style={styles.kpiCard}
        />
        <StatBox
          label="Accepted"
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

      {/* Acceptance Rate Banner */}
      <Card tone="role" padding="md">
        <View style={styles.rateBanner}>
          <View style={styles.rateInfo}>
            <Text style={[styles.rateTitle, { color: theme.colors.text }]}>Acceptance Rate</Text>
            <Text style={[styles.rateSubtitle, { color: theme.colors.muted }]}>
              {data?.acceptedCount || 0} accepted of {data?.totalApplicants || 0} applicants
            </Text>
          </View>
          <Text style={[styles.ratePercentage, { color: theme.colors.primary }]}>
            {data?.acceptanceRate ?? 0}%
          </Text>
        </View>
      </Card>

      {/* Filter by Gig */}
      {(data?.gigBreakdowns || []).length > 1 && (
        <View style={styles.gigFilterWrap}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Filter by Gig Post</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipsRow}>
            <Chip
              label="All Gigs"
              count={data?.totalApplicants ?? 0}
              selected={selectedGigId === 'all'}
              onPress={() => setSelectedGigId('all')}
              size="sm"
            />
            {data?.gigBreakdowns.map((g) => (
              <Chip
                key={g.gigId}
                label={g.gigTitle}
                count={g.totalApplicants}
                selected={selectedGigId === g.gigId}
                onPress={() => setSelectedGigId(g.gigId)}
                size="sm"
              />
            ))}
          </ScrollView>
        </View>
      )}

      {/* Filter by Status */}
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

      {/* Applicant Records List */}
      <Text style={[styles.sectionTitle, { color: theme.colors.text, marginTop: 14 }]}>
        Applicant Records ({filteredApplicants.length})
      </Text>

      {filteredApplicants.length === 0 ? (
        <Card tone="inset" padding="lg" style={styles.emptyWrap}>
          <Ionicons name="document-text-outline" size={38} color={theme.colors.muted} />
          <Text style={[styles.emptyText, { color: theme.colors.muted }]}>
            No applicants match the selected filters.
          </Text>
        </Card>
      ) : (
        <View style={styles.applicantList}>
          {filteredApplicants.map((app) => (
            <Card key={app.id} style={styles.applicantCard}>
              <View style={styles.applicantHeader}>
                <Avatar
                  name={app.freelancer?.display_name || 'Freelancer'}
                  avatarPath={app.freelancer?.avatar_path}
                  size={42}
                />
                <View style={styles.nameBlock}>
                  <View style={styles.nameRow}>
                    <Text style={[styles.applicantName, { color: theme.colors.text }]}>
                      {app.freelancer?.display_name || 'Freelancer'}
                    </Text>
                    {app.freelancer?.is_legit_verified && <LegitBadge size="small" role="freelancer" />}
                  </View>
                  <Text style={[styles.gigTag, { color: theme.colors.muted }]} numberOfLines={1}>
                    Applied to: {app.gigTitle}
                  </Text>
                </View>
                <Badge status={app.status} />
              </View>

              <Card tone="inset" padding="sm">
                <View style={styles.metaRow}>
                  <View style={styles.metaItem}>
                    <Text style={[styles.metaLabel, { color: theme.colors.muted }]}>Proposed Price</Text>
                    <Text style={[styles.metaVal, { color: theme.colors.text }]}>
                      {formatPrice(app.proposed_price)}
                    </Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Text style={[styles.metaLabel, { color: theme.colors.muted }]}>Timeline</Text>
                    <Text style={[styles.metaVal, { color: theme.colors.text }]}>
                      {app.estimated_days} days
                    </Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Text style={[styles.metaLabel, { color: theme.colors.muted }]}>Applied Date</Text>
                    <Text style={[styles.metaVal, { color: theme.colors.text }]}>
                      {new Date(app.created_at).toLocaleDateString()}
                    </Text>
                  </View>
                </View>
              </Card>

              {app.message ? (
                <Text style={[styles.appMessage, { color: theme.colors.muted }]} numberOfLines={2}>
                  "{app.message}"
                </Text>
              ) : null}

              <Button
                title="View / Manage in Gig"
                onPress={() => router.push({ pathname: '/gigs/[id]/applicants', params: { id: app.gig_id } })}
                variant="soft"
                size="sm"
                rightIcon="chevron-forward"
                fullWidth
              />
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
  gigFilterWrap: {
    gap: 8,
    marginTop: 6,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  filterChipsRow: {
    gap: 8,
    paddingVertical: 4,
  },
  statusFilterWrap: {
    gap: 8,
    marginTop: 6,
  },
  applicantList: {
    gap: 10,
  },
  applicantCard: {
    padding: 14,
    gap: 10,
  },
  applicantHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  nameBlock: {
    flex: 1,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  applicantName: {
    fontSize: 14,
    fontWeight: '700',
  },
  gigTag: {
    fontSize: 12,
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
  appMessage: {
    fontSize: 12,
    fontStyle: 'italic',
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
