import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Inbox, ArrowRight, Sparkles } from 'lucide-react-native';
import { colors, borderRadius, typography, spacing, shadows } from '../../lib/theme';

export interface EmptyStateCardProps {
  title?: string;
  description: string;
  icon?: React.ReactNode;
  badgeText?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyStateCard: React.FC<EmptyStateCardProps> = ({
  title = 'No Records Found',
  description,
  icon,
  badgeText = 'Ormoc Marketplace',
  actionLabel,
  onAction,
}) => {
  return (
    <View style={styles.card}>
      <View style={styles.topAccentStrip} />

      <View style={styles.badgePill}>
        <Sparkles size={11} color={colors.ormocGold} />
        <Text style={styles.badgePillText}>{badgeText}</Text>
      </View>

      <View style={styles.outerRing}>
        <View style={styles.iconContainer}>
          {icon || <Inbox size={28} color={colors.ormocGold} />}
        </View>
      </View>

      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>

      {actionLabel && onAction && (
        <TouchableOpacity
          style={styles.actionButton}
          onPress={onAction}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
          <Text style={styles.actionButtonText}>{actionLabel}</Text>
          <ArrowRight size={15} color={colors.textInverse} />
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl + 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: spacing.md,
    position: 'relative',
    overflow: 'hidden',
    width: '100%',
    ...shadows.card,
  },
  topAccentStrip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: colors.ormocGold,
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    marginBottom: spacing.md,
  },
  badgePillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#B45309',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  outerRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#FFFDF5',
    borderWidth: 1,
    borderColor: '#FDE68A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: typography.lg,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 6,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  description: {
    fontSize: typography.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 360,
  },
  actionButton: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 11,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.lg,
    ...shadows.sm,
  },
  actionButtonText: {
    fontSize: typography.sm,
    fontWeight: '700',
    color: colors.textInverse,
  },
});

export default EmptyStateCard;
