import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Smartphone, Wallet, Globe, Banknote } from 'lucide-react-native';
import { getPaymentRailMeta, borderRadius } from '../../lib/theme';

export function renderPaymentRailIcon(
  method?: string | null,
  size: number = 13,
  overrideColor?: string
) {
  const meta = getPaymentRailMeta(method);
  const color = overrideColor || meta.color;
  const key = (method || 'gcash').toLowerCase();

  switch (key) {
    case 'gcash':
      return <Smartphone size={size} color={color} />;
    case 'maya':
      return <Wallet size={size} color={color} />;
    case 'paypal':
      return <Globe size={size} color={color} />;
    case 'cash':
      return <Banknote size={size} color={color} />;
    default:
      return <Wallet size={size} color={color} />;
  }
}

export interface PaymentMethodPillProps {
  method?: string | null;
  showTagline?: boolean;
}

export const PaymentMethodPill: React.FC<PaymentMethodPillProps> = ({
  method,
  showTagline = false,
}) => {
  const meta = getPaymentRailMeta(method);

  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: meta.surface,
          borderColor: meta.border,
        },
      ]}
    >
      <View style={[styles.codeCircle, { backgroundColor: meta.color }]}>
        <Text style={styles.codeText}>{meta.shortCode}</Text>
      </View>
      <Text style={[styles.label, { color: meta.textColor }]}>
        {meta.label}
      </Text>
      {showTagline && (
        <Text style={[styles.tagline, { color: meta.textColor }]}>
          • {meta.tagline}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 3.5,
    paddingHorizontal: 9,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  codeCircle: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  tagline: {
    fontSize: 10,
    fontWeight: '600',
    opacity: 0.85,
  },
});

export default PaymentMethodPill;
