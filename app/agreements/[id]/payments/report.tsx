import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAppTheme, useResponsiveLayout } from '../../../theme';
import { paymentsService, PaymentMethod } from '../../../../services/payments';
import { milestonesService, MilestoneItem } from '../../../../services/milestones';
import { formatPrice } from '../../../../components/ui/GigCard';
import { Button } from '../../../../components/ui/Button';
import { Card, AlertBox, PageHeaderBox } from '../../../../components/ui/Card';
import { Chip } from '../../../../components/ui/Chip';
import { TextInput } from '../../../../components/ui/TextInput';
import { showToast } from '../../../../components/ui/Toast';
import { mapSqlErrorToFriendlyMessage, strings } from '../../../../constants/strings';

const PAYMENT_METHODS: { label: string; value: PaymentMethod }[] = [
  { label: 'GCash', value: 'gcash' },
  { label: 'Maya', value: 'maya' },
  { label: 'Bank Transfer', value: 'bank_transfer' },
  { label: 'Cash (In-person)', value: 'cash' },
  { label: 'Other', value: 'other' },
];

export default function ReportPaymentScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { insets } = useResponsiveLayout();
  const { id, agreedPrice, unpaidAmount } = useLocalSearchParams<{ id: string; agreedPrice?: string; unpaidAmount?: string }>();

  const [milestones, setMilestones] = useState<MilestoneItem[]>([]);
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('gcash');
  const initialAmount = unpaidAmount
    ? (parseInt(unpaidAmount, 10) / 100).toString()
    : agreedPrice
    ? (parseInt(agreedPrice, 10) / 100).toString()
    : '';
  const [amountStr, setAmountStr] = useState(initialAmount);
  const [referenceNumber, setReferenceNumber] = useState('');
  const [receiptPath, setReceiptPath] = useState('');
  const [notes, setNotes] = useState('');
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = React.useRef(false);

  useEffect(() => {
    if (!id) return;
    milestonesService.getAgreementMilestones(id).then(setMilestones).catch(() => {});
  }, [id]);

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

  const handleUploadReceipt = async (source: 'library' | 'camera' = 'library') => {
    if (!id || uploadingReceipt || submitted) return;
    setUploadingReceipt(true);
    setError(null);
    try {
      const uploadedPath = await paymentsService.pickAndUploadReceiptImage(id, source);
      if (uploadedPath) {
        setReceiptPath(uploadedPath);
      }
    } catch (err: any) {
      setError(mapSqlErrorToFriendlyMessage(err, 'Could not upload receipt image.'));
    } finally {
      setUploadingReceipt(false);
    }
  };

  const handleSubmit = async () => {
    if (!id || inFlightRef.current || submitting || submitted) return;
    const amountNum = parseFloat(amountStr);
    const amountCentavos = Math.round(amountNum * 100);
    if (isNaN(amountNum) || amountNum <= 0 || amountCentavos < 100) {
      setError('Please enter a valid payment amount of at least ₱1.00.');
      showToast('Please enter a valid payment amount of at least ₱1.00.', 'error');
      return;
    }

    if (selectedMethod !== 'cash' && !referenceNumber.trim()) {
      showToast('Tip: Entering a reference number helps the freelancer confirm quickly.', 'info');
    }

    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await paymentsService.reportPayment({
        agreementId: id,
        milestoneId: selectedMilestoneId || undefined,
        amount: amountCentavos,
        paymentMethod: selectedMethod,
        referenceNumber: referenceNumber.trim(),
        receiptPath: receiptPath.trim() || undefined,
        notes: notes.trim(),
      });
      setSubmitted(true);
      showToast(strings.toasts.paymentReported);
      navigateAfterSuccess();
    } catch (err: any) {
      const friendlyMsg = mapSqlErrorToFriendlyMessage(err, 'Failed to report payment.');
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
        title="Report Payment"
        subtitle="Record direct external payment details & receipt proof"
        onBack={safeNavigateBack}
        maxWidth={600}
      />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom + 32, 40) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.centeredBlock, { gap: 16 }]}>
          {/* Transparency Banner */}
          <AlertBox
            tone="warning"
            title="External Payment Notice"
            message="Gigormoc does not process, hold, or guarantee money. Send funds directly to the freelancer using your preferred channel, then report the payment details here for their confirmation."
          />

          {error && (
            <AlertBox tone="danger" message={error} />
          )}

          {/* Milestone Allocation (Optional) */}
          {milestones.length > 0 && (
            <Card
              tone="raised"
              padding="md"
              headerTitle="Apply to Milestone (Optional)"
              headerSubtitle="Link this payment to a specific project milestone"
              headerIcon="flag-outline"
            >
              <View style={styles.methodGrid}>
                <Chip
                  label="General / Unallocated"
                  selected={selectedMilestoneId === null}
                  onPress={() => {
                    setSelectedMilestoneId(null);
                    if (unpaidAmount) setAmountStr((parseInt(unpaidAmount, 10) / 100).toString());
                  }}
                />
                {milestones.map((ms) => {
                  const isSelected = selectedMilestoneId === ms.id;
                  return (
                    <Chip
                      key={ms.id}
                      label={`${ms.seq}. ${ms.title} (${formatPrice(ms.amount)})`}
                      selected={isSelected}
                      onPress={() => {
                        if (isSelected) {
                          setSelectedMilestoneId(null);
                        } else {
                          setSelectedMilestoneId(ms.id);
                          setAmountStr((ms.amount / 100).toString());
                        }
                      }}
                    />
                  );
                })}
              </View>
            </Card>
          )}

          {/* Method Picker */}
          <Card
            tone="raised"
            padding="md"
            headerTitle="Payment Channel *"
            headerSubtitle="Select how funds were sent"
            headerIcon="wallet-outline"
          >
            <View style={styles.methodGrid}>
              {PAYMENT_METHODS.map((m) => (
                <Chip
                  key={m.value}
                  label={m.label}
                  selected={selectedMethod === m.value}
                  onPress={() => setSelectedMethod(m.value)}
                />
              ))}
            </View>
          </Card>

          {/* Amount & Reference Number */}
          <Card
            tone="raised"
            padding="md"
            headerTitle="Payment Details"
            headerSubtitle="Enter the amount sent in PHP and transaction reference"
            headerIcon="cash-outline"
          >
            <TextInput
              label="Amount Paid (PHP ₱) *"
              prefixText="₱"
              placeholder="0.00"
              keyboardType="numeric"
              value={amountStr}
              onChangeText={setAmountStr}
            />

            <TextInput
              label="Reference / Transaction Number"
              leftIcon="receipt-outline"
              placeholder="e.g. 100982348571"
              value={referenceNumber}
              onChangeText={setReferenceNumber}
              maxLength={100}
              containerStyle={{ marginBottom: 0 }}
            />
          </Card>

          {/* Receipt / Proof Upload & Link */}
          <Card
            tone="raised"
            padding="md"
            headerTitle="Receipt Screenshot / Proof (Optional)"
            headerSubtitle="Attach a transfer screenshot or external receipt link"
            headerIcon="image-outline"
            style={{ gap: 10 }}
          >
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Button
                title={uploadingReceipt ? 'Uploading...' : 'Take Photo (Camera)'}
                icon="camera-outline"
                variant="secondary"
                size="sm"
                fullWidth={false}
                onPress={() => handleUploadReceipt('camera')}
                disabled={uploadingReceipt || submitting}
                loading={uploadingReceipt}
              />
              <Button
                title={uploadingReceipt ? 'Uploading...' : 'Choose from Photos'}
                icon="image-outline"
                variant="soft"
                size="sm"
                fullWidth={false}
                onPress={() => handleUploadReceipt('library')}
                disabled={uploadingReceipt || submitting}
              />
            </View>
            {receiptPath ? (
              <AlertBox
                tone="success"
                message={`Receipt Attached: ${receiptPath.split('/').pop() || receiptPath}`}
                actionLabel="Remove"
                onAction={() => setReceiptPath('')}
              />
            ) : null}
            <TextInput
              placeholder="Uploaded storage path or external receipt URL"
              leftIcon="link-outline"
              value={receiptPath}
              onChangeText={setReceiptPath}
              containerStyle={{ marginBottom: 0 }}
            />
          </Card>

          {/* Additional Notes */}
          <Card
            tone="neo-glass"
            padding="md"
            headerTitle="Notes (Optional)"
            headerIcon="chatbubble-outline"
          >
            <TextInput
              placeholder="Add any message or details for the freelancer..."
              multiline
              numberOfLines={3}
              value={notes}
              onChangeText={setNotes}
              maxLength={1000}
              style={{ minHeight: 70 }}
              containerStyle={{ marginBottom: 0 }}
            />
          </Card>

          {/* Submit Button */}
          <View style={styles.submitContainer}>
            <Button
              title={submitting ? 'Submitting Report...' : 'Record Payment Report'}
              variant="primary"
              icon="checkmark-circle-outline"
              onPress={handleSubmit}
              disabled={!amountStr || submitting || uploadingReceipt}
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
  methodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  submitContainer: {
    marginTop: 8,
  },
});
