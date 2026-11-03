import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { applicationsService, ModeSwitchStatus } from '../../services/applications';
import { Button } from '../../components/ui/Button';
import { Card, AlertBox, PageHeaderBox } from '../../components/ui/Card';
import { showToast } from '../../components/ui/Toast';
import { confirmDialog } from '../../lib/dialog';
import { mapSqlErrorToFriendlyMessage, strings } from '../../constants/strings';

export default function ModeSettingsScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { isWide, bottomPad } = useResponsiveLayout();
  const { profile, refreshProfile, runSharedCleanup } = useAuth();

  const [status, setStatus] = useState<ModeSwitchStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await applicationsService.getModeSwitchStatus();
      setStatus(data);
    } catch (err: any) {
      setError(mapSqlErrorToFriendlyMessage(err, 'Failed to check mode status.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const currentMode = profile?.active_mode || status?.current_mode;
  const targetMode = currentMode === 'find_work' ? 'hire' : 'find_work';
  const targetLabel = targetMode === 'find_work' ? 'Find Work (Freelancer)' : 'Hire (Client)';

  const handleSwitchMode = async () => {
    if (!status?.can_switch || switching) return;

    let warningText = '';
    if (currentMode === 'hire') {
      warningText = `Switching to Find Work mode will cancel any open or draft gigs you have posted (${status.pending_gigs_count} gig(s)).\n\nYou will not be able to switch back for 7 days.`;
    } else {
      warningText = `Switching to Hire mode will withdraw any pending job proposals you have submitted (${status.pending_apps_count} proposal(s)).\n\nYou will not be able to switch back for 7 days.`;
    }

    const confirmed = await confirmDialog({
      title: `Switch to ${targetLabel}?`,
      message: `${warningText}\n\nAre you sure you want to proceed?`,
      confirmText: 'Confirm & Switch Mode',
      destructive: true,
    });
    if (!confirmed) return;

    setSwitching(true);
    try {
      await applicationsService.switchMode(targetMode, true);
      try {
        await supabase.removeAllChannels();
        await runSharedCleanup();
      } catch {
        // Ignore channel cleanup errors
      }
      await refreshProfile();
      await fetchStatus();
      showToast(strings.toasts.modeSwitched);
      router.replace('/(tabs)');
    } catch (err: any) {
      showToast(mapSqlErrorToFriendlyMessage(err, 'Could not switch mode.'), 'error');
    } finally {
      setSwitching(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <PageHeaderBox
        title="Account Mode"
        subtitle="Switch between Freelancer and Client workspaces"
        onBack={() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace('/(tabs)/profile');
          }
        }}
        maxWidth={680}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(bottomPad, 40) },
          ]}
        >
          <View style={styles.innerWrap}>
            {/* Current Mode Card */}
            <Card tone="raised" padding="md" style={styles.cardGap}>
              <Text style={[styles.label, { color: theme.colors.muted }]}>Current Active Mode</Text>
              <Text style={[styles.modeTitle, { color: theme.colors.primary }]}>
                {currentMode === 'find_work'
                  ? 'Find Work (Freelancer)'
                  : currentMode === 'hire'
                  ? 'Hire (Client)'
                  : 'Not Set'}
              </Text>
              <Text style={[styles.modeDescription, { color: theme.colors.muted }]}>
                {currentMode === 'find_work'
                  ? 'You can browse gigs, submit proposals, and complete projects for clients in Ormoc.'
                  : 'You can post gigs, review applicants, and hire local talent in Ormoc.'}
              </Text>
            </Card>

            {/* Role Comparison Cards */}
            <View style={[styles.comparisonRow, isWide && styles.comparisonRowWide]}>
              <Card
                tone={currentMode === 'find_work' ? 'tinted-success' : 'raised'}
                padding="md"
                style={styles.roleCompCard}
              >
                <View style={styles.roleCompHeader}>
                  <Text style={[styles.roleCompTitle, { color: theme.colors.text }]}>
                    Freelancer Mode
                  </Text>
                  <Text
                    style={[
                      styles.roleCompStatus,
                      {
                        color:
                          currentMode === 'find_work' ? theme.colors.success : theme.colors.muted,
                      },
                    ]}
                  >
                    {currentMode === 'find_work' ? 'ACTIVE' : 'SWITCH TARGET'}
                  </Text>
                </View>
                <Text style={[styles.roleCompDesc, { color: theme.colors.muted }]}>
                  Browse local gigs, submit proposals, showcase your portfolio, and receive milestone payments.
                </Text>
              </Card>

              <Card
                tone={currentMode === 'hire' ? 'tinted-primary' : 'raised'}
                padding="md"
                style={styles.roleCompCard}
              >
                <View style={styles.roleCompHeader}>
                  <Text style={[styles.roleCompTitle, { color: theme.colors.text }]}>
                    Client Mode
                  </Text>
                  <Text
                    style={[
                      styles.roleCompStatus,
                      {
                        color:
                          currentMode === 'hire' ? theme.colors.primary : theme.colors.muted,
                      },
                    ]}
                  >
                    {currentMode === 'hire' ? 'ACTIVE' : 'SWITCH TARGET'}
                  </Text>
                </View>
                <Text style={[styles.roleCompDesc, { color: theme.colors.muted }]}>
                  Post job opportunities, review Ormoc talent, negotiate agreements, and approve deliverables.
                </Text>
              </Card>
            </View>

            {/* 7-Day Cooldown Notice */}
            <AlertBox
              tone="info"
              title="7-Day Cooldown Policy"
              message="Per Ormoc freelance safety rules, switching your mode has a mandatory 7-day cooldown to prevent market abuse and maintain identity accountability."
            />

            {/* Eligibility & Blockers */}
            {status && !status.can_switch && (
              <AlertBox
                tone="danger"
                title="Cannot Switch Mode Right Now"
                message={[
                  status.cooldown_remaining_days > 0
                    ? `• Cooldown active: ${status.cooldown_remaining_days} day(s) remaining before you can switch again.`
                    : null,
                  ...status.blockers.map((b) => `• ${b}`),
                ]
                  .filter(Boolean)
                  .join('\n')}
                action={
                  <Button
                    title="Go to Activity →"
                    variant="secondary"
                    size="xs"
                    fullWidth={false}
                    onPress={() => router.push('/(tabs)/activity')}
                  />
                }
              />
            )}

            {error && (
              <AlertBox
                tone="danger"
                message={error}
                action={
                  <Button
                    title={strings.common.retry}
                    variant="ghost"
                    size="xs"
                    fullWidth={false}
                    onPress={fetchStatus}
                  />
                }
              />
            )}

            {/* Switch Action */}
            <View style={styles.actionContainer}>
              <Button
                title={switching ? 'Switching...' : `Switch to ${targetLabel}`}
                variant="danger"
                icon="swap-horizontal-outline"
                onPress={handleSwitchMode}
                disabled={!status?.can_switch || switching}
                loading={switching}
              />
              {status?.can_switch && (
                <Text style={[styles.actionDisclaimer, { color: theme.colors.muted }]}>
                  Switching will withdraw active proposals or cancel open gigs automatically.
                </Text>
              )}
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  scrollContent: {
    padding: 16,
  },
  innerWrap: {
    maxWidth: 680,
    width: '100%',
    alignSelf: 'center',
    gap: 16,
  },
  cardGap: {
    gap: 8,
  },
  comparisonRow: {
    gap: 12,
  },
  comparisonRowWide: {
    flexDirection: 'row',
  },
  roleCompCard: {
    flex: 1,
    gap: 6,
  },
  roleCompHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  roleCompTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  roleCompStatus: {
    fontSize: 11,
    fontWeight: '800',
  },
  roleCompDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  modeTitle: {
    fontSize: 22,
    fontWeight: '700',
  },
  modeDescription: {
    fontSize: 14,
    lineHeight: 20,
  },
  actionContainer: {
    marginTop: 8,
    gap: 10,
  },
  actionDisclaimer: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
  },
});
