import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, borderRadius, typography } from '../../lib/theme';

export interface StatusBadgeProps {
  status: string;
  label?: string;
  size?: 'sm' | 'md';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  label,
  size = 'md',
}) => {
  const norm = status?.toLowerCase() || 'pending';
  const displayLabel = label || norm.replace(/_/g, ' ');

  let bg: string = colors.surfaceSecondary;
  let text: string = colors.textSecondary;
  let borderColor: string = colors.border;
  let dotColor: string = colors.textMuted;

  switch (norm) {
    case 'open':
    case 'active':
    case 'verified':
    case 'approved':
    case 'accepted':
    case 'confirmed_received':
    case 'completed':
      bg = colors.successSurface;
      text = '#15803D';
      borderColor = '#BBF7D0';
      dotColor = '#16A34A';
      break;
    case 'in_progress':
      bg = colors.primarySurface;
      text = colors.primaryDark;
      borderColor = colors.primaryBorder;
      dotColor = colors.primary;
      break;
    case 'pending':
    case 'submitted':
    case 'reported':
    case 'reported_sent':
    case 'update_requested':
      bg = colors.warningSurface;
      text = '#B45309';
      borderColor = '#FDE68A';
      dotColor = '#D97706';
      break;
    case 'revision_requested':
    case 'disputed':
    case 'rejected':
    case 'cancelled':
    case 'withdrawn':
    case 'locked':
      bg = colors.dangerSurface;
      text = '#B91C1C';
      borderColor = '#FECACA';
      dotColor = '#DC2626';
      break;
    case 'freelancer':
      bg = colors.freelancerSurface;
      text = colors.freelancer;
      borderColor = '#BAE6FD';
      dotColor = colors.freelancer;
      break;
    case 'client':
      bg = colors.clientSurface;
      text = colors.client;
      borderColor = '#C7D2FE';
      dotColor = colors.client;
      break;
    default:
      bg = colors.surfaceSecondary;
      text = colors.textSecondary;
      borderColor = colors.border;
      dotColor = colors.textMuted;
  }

  return (
    <View
      style={[
        styles.badge,
        size === 'sm' && styles.badgeSm,
        { backgroundColor: bg, borderColor },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text
        style={[
          styles.text,
          size === 'sm' && styles.textSm,
          { color: text },
        ]}
      >
        {String(displayLabel || '').toUpperCase()}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    alignSelf: 'flex-start',
    gap: 5,
  },
  badgeSm: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    gap: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  text: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  textSm: {
    fontSize: 9,
  },
});

export default StatusBadge;
