import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { Button } from '../../components/ui/Button';
import { Card, PageHeaderBox } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/ErrorState';
import { showToast } from '../../components/ui/Toast';
import { confirmDialog } from '../../lib/dialog';
import { strings } from '../../constants/strings';
import { sessionService, UserSession } from '../../services/sessions';

export default function SessionsScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { bottomPad } = useResponsiveLayout();
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [rows, activeId] = await Promise.all([
        sessionService.listMySessions(),
        sessionService.getCurrentSessionId(),
      ]);
      setSessions(rows);
      setCurrentId(activeId);
    } catch {
      setError(strings.auth.sessionsLoadFailed);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const handleEndOtherSessions = async () => {
    if (busy) return;
    const accepted = await confirmDialog({
      title: strings.auth.sessionsLogOutOthers,
      message: strings.auth.sessionsLogOutOthersConfirm,
      confirmText: strings.auth.sessionsLogOutOthers,
      cancelText: strings.common.cancel,
      destructive: true,
    });
    if (!accepted) return;
    setBusy(true);
    try {
      const count = await sessionService.endOtherSessions();
      await loadSessions();
      showToast(strings.auth.sessionsLogOutOthersDone(count), 'success');
    } catch (err: any) {
      showToast(err?.message || 'Could not log out other sessions.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const formatLastActive = (value: string) =>
    new Date(value).toLocaleString('en-PH', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });

  const getDeviceIcon = (platform: string): React.ComponentProps<typeof Ionicons>['name'] => {
    const lower = (platform || '').toLowerCase();
    if (lower.includes('ios') || lower.includes('android') || lower.includes('mobile')) {
      return 'phone-portrait-outline';
    }
    return 'laptop-outline';
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <PageHeaderBox
        title={strings.auth.sessionsTitle}
        subtitle={strings.auth.sessionsSubtitle}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'))}
        maxWidth={680}
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(bottomPad, 32) },
        ]}
      >
        <View style={styles.innerWrap}>
          {loading ? (
            <ActivityIndicator
              accessibilityLabel={strings.common.loading}
              color={theme.colors.primary}
            />
          ) : null}
          {!loading && error ? <ErrorState message={error} onRetry={loadSessions} /> : null}
          {!loading && !error && sessions.length === 0 ? (
            <Card tone="raised" padding="md">
              <Text style={[theme.type.body, { color: theme.colors.muted }]}>
                {strings.auth.sessionsEmpty}
              </Text>
            </Card>
          ) : null}
          {!loading && !error
            ? sessions.map((item) => (
                <Card
                  key={item.id}
                  tone={item.id === currentId ? 'tinted-primary' : 'raised'}
                  padding="md"
                  style={styles.sessionCard}
                >
                  <View style={styles.sessionHeader}>
                    <View style={styles.sessionTitleRow}>
                      <Ionicons
                        name={getDeviceIcon(item.platform)}
                        size={18}
                        color={item.id === currentId ? theme.colors.primary : theme.colors.muted}
                      />
                      <Text style={[theme.type.bodyStrong, { color: theme.colors.text }]}>
                        {item.device_label}
                      </Text>
                    </View>
                    {item.id === currentId ? (
                      <Text
                        style={[
                          theme.type.small,
                          { color: theme.colors.primary, fontWeight: '700' },
                        ]}
                      >
                        {strings.auth.sessionsThisDevice}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[theme.type.small, { color: theme.colors.muted }]}>
                    {item.ended_at
                      ? strings.auth.sessionsEnded
                      : strings.auth.sessionsLastActive(formatLastActive(item.last_seen_at))}
                  </Text>
                  <Text style={[theme.type.small, { color: theme.colors.muted }]}>
                    {String(item.platform || '').toUpperCase()}
                  </Text>
                </Card>
              ))
            : null}

          {!loading && !error && sessions.some((item) => !item.ended_at && item.id !== currentId) ? (
            <Button
              title={strings.auth.sessionsLogOutOthers}
              icon="log-out-outline"
              onPress={handleEndOtherSessions}
              loading={busy}
              disabled={busy}
              variant="danger-soft"
            />
          ) : null}
          <Button
            title={strings.common.back}
            variant="ghost"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'))}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20 },
  innerWrap: {
    maxWidth: 680,
    width: '100%',
    alignSelf: 'center',
    gap: 12,
  },
  sessionCard: { gap: 6 },
  sessionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sessionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
