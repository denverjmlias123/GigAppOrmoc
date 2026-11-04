import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAppTheme } from '../../app/theme';

type StatusType =
  | 'open'
  | 'active'
  | 'in_progress'
  | 'pending'
  | 'countered'
  | 'revision_requested'
  | 'approved'
  | 'confirmed'
  | 'completed'
  | 'declined'
  | 'cancelled'
  | 'expired'
  | 'disputed'
  | 'draft'
  | 'withdrawn'
  | 'inactive';

interface BadgeProps {
  status: StatusType | string;
  label?: string;
  /** Override the computed badge colors (bg and text) */
  bgColor?: string;
  textColor?: string;
}

export const Badge: React.FC<BadgeProps> = React.memo(function Badge({ status, label, bgColor, textColor }) {
  const theme = useAppTheme();
  const c = theme.colors;

  const getStatusColor = () => {
    // Allow caller override
    if (bgColor && textColor) {
      return { bg: bgColor, text: textColor };
    }
    switch (status.toLowerCase()) {
      case 'open':
      case 'active':
      case 'in_progress':
        return { bg: c.primarySoft, text: c.primary };
      case 'pending':
      case 'countered':
      case 'revision_requested':
      case 'suspended':
        return { bg: c.warningSoft, text: c.warningText };
      case 'approved':
      case 'confirmed':
      case 'completed':
        return { bg: c.successSoft, text: c.successText };
      case 'declined':
      case 'cancelled':
      case 'expired':
      case 'disputed':
      case 'deleted':
        return { bg: c.dangerSoft, text: c.dangerText };
      default:
        return { bg: c.surfaceAlt, text: c.muted };
    }
  };

  const getStatusLabel = () => {
    if (label) return label;
    switch (status.toLowerCase()) {
      case 'in_progress':
        return 'In progress';
      case 'revision_requested':
        return 'Needs revision';
      case 'face_to_face':
        return 'Face-to-face';
      default:
        return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
    }
  };

  const colors = getStatusColor();

  return (
    <View style={[styles.pill, { backgroundColor: colors.bg, borderRadius: theme.radii.pill }]}>
      <View style={[styles.dot, { backgroundColor: colors.text }]} />
      <Text style={[styles.label, { color: colors.text }]}>{getStatusLabel()}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 12, fontWeight: '600' },
});
