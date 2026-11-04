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
import { paymentsService } from '../../../../../services/payments';
import { formatPrice } from '../../../../../components/ui/GigCard';
import { Button } from '../../../../../components/ui/Button';
import { Card, AlertBox, PageHeaderBox } from '../../../../../components/ui/Card';
import { TextInput } from '../../../../../components/ui/TextInput';
import { showToast } from '../../../../../components/ui/Toast';
import { mapSqlErrorToFriendlyMessage, strings } from '../../../../../constants/strings';

export default function DisputePaymentScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { insets } = useResponsiveLayout();
  const { id, paymentId, amount, method } = useLocalSearchParams<{
    id: string;
    paymentId: string;
    amount: string;
    method: string;
  }>();

  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = React.useRef(false);

  const [displayAmount, setDisplayAmount] = useState(parseInt(amount || '0', 10));
  const [displayMethod, setDisplayMethod] = useState(method || 'External Transfer');

  React.useEffect(() => {
    if (!id || !paymentId || displayAmount > 0) return;
    let active = true;
    paymentsService
      .getAgreementPayments(id)
      .then((allPayments) => {
        if (!active) return;
        const found = allPayments.find((p) => p.id === paymentId);
        if (found) {
          setDisplayAmount(found.amount);
          setDisplayMethod(String(found.payment_method || 'direct').toUpperCase());
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [id, paymentId, displayAmount]);

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

  const handleSubmit = async () => {
    if (!paymentId || inFlightRef.current || submitting || submitted) return;
    if (reason.trim().length < 5) {
      setError('Please clearly describe why you are disputing this payment report (at least 5 characters).');
      showToast('Please clearly describe why you are disputing this payment report.', 'error');
      return;
    }

    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await paymentsService.disputePayment(paymentId, reason.trim());
      setSubmitted(true);
      showToast(strings.toasts.paymentDisputed);
      navigateAfterSuccess();
    } catch (err: any) {
      const friendlyMsg = mapSqlErrorToFriendlyMessage(err, 'Could not record payment dispute.');
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
        title="Dispute Payment"
        subtitle="Report discrepancy on recorded payment"
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
          {/* Payment Summary */}
          <Card tone="raised" padding="md" style={styles.cardGap}>
            <Text style={[styles.label, { color: theme.colors.muted }]}>Reported Payment</Text>
            <Text style={[styles.amountText, { color: theme.colors.text }]}>
              {formatPrice(displayAmount)}
            </Text>
            <Text style={[styles.metaText, { color: theme.colors.muted }]}>
              Channel: {displayMethod}
            </Text>
          </Card>

          {error && <AlertBox tone="danger" message={error} />}

          {/* Dispute Reason */}
          <Card tone="raised" padding="md" style={styles.cardGap}>
            <TextInput
              label="Reason for Dispute *"
              placeholder="Explain why this payment could not be confirmed (e.g. transfer did not reflect in bank account, amount differs from invoice)..."
              multiline
              numberOfLines={5}
              value={reason}
              onChangeText={setReason}
              maxLength={1000}
              helperText={`${reason.length}/1000 characters (min 5)`}
              containerStyle={{ marginBottom: 0 }}
            />
          </Card>

          {/* Action */}
          <View style={styles.submitContainer}>
            <Button
              title={submitting ? 'Recording Dispute...' : 'Submit Payment Dispute'}
              variant="danger"
              icon="warning-outline"
              onPress={handleSubmit}
              disabled={reason.trim().length < 5 || submitting}
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
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  amountText: {
    fontSize: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  metaText: {
    fontSize: 14,
  },
  submitContainer: {
    marginTop: 8,
  },
});
