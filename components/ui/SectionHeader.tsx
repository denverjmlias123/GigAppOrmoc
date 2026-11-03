import React from 'react';
import { View, Text, Pressable, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../app/theme';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  subtitle,
  icon,
  actionLabel,
  onAction,
  style,
}) => {
  const theme = useAppTheme();
  return (
    <View style={[styles.row, style]}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {icon ? <Ionicons name={icon} size={18} color={theme.colors.primary} /> : null}
          <Text style={[theme.type.heading, { color: theme.colors.text }]}>{title}</Text>
        </View>
        {subtitle ? (
          <Text style={[theme.type.small, { color: theme.colors.muted, marginTop: 2 }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          hitSlop={8}
          accessibilityRole="button"
          style={(state: any) => [
            styles.actionPill,
            {
              backgroundColor:
                state.pressed || state.hovered ? theme.colors.primarySoft : theme.colors.surface,
              borderColor: state.hovered ? theme.colors.primary : theme.colors.border,
              ...({ cursor: 'pointer' } as any),
            },
          ]}
        >
          <Text style={[theme.type.small, { color: theme.colors.primary, fontWeight: '700' }]}>
            {actionLabel}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={theme.colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
});
