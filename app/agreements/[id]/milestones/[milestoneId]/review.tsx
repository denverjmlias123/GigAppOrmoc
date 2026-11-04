import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Linking,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAppTheme, useResponsiveLayout } from '../../../../theme';
import { milestonesService, SubmissionItem } from '../../../../../services/milestones';
import { Button } from '../../../../../components/ui/Button';
import { Card, AlertBox, PageHeaderBox } from '../../../../../components/ui/Card';
import { TextInput } from '../../../../../components/ui/TextInput';
import { showToast } from '../../../../../components/ui/Toast';
import { confirmDialog } from '../../../../../lib/dialog';
import { mapSqlErrorToFriendlyMessage, strings } from '../../../../../constants/strings';

export default function ReviewMilestoneScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { insets } = useResponsiveLayout();
  const { id, milestoneId, title, revisionCount } = useLocalSearchParams<{
    id: string;
    milestoneId: string;
    title: string;
    revisionCount: string;
  }>();

  const [revisionsUsed, setRevisionsUsed] = useState<number>(
    parseInt(revisionCount || '0', 10)
  );
  const revisionsLeft = Math.max(0, 2 - revisionsUsed);

  const [submissions, setSubmissions] = useState<SubmissionItem[]>([]);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionDone, setActionDone] = useState(false);
  const [revisionFeedback, setRevisionFeedback] = useState('');
  const [showRevisionInput, setShowRevisionInput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = React.useRef(false);

  const safeNavigateBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else if (id) {
      router.replace({ pathname: '/agreements/[id]', params: { id } });
    } else {
      router.replace('/(tabs)/activity');
    }
  };

  const navigateAfterSuccess = () => {
    if (id) {
      router.replace({ pathname: '/agreements/[id]', params: { id } });
    } else {
      router.replace('/(tabs)/activity');
    }
  };

  useEffect(() => {
    if (!milestoneId) return;
    const fetchSubmissions = async () => {
      setLoading(true);
      setError(null);
      try {
        const [data, agreementMilestones] = await Promise.all([
          milestonesService.getMilestoneSubmissions(milestoneId),
          id ? milestonesService.getAgreementMilestones(id).catch(() => []) : Promise.resolve([]),
        ]);
        setSubmissions(data);

        const currentMilestone = agreementMilestones.find((m) => m.id === milestoneId);
        if (currentMilestone) {
          setRevisionsUsed(currentMilestone.revision_count);
        }

        // Resolve signed URLs fault-tolerantly for private 'submissions' bucket paths
        const allPaths = Array.from(
          new Set(data.flatMap((s) => s.file_paths || []).filter(Boolean))
        );
        const settled = await Promise.allSettled(
          allPaths.map(async (p) => {
            const url = await milestonesService.createSignedUrl(p);
            return [p, url || p] as const;
          })
        );
        const resolvedMap: Record<string, string> = {};
        for (const res of settled) {
          if (res.status === 'fulfilled') {
            resolvedMap[res.value[0]] = res.value[1];
          }
        }
        setSignedUrls(resolvedMap);
      } catch (err: any) {
        setError(mapSqlErrorToFriendlyMessage(err, 'Failed to load milestone submissions.'));
      } finally {
        setLoading(false);
      }
    };

    fetchSubmissions();
  }, [milestoneId, id]);

  const handleOpenAttachment = async (filePath: string) => {
    try {
      const resolved = signedUrls[filePath] || (await milestonesService.createSignedUrl(filePath));
      const targetUrl = resolved || filePath;
      if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) {
        await Linking.openURL(targetUrl);
      } else {
        showToast('Attachment Path: ' + targetUrl, 'info');
      }
    } catch {
      showToast('Could not open this deliverable attachment.', 'error');
    }
  };

  const handleApprove = async () => {
    if (!milestoneId || inFlightRef.current || actionBusy || actionDone) return;

    const confirmed = await confirmDialog({
      title: 'Approve Milestone',
      message:
        'Are you sure you want to approve this milestone deliverable? Once approved, the milestone is marked complete.',
      confirmText: 'Approve Deliverable',
      cancelText: 'Cancel',
    });

    if (!confirmed) return;

    inFlightRef.current = true;
    setActionBusy(true);
    setError(null);
    try {
      await milestonesService.reviewMilestone(milestoneId, 'approve');
      setActionDone(true);
      showToast(strings.toasts.milestoneApproved);
      navigateAfterSuccess();
    } catch (err: any) {
      const friendlyMsg = mapSqlErrorToFriendlyMessage(err, 'Could not approve milestone.');
      setError(friendlyMsg);
      showToast(friendlyMsg, 'error');
    } finally {
      inFlightRef.current = false;
      setActionBusy(false);
    }
  };

  const handleRequestRevision = async () => {
    if (!milestoneId || inFlightRef.current || actionBusy || actionDone) return;
    if (revisionFeedback.trim().length < 5) {
      setError('Please provide clear feedback explaining what changes are required (at least 5 characters).');
      showToast('Please provide clear feedback explaining what changes are required.', 'error');
      return;
    }

    inFlightRef.current = true;
    setActionBusy(true);
    setError(null);
    try {
      await milestonesService.reviewMilestone(
        milestoneId,
        'request_revision',
        revisionFeedback.trim()
      );
      setActionDone(true);
      showToast(strings.toasts.revisionRequested);
      navigateAfterSuccess();
    } catch (err: any) {
      const friendlyMsg = mapSqlErrorToFriendlyMessage(err, 'Could not request revision.');
      setError(friendlyMsg);
      showToast(friendlyMsg, 'error');
    } finally {
      inFlightRef.current = false;
      setActionBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <PageHeaderBox
        title="Review Deliverable"
        subtitle={title || 'Milestone'}
        onBack={safeNavigateBack}
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
            { paddingBottom: Math.max(insets.bottom + 32, 40) },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.centeredBlock, { gap: 16 }]}>
            {/* Header */}
            <Card
              tone="outline"
              padding="md"
              accentPosition="left"
              accentColor={theme.colors.primary}
            >
              <Text style={[styles.label, { color: theme.colors.muted }]}>Milestone</Text>
              <Text style={[styles.title, { color: theme.colors.text }]}>{title || 'Deliverable'}</Text>
              <Text style={[styles.meta, { color: theme.colors.muted }]}>
                Revisions used: {revisionsUsed}/2 ({revisionsLeft} remaining)
              </Text>
            </Card>

            {error && (
              <AlertBox tone="danger" message={error} />
            )}

            {/* Submissions History */}
            <Text style={[styles.sectionHeading, { color: theme.colors.text }]}>
              Submission History ({submissions.length})
            </Text>

            {submissions.length === 0 ? (
              <Card tone="inset" padding="md">
                <Text style={[styles.noSubmissionsText, { color: theme.colors.muted }]}>
                  No submissions recorded yet for this milestone.
                </Text>
              </Card>
            ) : (
              submissions.map((sub) => (
                <Card
                  key={sub.id}
                  tone="raised"
                  padding="md"
                  style={{ gap: 8 }}
                >
                  <View style={styles.submissionHeader}>
                    <Text style={[styles.submissionBadge, { color: theme.colors.primary }]}>
                      Submission #{sub.submission_number}
                    </Text>
                    <Text style={[styles.dateText, { color: theme.colors.muted }]}>
                      {sub.created_at
                        ? (() => {
                            const d = new Date(sub.created_at);
                            return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
                          })()
                        : ''}
                    </Text>
                  </View>

                  <Text style={[styles.submissionMessage, { color: theme.colors.text }]}>
                    {sub.message}
                  </Text>

                  {sub.file_paths && sub.file_paths.length > 0 && (
                    <View style={styles.filesSection}>
                      <Text style={[styles.fileSectionTitle, { color: theme.colors.muted }]}>
                        Deliverables / Attachments (Tap to open signed URL):
                      </Text>
                      {sub.file_paths.map((f, fIdx) => (
                        <Button
                          key={fIdx}
                          title={f.split('/').pop() || f}
                          icon="attach-outline"
                          variant="soft"
                          size="sm"
                          onPress={() => handleOpenAttachment(f)}
                        />
                      ))}
                    </View>
                  )}
                </Card>
              ))
            )}

            {/* Actions */}
            <View style={styles.actionsContainer}>
              <Button
                title="Approve Milestone Deliverable"
                icon="checkmark-circle-outline"
                variant="success"
                onPress={handleApprove}
                disabled={actionBusy}
                loading={actionBusy}
              />

              {revisionsLeft > 0 ? (
                !showRevisionInput ? (
                  <Button
                    title={`Request Revision (${revisionsLeft} remaining)`}
                    icon="refresh-outline"
                    variant="secondary"
                    onPress={() => setShowRevisionInput(true)}
                    disabled={actionBusy}
                  />
                ) : (
                  <Card
                    tone="neo-glass"
                    padding="md"
                    headerTitle="Revision Instructions *"
                    headerSubtitle="Specify exact revisions needed for this deliverable"
                    headerIcon="create-outline"
                    style={{ gap: 10 }}
                  >
                    <TextInput
                      placeholder="Specify exact revisions needed..."
                      multiline
                      numberOfLines={4}
                      value={revisionFeedback}
                      onChangeText={setRevisionFeedback}
                      maxLength={1000}
                      showCharCount
                      style={{ minHeight: 80 }}
                      containerStyle={{ marginBottom: 0 }}
                    />
                    <View style={styles.revisionActionsRow}>
                      <Button
                        title="Send Revision Request"
                        variant="danger"
                        onPress={handleRequestRevision}
                        disabled={revisionFeedback.trim().length < 5 || actionBusy}
                        loading={actionBusy}
                      />
                      <Button
                        title="Cancel"
                        variant="ghost"
                        size="sm"
                        onPress={() => setShowRevisionInput(false)}
                      />
                    </View>
                  </Card>
                )
              ) : (
                <AlertBox
                  tone="warning"
                  message="Maximum revisions (2/2) have been used. You must either approve the deliverable or contact support for dispute resolution."
                />
              )}
            </View>
          </View>
        </ScrollView>
      )}
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
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  scrollContent: {
    padding: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 2,
  },
  meta: {
    fontSize: 13,
    marginTop: 4,
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 8,
  },
  noSubmissionsText: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 12,
  },
  submissionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  submissionBadge: {
    fontSize: 14,
    fontWeight: '700',
  },
  dateText: {
    fontSize: 12,
  },
  submissionMessage: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  filesSection: {
    marginTop: 8,
    gap: 6,
  },
  fileSectionTitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  actionsContainer: {
    marginTop: 8,
    gap: 12,
  },
  revisionActionsRow: {
    gap: 8,
  },
});
