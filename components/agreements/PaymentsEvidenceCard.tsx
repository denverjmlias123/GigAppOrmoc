import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAppTheme } from '../../app/theme';
import { PaymentItem } from '../../services/payments';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card, AlertBox } from '../ui/Card';
import { formatPrice } from '../ui/GigCard';

interface PaymentsEvidenceCardProps {
  payments: PaymentItem[];
  confirmedPaymentsCentavos: number;
  agreedPrice: number;
  isClient: boolean;
  isFreelancer: boolean;
  agreementStatus: string;
  confirmingPaymentId: string | null;
  onReportPayment: () => void;
  onOpenReceipt: (receiptPath: string) => void;
  onConfirmPayment: (paymentId: string) => void;
  onDisputePayment: (payment: PaymentItem) => void;
}

export const PaymentsEvidenceCard: React.FC<PaymentsEvidenceCardProps> = ({
  payments,
  confirmedPaymentsCentavos,
  agreedPrice,
  isClient,
  isFreelancer,
  agreementStatus,
  confirmingPaymentId,
  onReportPayment,
  onOpenReceipt,
  onConfirmPayment,
  onDisputePayment,
}) => {
  const theme = useAppTheme();
  const c = theme.colors;

  const progressPct =
    agreedPrice > 0 ? Math.min(100, Math.round((confirmedPaymentsCentavos / agreedPrice) * 100)) : 0;

  return (
    <Card
      headerTitle="Payments"
      headerSubtitle={`Confirmed: ${formatPrice(confirmedPaymentsCentavos)} / ${formatPrice(agreedPrice)} (${progressPct}%)`}
      headerIcon="wallet-outline"
      headerRight={
        isClient && agreementStatus === 'active' ? (
          <Button
            title="Report Payment"
            variant="primary"
            size="sm"
            icon="add-circle-outline"
            onPress={onReportPayment}
          />
        ) : undefined
      }
    >
      {/* Visual Payment Progress Bar */}
      <View style={[styles.progressBarTrack, { backgroundColor: c.surfaceAlt }]}>
        <View
          style={[
            styles.progressBarFill,
            {
              width: `${progressPct}%` as any,
              backgroundColor: progressPct >= 100 ? c.success : c.primary,
            },
          ]}
        />
      </View>

      {payments.length === 0 ? (
        <Card tone="inset" padding="md" style={styles.emptyMilestonesBox}>
          <Text style={[styles.emptyMilestonesText, { color: c.muted }]}>
            {isClient
              ? 'No external payments reported yet. After sending funds (GCash, Maya, cash), tap "Report Payment" above.'
              : 'No payment reports recorded yet by the client.'}
          </Text>
        </Card>
      ) : (
        <View style={styles.milestonesList}>
          {payments.map((p) => {
            const isReported = p.status === 'reported_sent';
            const isConfirmed = p.status === 'confirmed_received';
            const isDisputed = p.status === 'disputed';
            const canAct = isFreelancer && isReported;

            return (
              <Card
                key={p.id}
                tone="inset"
                padding="md"
                accentPosition="left"
                accentColor={
                  isDisputed ? c.danger : isConfirmed ? c.success : c.warning
                }
                style={[
                  styles.paymentRowCard,
                  {
                    backgroundColor: isDisputed
                      ? c.dangerSoft
                      : isConfirmed
                      ? c.successSoft
                      : c.insetBg || c.surfaceAlt,
                  },
                ]}
              >
                <View style={styles.paymentRowTop}>
                  <Text style={[styles.paymentAmount, { color: c.text }]}>
                    {formatPrice(p.amount)}
                  </Text>

                  <View style={styles.badgeWrapper}>
                    {isReported && <Badge status="pending" label="Reported sent" />}
                    {isConfirmed && (
                      <Badge status="active" label="Confirmed by freelancer" />
                    )}
                    {isDisputed && <Badge status="disputed" label="Disputed" />}
                  </View>
                </View>

                <Text style={[styles.paymentMethod, { color: c.muted }]}>
                  Channel: {p.payment_method.toUpperCase()}
                  {p.reference_number ? ` • Ref: ${p.reference_number}` : ''}
                  {p.created_at ? ` • ${new Date(p.created_at).toLocaleDateString()}` : ''}
                </Text>

                {p.receipt_path ? (
                  <View style={{ alignItems: 'flex-start', marginTop: 8 }}>
                    <Button
                      title="View Payment Receipt"
                      variant="soft"
                      size="xs"
                      icon="receipt-outline"
                      onPress={() => onOpenReceipt(p.receipt_path!)}
                    />
                  </View>
                ) : null}

                {p.notes ? (
                  <Text style={[styles.paymentNotes, { color: c.muted }]}>
                    Notes: {p.notes}
                  </Text>
                ) : null}

                {isDisputed && p.dispute_reason ? (
                  <AlertBox
                    tone="danger"
                    message={`Dispute reason: ${p.dispute_reason}`}
                    style={{ marginTop: 8, marginBottom: 0 }}
                  />
                ) : null}

                {/* Freelancer Action Buttons */}
                {canAct && (
                  <View style={{ marginTop: 10 }}>
                    <AlertBox
                      tone="info"
                      title="Payment Verification Needed"
                      message={`Client reported sending ${formatPrice(p.amount)} via ${p.payment_method.toUpperCase()}${p.reference_number ? ` (Ref #${p.reference_number})` : ''}. Please check your ${p.payment_method.toUpperCase()} account to verify the funds before confirming.`}
                      style={{ marginBottom: 10 }}
                    />
                    <View style={styles.paymentActionButtons}>
                      <Button
                        title="Confirm Received"
                        variant="success"
                        size="sm"
                        icon="checkmark-circle-outline"
                        onPress={() => onConfirmPayment(p.id)}
                        disabled={confirmingPaymentId === p.id}
                        loading={confirmingPaymentId === p.id}
                      />
                      <Button
                        title="Dispute Payment"
                        variant="danger-soft"
                        size="sm"
                        icon="alert-circle-outline"
                        onPress={() => onDisputePayment(p)}
                        disabled={confirmingPaymentId === p.id}
                      />
                    </View>
                  </View>
                )}
              </Card>
            );
          })}
        </View>
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  progressBarTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 14,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  emptyMilestonesBox: {
    alignItems: 'center',
    marginBottom: 0,
  },
  emptyMilestonesText: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  milestonesList: {
    gap: 12,
  },
  paymentRowCard: {
    marginBottom: 0,
  },
  paymentRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  paymentAmount: {
    fontSize: 17,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  badgeWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  paymentMethod: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  paymentNotes: {
    fontSize: 13, lineHeight: 18,
    marginTop: 6,
  },
  paymentActionButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
});
