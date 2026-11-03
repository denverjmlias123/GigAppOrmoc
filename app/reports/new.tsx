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
import { useAppTheme, useResponsiveLayout } from '../theme';
import {
  reportsService,
  ReportTargetType,
  ReportReasonCategory,
} from '../../services/reports';
import { Button } from '../../components/ui/Button';
import { Card, AlertBox, PageHeaderBox } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { TextInput } from '../../components/ui/TextInput';
import { showToast } from '../../components/ui/Toast';
import { strings } from '../../constants/strings';

const REASON_CATEGORIES: { label: string; value: ReportReasonCategory }[] = [
  { label: 'Spam or Scam', value: 'spam_scam' },
  { label: 'Harassment / Abusive Behavior', value: 'harassment' },
  { label: 'Unresponsive or Abandoned', value: 'unresponsive' },
  { label: 'Payment Problem', value: 'payment_issue' },
  { label: 'Work Quality Issue', value: 'work_quality' },
  { label: 'Cancellation Request', value: 'cancellation_request' },
  { label: 'Other Concern', value: 'other' },
];

export default function NewReportScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { insets } = useResponsiveLayout();
  const { targetType, targetId, targetTitle } = useLocalSearchParams<{
    targetType: ReportTargetType;
    targetId: string;
    targetTitle: string;
  }>();

  const [category, setCategory] = useState<ReportReasonCategory>('other');
  const [details, setDetails] = useState('');
  const [evidencePath, setEvidencePath] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = React.useRef(false);

  const safeNavigateBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  };

  const handleSubmit = async () => {
    if (!targetId || !targetType || inFlightRef.current || submitting || submitted) return;
    if (details.trim().length < 10) {
      setError('Please describe the issue in detail (at least 10 characters) to help the moderation team investigate.');
      showToast('Please describe the issue in detail (at least 10 characters).', 'error');
      return;
    }

    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await reportsService.submitReport({
        targetType,
        targetId,
        reasonCategory: category,
        details: details.trim(),
        evidencePath: evidencePath.trim() || undefined,
      });
      setSubmitted(true);
      showToast(strings.toasts.reportSubmitted);
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(tabs)');
      }
    } catch (err: any) {
      const msg = err?.message || 'Failed to submit report.';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  };

  if (!targetId || !targetType) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <PageHeaderBox
          title="Submit a Report"
          subtitle="Invalid report target"
          onBack={safeNavigateBack}
          maxWidth={680}
        />
        <View style={[styles.centeredBlock, { padding: 16 }]}>
          <AlertBox
            tone="danger"
            title="Missing Target"
            message="No valid target was provided to report. Please return to the previous screen and try again."
            action={
              <Button
                title="Go Back"
                variant="secondary"
                size="sm"
                fullWidth={false}
                onPress={safeNavigateBack}
              />
            }
          />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <PageHeaderBox
        title="Submit a Report"
        subtitle="Flag an issue for moderation review"
        onBack={safeNavigateBack}
        maxWidth={680}
      />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom + 32, 40) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.centeredBlock, { gap: 16 }]}>
          {/* Target Header */}
          <Card tone="raised" padding="md" style={styles.cardGap}>
            <Text style={[styles.label, { color: theme.colors.muted }]}>Reporting Target</Text>
            <Text style={[styles.title, { color: theme.colors.text }]}>
              {targetTitle || `${targetType?.toUpperCase()} (${targetId?.slice(0, 8)})`}
            </Text>
          </Card>

          {error && <AlertBox tone="danger" message={error} />}

          {/* Reason Category */}
          <Card tone="raised" padding="md" style={styles.cardGap}>
            <Text style={[styles.label, { color: theme.colors.text }]}>Reason Category *</Text>
            <View style={styles.categoryGrid}>
              {REASON_CATEGORIES.map((c) => {
                const isSelected = category === c.value;
                return (
                  <Chip
                    key={c.value}
                    label={c.label}
                    selected={isSelected}
                    tone="danger"
                    onPress={() => setCategory(c.value)}
                  />
                );
              })}
            </View>
          </Card>

          {/* Details Textarea */}
          <Card tone="raised" padding="md" style={styles.cardGap}>
            <TextInput
              label="Explanation & Evidence *"
              placeholder="Explain what happened, what went wrong, and any relevant dates or communication context..."
              multiline
              numberOfLines={5}
              value={details}
              onChangeText={setDetails}
              maxLength={2000}
              helperText={`${details.length}/2000 characters (min 10)`}
              containerStyle={{ marginBottom: 0 }}
            />
          </Card>

          {/* Evidence Link */}
          <Card tone="raised" padding="md" style={styles.cardGap}>
            <TextInput
              label="Evidence Link / Storage Path (Optional)"
              placeholder="e.g. Screenshot link, cloud folder URL, or chat reference"
              value={evidencePath}
              onChangeText={setEvidencePath}
              containerStyle={{ marginBottom: 0 }}
            />
          </Card>

          {/* Submit */}
          <View style={styles.submitContainer}>
            <Button
              title={submitting ? 'Submitting Report...' : 'Submit Report for Moderation'}
              variant="danger"
              icon="flag-outline"
              onPress={handleSubmit}
              disabled={details.trim().length < 10 || submitting}
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
  cardGap: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  submitContainer: {
    marginTop: 8,
  },
});
