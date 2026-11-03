import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAppTheme, useResponsiveLayout } from '../../../../theme';
import { milestonesService } from '../../../../../services/milestones';
import { Button, IconButton } from '../../../../../components/ui/Button';
import { Card, AlertBox, PageHeaderBox } from '../../../../../components/ui/Card';
import { TextInput } from '../../../../../components/ui/TextInput';
import { showToast } from '../../../../../components/ui/Toast';
import { mapSqlErrorToFriendlyMessage, strings } from '../../../../../constants/strings';

export default function SubmitMilestoneScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { insets } = useResponsiveLayout();
  const { id, milestoneId, title, revisionCount, revisionFeedback } = useLocalSearchParams<{
    id: string;
    milestoneId: string;
    title: string;
    revisionCount: string;
    revisionFeedback?: string;
  }>();

  const revCount = parseInt(revisionCount || '0', 10);

  const [message, setMessage] = useState('');
  const [fileUrlInput, setFileUrlInput] = useState('');
  const [filePaths, setFilePaths] = useState<string[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
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

  const handleAddFile = () => {
    if (!fileUrlInput.trim() || submitted) return;
    setFilePaths([...filePaths, fileUrlInput.trim()]);
    setFileUrlInput('');
  };

  const handleUploadFromDevice = async () => {
    if (!id || !milestoneId || uploadingFile || submitted) return;
    setUploadingFile(true);
    setError(null);
    try {
      const storagePath = await milestonesService.pickAndUploadSubmissionFile(id, milestoneId);
      if (storagePath) {
        setFilePaths((prev) => [...prev, storagePath]);
      }
    } catch (err: any) {
      setError(mapSqlErrorToFriendlyMessage(err, 'Could not upload deliverable file.'));
    } finally {
      setUploadingFile(false);
    }
  };

  const handleRemoveFile = (index: number) => {
    if (submitted) return;
    setFilePaths(filePaths.filter((_, idx) => idx !== index));
  };

  const handleSubmit = async () => {
    if (!milestoneId || inFlightRef.current || submitting || submitted) return;
    if (message.trim().length < 10) {
      setError('Please provide a clear description of your submitted work (at least 10 characters).');
      showToast('Please provide a clear description of your submitted work (at least 10 characters).', 'error');
      return;
    }

    const pendingLink = fileUrlInput.trim();
    const finalFilePaths =
      pendingLink && !filePaths.includes(pendingLink) ? [...filePaths, pendingLink] : filePaths;
    if (pendingLink) {
      setFilePaths(finalFilePaths);
      setFileUrlInput('');
    }

    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await milestonesService.submitMilestone(milestoneId, message.trim(), finalFilePaths);
      setSubmitted(true);
      showToast(strings.toasts.workSubmitted);
      navigateAfterSuccess();
    } catch (err: any) {
      const friendlyMsg = mapSqlErrorToFriendlyMessage(err, 'Failed to submit milestone work.');
      setError(friendlyMsg);
      showToast(friendlyMsg, 'error');
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
        title="Submit Work"
        subtitle={title || 'Deliverable'}
        onBack={safeNavigateBack}
        maxWidth={640}
      />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom + 32, 40) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.centeredBlock, { gap: 16 }]}>
          {/* Milestone Context */}
          <Card
            tone="outline"
            padding="md"
            accentPosition="left"
            accentColor={theme.colors.primary}
          >
            <Text style={[styles.label, { color: theme.colors.muted }]}>Milestone Deliverable</Text>
            <Text style={[styles.title, { color: theme.colors.text }]}>{title || 'Deliverable'}</Text>
            <Text style={[styles.meta, { color: theme.colors.muted }]}>
              Submission Attempt: #{revCount + 1} (Max 3 total submissions)
            </Text>
          </Card>

          {revisionFeedback ? (
            <AlertBox
              tone="warning"
              title="Client Revision Feedback"
              message={revisionFeedback}
            />
          ) : null}

          {error && (
            <AlertBox tone="danger" message={error} />
          )}

          {/* Message Input */}
          <Card
            tone="raised"
            padding="md"
            headerTitle="Submission Notes & Summary *"
            headerSubtitle="Describe the deliverables completed and summarize outcomes (min 10 chars)"
            headerIcon="document-text-outline"
          >
            <TextInput
              placeholder="Describe the deliverables completed, summarize outcomes, and provide access links..."
              multiline
              numberOfLines={5}
              value={message}
              onChangeText={setMessage}
              maxLength={2000}
              showCharCount
              style={{ minHeight: 100 }}
              containerStyle={{ marginBottom: 0 }}
            />
          </Card>

          {/* File / Deliverable Links & Private Bucket Upload */}
          <Card
            tone="raised"
            padding="md"
            headerTitle="Deliverable Links & Files"
            headerSubtitle="Upload a screenshot/file to secure private storage or add a shareable link"
            headerIcon="attach-outline"
            style={{ gap: 10 }}
          >
            <Button
              title={uploadingFile ? 'Uploading Attachment...' : 'Upload Deliverable File / Screenshot'}
              icon="cloud-upload-outline"
              variant="secondary"
              onPress={handleUploadFromDevice}
              disabled={uploadingFile || submitting}
              loading={uploadingFile}
            />

            <View style={styles.fileInputRow}>
              <View style={{ flex: 1 }}>
                <TextInput
                  placeholder="Or paste link: https://drive.google.com/..."
                  leftIcon="link-outline"
                  value={fileUrlInput}
                  onChangeText={setFileUrlInput}
                  containerStyle={{ marginBottom: 0 }}
                />
              </View>
              <Button
                title="Add Link"
                variant="primary"
                size="sm"
                fullWidth={false}
                onPress={handleAddFile}
                disabled={!fileUrlInput.trim()}
              />
            </View>

            {filePaths.length > 0 && (
              <View style={styles.filesList}>
                {filePaths.map((f, idx) => (
                  <Card key={idx} tone="inset" padding="sm" style={styles.fileItem}>
                    <Text style={[styles.filePathText, { color: theme.colors.text }]} numberOfLines={1}>
                      📎 {f}
                    </Text>
                    <IconButton
                      icon="close"
                      variant="danger-soft"
                      size="sm"
                      onPress={() => handleRemoveFile(idx)}
                      accessibilityLabel="Remove attachment"
                    />
                  </Card>
                ))}
              </View>
            )}
          </Card>

          {/* Submit Button */}
          <View style={styles.submitContainer}>
            <Button
              title={submitting ? 'Submitting Deliverable...' : 'Submit Deliverable for Client Review'}
              variant="primary"
              rightIcon="send"
              onPress={handleSubmit}
              disabled={message.trim().length < 10 || submitting || uploadingFile}
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
  scrollContent: {
    padding: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
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
  fileInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filesList: {
    gap: 6,
  },
  fileItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  filePathText: {
    fontSize: 13,
    flex: 1,
    marginRight: 8,
  },
  submitContainer: {
    marginTop: 8,
  },
});
