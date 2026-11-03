import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAppTheme } from '../../app/theme';
import { AgreementItem } from '../../services/applications';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { formatPrice } from '../ui/GigCard';

interface AgreementTermsCardProps {
  agreement: AgreementItem;
  onViewGig: () => void;
  onOpenChat: () => void;
  onReport: () => void;
  onCancelAgreement: () => void;
}

export const AgreementTermsCard: React.FC<AgreementTermsCardProps> = ({
  agreement,
  onViewGig,
  onOpenChat,
  onReport,
  onCancelAgreement,
}) => {
  const theme = useAppTheme();

  return (
    <View style={{ gap: 14 }}>
      {/* Status & Gig Header */}
      <Card accentPosition="top" accentColor={theme.colors.primary}>
        <View style={styles.statusRow}>
          <Text style={[styles.label, { color: theme.colors.muted }]}>Agreement Status</Text>
          <Badge status={agreement.status} />
        </View>

        <Text style={[styles.gigTitle, { color: theme.colors.text }]}>
          {agreement.gig?.title || 'Gig Agreement'}
        </Text>

        <View style={{ alignItems: 'flex-start', marginBottom: 12 }}>
          <Button
            title="View Original Gig"
            variant="ghost"
            size="xs"
            rightIcon="chevron-forward"
            onPress={onViewGig}
          />
        </View>

        {/* Quick Agreement Communication & Protection Actions */}
        <View style={styles.quickActionButtonsRow}>
          <Button
            title="Open Chat"
            variant="soft"
            size="sm"
            icon="chatbubble-ellipses-outline"
            onPress={onOpenChat}
          />

          <Button
            title="Report"
            variant="secondary"
            size="sm"
            icon="flag-outline"
            onPress={onReport}
          />

          {agreement.status === 'active' && (
            <Button
              title="Cancel Agreement"
              variant="danger-soft"
              size="sm"
              icon="close-circle-outline"
              onPress={onCancelAgreement}
            />
          )}
        </View>
      </Card>

      {/* Financial Terms */}
      <Card headerTitle="Agreement Terms" headerIcon="document-lock-outline">
        <Card tone="inset" padding="sm" style={{ marginBottom: 0, gap: 10 }}>
          <View style={styles.detailRow}>
            <Text style={[styles.label, { color: theme.colors.muted }]}>Agreed Amount:</Text>
            <Text style={[styles.priceValue, { color: theme.colors.primary }]}>
              {formatPrice(agreement.agreed_price)}
            </Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={[styles.label, { color: theme.colors.muted }]}>
              Completion Deadline:
            </Text>
            <Text style={[styles.value, { color: theme.colors.text }]}>
              {new Date(agreement.deadline).toLocaleDateString(undefined, {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={[styles.label, { color: theme.colors.muted }]}>Agreement ID:</Text>
            <Text style={[styles.monoValue, { color: theme.colors.muted }]}>
              {agreement.id.slice(0, 8)}...
            </Text>
          </View>
        </Card>
      </Card>
    </View>
  );
};

const styles = StyleSheet.create({
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
  gigTitle: {
    fontSize: 19,
    fontWeight: '800',
    marginBottom: 4,
  },
  quickActionButtonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  priceValue: {
    fontSize: 17,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  value: {
    fontSize: 14,
    fontWeight: '700',
  },
  monoValue: {
    fontSize: 12,
    fontFamily: 'monospace',
  },
});
