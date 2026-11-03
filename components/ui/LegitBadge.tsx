import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../app/theme';

interface LegitBadgeProps {
  size?: 'small' | 'medium';
  role?: 'client' | 'freelancer' | 'hire' | 'find_work' | string | null;
  label?: string;
}

export const LegitBadge: React.FC<LegitBadgeProps> = ({ size = 'small', role, label }) => {
  const theme = useAppTheme();
  const c = theme.colors;

  const isSmall = size === 'small';
  const isClientRole = role === 'hire' || role === 'client';
  const defaultLabel = isClientRole ? 'Legit Client' : 'Legit Account';
  const displayLabel = label || defaultLabel;

  return (
    <View
      style={[
        styles.badge,
        isSmall ? styles.badgeSmall : styles.badgeMedium,
        {
          backgroundColor: c.primarySoft,
          borderColor: c.primary,
        },
      ]}
      accessibilityRole="text"
      accessibilityLabel={displayLabel}
    >
      <Ionicons
        name="shield-checkmark"
        size={isSmall ? 12 : 15}
        color={c.primaryDark}
      />
      <Text
        style={[
          styles.text,
          isSmall ? styles.textSmall : styles.textMedium,
          { color: c.primaryDark },
        ]}
      >
        {displayLabel}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  badgeSmall: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 4,
  },
  badgeMedium: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    gap: 6,
  },
  text: {
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  textSmall: {
    fontSize: 11,
  },
  textMedium: {
    fontSize: 13,
  },
});
