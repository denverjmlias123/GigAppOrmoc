import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useAppTheme, useResponsiveLayout } from '../../../theme';
import { milestonesService, DefineMilestoneParam } from '../../../../services/milestones';
import { notificationsService } from '../../../../services/notifications';
import { useAuth } from '../../../../hooks/useAuth';
import { formatPrice } from '../../../../components/ui/GigCard';
import { Button } from '../../../../components/ui/Button';
import { Card, AlertBox, PageHeaderBox } from '../../../../components/ui/Card';
import { TextInput } from '../../../../components/ui/TextInput';
import { showToast } from '../../../../components/ui/Toast';
import { mapSqlErrorToFriendlyMessage, strings } from '../../../../constants/strings';

interface MilestoneDraft {
  title: string;
  description: string;
  amountStr: string;
}

export default function SetupMilestonesScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { user } = useAuth();
  const { isWide, insets } = useResponsiveLayout();
  const { id, agreedPrice } = useLocalSearchParams<{ id: string; agreedPrice: string }>();

  const targetPriceCentavos = parseInt(agreedPrice || '0', 10);

  const safeNavigateBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else if (id) {
      router.replace({ pathname: '/agreements/[id]', params: { id } });
    } else {
      router.replace('/(tabs)/activity');
    }
  };

  const [milestones, setMilestones] = useState<MilestoneDraft[]>([
    {
      title: 'Milestone 1: Project Deliverable',
      description: '',
      amountStr: targetPriceCentavos > 0 ? (targetPriceCentavos / 100).toString() : '',
    },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = React.useRef(false);
  const hasEditedRef = React.useRef(false);

  useEffect(() => {
    if (!id) return;
    let active = true;
    milestonesService
      .getAgreementMilestones(id)
      .then((existing) => {
        if (!active) return;
        if (existing && existing.length > 0) {
          const locked = existing.some((m) => m.status !== 'pending');
          if (locked) {
            setIsLocked(true);
          }
          if (!hasEditedRef.current) {
            setMilestones(
              existing.map((m) => ({
                title: m.title,
                description: m.description || '',
                amountStr: (m.amount / 100).toString(),
              }))
            );
          }
        }
      })
      .catch(() => {
        // non-blocking fallback to default draft
      });
    return () => {
      active = false;
    };
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      if (!user?.id || !id) return;
      return notificationsService.subscribeToNotifications(user.id, (notification) => {
        if (notification.entity_id === id || notification.data?.agreement_id === id) {
          milestonesService
            .getAgreementMilestones(id)
            .then((latest) => {
              if (latest.some((m) => m.status !== 'pending')) {
                setIsLocked(true);
                showToast('Work was just submitted. Milestones are now locked.', 'info');
              }
            })
            .catch(() => {});
        }
      });
    }, [id, user?.id])
  );

  const navigateAfterSuccess = () => {
    if (id) {
      router.replace({ pathname: '/agreements/[id]', params: { id } });
    } else {
      router.replace('/(tabs)/activity');
    }
  };

  // Calculate current sum in centavos
  const currentTotalCentavos = milestones.reduce((sum, m) => {
    const val = parseFloat(m.amountStr || '0');
    return isNaN(val) ? sum : sum + Math.round(val * 100);
  }, 0);

  const differenceCentavos = targetPriceCentavos - currentTotalCentavos;
  const isSumValid = differenceCentavos === 0 && currentTotalCentavos > 0;

  const handleAddMilestone = () => {
    if (submitted || isLocked) return;
    hasEditedRef.current = true;
    if (milestones.length >= 5) {
      showToast('An agreement can have at most 5 milestones.', 'info');
      return;
    }
    setMilestones([
      ...milestones,
      {
        title: `Milestone ${milestones.length + 1}`,
        description: '',
        amountStr: '',
      },
    ]);
  };

  const handleRemoveMilestone = (index: number) => {
    if (submitted || isLocked) return;
    hasEditedRef.current = true;
    if (milestones.length <= 1) {
      showToast('You must have at least 1 milestone.', 'info');
      return;
    }
    const updated = milestones.filter((_, idx) => idx !== index);
    setMilestones(updated);
  };

  const handleUpdate = (index: number, field: keyof MilestoneDraft, value: string) => {
    if (submitted || isLocked) return;
    hasEditedRef.current = true;
    const updated = [...milestones];
    updated[index][field] = value;
    setMilestones(updated);
  };

  const handleSubmit = async () => {
    if (!id || inFlightRef.current || submitting || submitted || isLocked) return;
    setError(null);

    // Validate fields
    for (let i = 0; i < milestones.length; i++) {
      const m = milestones[i];
      if (!m.title.trim() || m.title.trim().length < 3) {
        setError(`Milestone ${i + 1} title must be at least 3 characters.`);
        showToast(`Milestone ${i + 1} title must be at least 3 characters.`, 'error');
        return;
      }
      const amt = parseFloat(m.amountStr);
      if (isNaN(amt) || amt <= 0) {
        setError(`Milestone ${i + 1} must have a valid positive amount.`);
        showToast(`Milestone ${i + 1} must have a valid positive amount.`, 'error');
        return;
      }
    }

    if (!isSumValid) {
      const msg = `The sum of all milestones (${formatPrice(currentTotalCentavos)}) must exactly equal the agreed total price (${formatPrice(targetPriceCentavos)}).`;
      setError(msg);
      showToast(msg, 'error');
      return;
    }

    inFlightRef.current = true;
    setSubmitting(true);
    try {
      const payload: DefineMilestoneParam[] = milestones.map((m) => ({
        title: m.title.trim(),
        description: m.description.trim(),
        amount: Math.round(parseFloat(m.amountStr) * 100),
      }));

      await milestonesService.defineMilestones(id, payload);
      setSubmitted(true);
      showToast(strings.toasts.milestonesSaved);
      navigateAfterSuccess();
    } catch (err: any) {
      const isLockedError =
        typeof err?.message === 'string' &&
        err.message.includes('Cannot redefine milestones after work has been submitted or approved');

      if (isLockedError) {
        setIsLocked(true);
        milestonesService
          .getAgreementMilestones(id)
          .then((latest) => {
            if (latest.length > 0) {
              setMilestones(
                latest.map((m) => ({
                  title: m.title,
                  description: m.description || '',
                  amountStr: (m.amount / 100).toString(),
                }))
              );
            }
          })
          .catch(() => {});
        setError('Work has commenced or was submitted by the freelancer. Milestones are now locked.');
        showToast('Milestones locked: work was already submitted.', 'error');
      } else {
        const friendlyMsg = mapSqlErrorToFriendlyMessage(err, 'Failed to define milestones.');
        setError(friendlyMsg);
        showToast(friendlyMsg, 'error');
      }
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <PageHeaderBox
        title="Define Milestones"
        subtitle="Break down deliverables totaling the agreed contract price"
        onBack={safeNavigateBack}
        maxWidth={720}
      />

      {/* Sticky Budget Match Tracker */}
      <View
        style={[
          styles.stickyTrackerWrapper,
          {
            backgroundColor: theme.colors.surface,
            borderBottomColor: theme.colors.border,
          },
        ]}
      >
        <View
          style={[
            styles.trackerCard,
            styles.centeredBlock,
            {
              backgroundColor: isSumValid ? theme.colors.successSoft : theme.colors.warningSoft,
              borderColor: isSumValid ? theme.colors.success : theme.colors.warning,
            },
          ]}
        >
          <View style={styles.trackerRow}>
            <Text style={[styles.trackerLabel, { color: theme.colors.text }]}>Agreed Total:</Text>
            <Text style={[styles.trackerValue, { color: theme.colors.text }]}>{formatPrice(targetPriceCentavos)}</Text>
          </View>
          <View style={styles.trackerRow}>
            <Text style={[styles.trackerLabel, { color: theme.colors.text }]}>Milestones Sum:</Text>
            <Text
              style={[
                styles.trackerValue,
                { color: isSumValid ? theme.colors.successText : theme.colors.warningText },
              ]}
            >
              {formatPrice(currentTotalCentavos)}
            </Text>
          </View>
          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
          <Text
            style={[
              styles.trackerStatus,
              { color: isSumValid ? theme.colors.successText : theme.colors.warningText },
            ]}
          >
            {isSumValid
              ? '✓ Total matches agreed price'
              : differenceCentavos > 0
              ? `₱${(differenceCentavos / 100).toLocaleString()} remaining to allocate`
              : `₱${(Math.abs(differenceCentavos) / 100).toLocaleString()} over agreed total`}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom + 32, 40) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.centeredBlock, { gap: 16 }]}>
          {isLocked && (
            <AlertBox
              tone="warning"
              title="Milestones Locked"
              message="Milestones cannot be modified after deliverable work has been submitted or approved. Contact your collaborator or Ormoc support if adjustments are required."
            />
          )}

          {error && (
            <AlertBox tone="danger" message={error} />
          )}

          {/* Milestone Rows */}
          {milestones.map((m, idx) => (
            <Card
              key={idx}
              tone="raised"
              padding="md"
              headerTitle={`Milestone #${idx + 1}`}
              headerIcon="flag-outline"
              headerRight={
                milestones.length > 1 && !isLocked ? (
                  <Button
                    title="Remove"
                    variant="danger-soft"
                    size="xs"
                    fullWidth={false}
                    icon="trash-outline"
                    onPress={() => handleRemoveMilestone(idx)}
                  />
                ) : undefined
              }
            >
              <View style={isWide ? styles.twoColRow : styles.stackCol}>
                <View style={isWide ? { flex: 1.6 } : undefined}>
                  <TextInput
                    label="Title *"
                    placeholder="e.g. Design Wireframes, Backend Integration"
                    value={m.title}
                    onChangeText={(val) => handleUpdate(idx, 'title', val)}
                    maxLength={120}
                    editable={!isLocked}
                  />
                </View>

                <View style={isWide ? { flex: 1 } : undefined}>
                  <TextInput
                    label="Amount (PHP ₱) *"
                    prefixText="₱"
                    placeholder="0.00"
                    keyboardType="numeric"
                    value={m.amountStr}
                    onChangeText={(val) => handleUpdate(idx, 'amountStr', val)}
                    editable={!isLocked}
                  />
                </View>
              </View>

              <TextInput
                label="Deliverables Description"
                placeholder="Describe what must be delivered for this milestone to be approved..."
                multiline
                numberOfLines={3}
                value={m.description}
                onChangeText={(val) => handleUpdate(idx, 'description', val)}
                maxLength={1000}
                style={{ minHeight: 70 }}
                containerStyle={{ marginBottom: 0 }}
                editable={!isLocked}
              />
            </Card>
          ))}

          {/* Add Milestone Button */}
          {milestones.length < 5 && !isLocked && (
            <Button
              title={`Add Another Milestone (${milestones.length}/5)`}
              variant="secondary"
              icon="add-circle-outline"
              onPress={handleAddMilestone}
            />
          )}

          {/* Submit */}
          <View style={styles.submitContainer}>
            <Button
              title={submitting ? 'Saving Milestones...' : isLocked ? 'Milestones Locked' : 'Save & Initialize Milestones'}
              variant="primary"
              icon="checkmark-done-outline"
              onPress={handleSubmit}
              disabled={!isSumValid || submitting || isLocked}
              loading={submitting}
            />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centeredBlock: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
  },
  stickyTrackerWrapper: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  scrollContent: {
    padding: 16,
  },
  trackerCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  trackerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  trackerLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  trackerValue: {
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  divider: {
    height: 1,
    marginVertical: 2,
  },
  trackerStatus: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  twoColRow: {
    flexDirection: 'row',
    gap: 12,
  },
  stackCol: {
    gap: 0,
  },
  submitContainer: {
    marginTop: 8,
  },
});
