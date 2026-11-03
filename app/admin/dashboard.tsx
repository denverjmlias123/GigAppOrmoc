import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { adminService } from '../../services/admin';
import { strings, mapSqlErrorToFriendlyMessage } from '../../constants/strings';
import { Button } from '../../components/ui/Button';
import { Card, StatBox } from '../../components/ui/Card';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { ErrorState } from '../../components/ui/ErrorState';

const metrics: Array<[string, string, 'primary' | 'success' | 'warning' | 'danger']> = [
  ['total_users', 'userCount', 'primary'],
  ['new_users_7_days', 'newUsers', 'success'],
  ['active_gigs', 'activeGigs', 'primary'],
  ['agreements_in_progress', 'inProgress', 'warning'],
  ['completed_agreements', 'completed', 'success'],
  ['open_reports', 'openReports', 'danger'],
  ['locked_accounts', 'lockedAccounts', 'danger'],
  ['today_log_events', 'todayEvents', 'primary'],
];

export default function AdminDashboard() {
  const theme = useAppTheme();
  const { isWide } = useResponsiveLayout();
  const router = useRouter();
  const [data, setData] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setData(await adminService.dashboardMetrics());
    } catch (e) {
      setError(mapSqlErrorToFriendlyMessage(e, strings.errors.serverError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (error && !data) return <ErrorState message={error} onRetry={() => load()} />;

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load(true)}
          tintColor={theme.colors.primary}
        />
      }
    >
      <Text style={[theme.type.title, { color: theme.colors.text }]}>{strings.admin.dashboard}</Text>
      {loading && !data ? (
        <Text style={[theme.type.body, { color: theme.colors.muted }]}>{strings.common.loading}</Text>
      ) : (
        <View style={styles.grid}>
          {metrics.map(([key, label, tone]) => {
            const copy = strings.admin[label as keyof typeof strings.admin];
            return (
              <StatBox
                key={key}
                value={Number(data?.[key] ?? 0).toLocaleString()}
                label={typeof copy === 'string' ? copy : label}
                tone={tone}
                style={[styles.metric, isWide && styles.metricWide]}
              />
            );
          })}
        </View>
      )}
      <View style={[styles.actionsRow, isWide && styles.actionsRowWide]}>
        <View style={styles.actionBtnWrap}>
          <Button
            title={strings.admin.users}
            icon="people-outline"
            onPress={() => router.push('/admin/users')}
          />
        </View>
        <View style={styles.actionBtnWrap}>
          <Button
            title={strings.admin.logTrail}
            variant="secondary"
            icon="list-outline"
            onPress={() => router.push('/admin/log-trail')}
          />
        </View>
      </View>

      <SectionHeader
        title={strings.admin.latestActivity}
        icon="pulse-outline"
        style={{ marginTop: 16 }}
      />
      {(data?.latest_activity || []).length ? (
        data?.latest_activity?.map((row: any) => (
          <Card key={row.id} tone="raised" padding="md">
            <Text style={[theme.type.bodyStrong, { color: theme.colors.text }]}>{row.action}</Text>
            <Text style={[theme.type.small, { color: theme.colors.muted }]}>
              {row.actor_email || strings.admin.noActivity} · {new Date(row.created_at).toLocaleString()}
            </Text>
          </Card>
        ))
      ) : !loading ? (
        <Text style={[theme.type.body, { color: theme.colors.muted }]}>{strings.admin.noActivity}</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    gap: 12,
    maxWidth: 1120,
    width: '100%',
    alignSelf: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metric: {
    width: '48%',
    minWidth: 140,
    flexGrow: 1,
  },
  metricWide: {
    width: '23%',
  },
  actionsRow: {
    gap: 10,
  },
  actionsRowWide: {
    flexDirection: 'row',
  },
  actionBtnWrap: {
    flex: 1,
  },
});
