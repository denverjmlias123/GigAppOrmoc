import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../app/theme';

interface ListRowProps {
  title: string;
  subtitle?: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  last?: boolean;
  rightElement?: React.ReactNode;
  danger?: boolean;
}

export const ListRow: React.FC<ListRowProps> = ({
  title,
  subtitle,
  icon,
  onPress,
  last = false,
  rightElement,
  danger = false,
}) => {
  const theme = useAppTheme();
  const c = theme.colors;
  const fg = danger ? c.dangerText : c.text;
  const iconBg = danger ? c.dangerSoft : c.primarySoft;
  const iconColor = danger ? c.danger : c.primary;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={(state: any) => [
        styles.row,
        {
          borderBottomColor: c.border,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          backgroundColor: state.pressed || state.hovered ? c.surfaceAlt : 'transparent',
          ...({ cursor: 'pointer' } as any),
        },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: iconBg, borderRadius: theme.radii.chip }]}>
        <Ionicons name={icon} size={20} color={iconColor} />
      </View>
      <View style={styles.text}>
        <Text style={[theme.type.bodyStrong, { color: fg }]}>{title}</Text>
        {subtitle ? <Text style={[theme.type.small, { color: c.muted }]}>{subtitle}</Text> : null}
      </View>
      {rightElement || <Ionicons name="chevron-forward" size={18} color={c.borderStrong} />}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  iconWrap: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1 },
});
