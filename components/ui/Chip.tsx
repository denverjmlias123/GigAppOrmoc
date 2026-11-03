import React from 'react';
import { Pressable, Text, View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../app/theme';

interface ChipProps {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  onRemove?: () => void;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  count?: number;
  size?: 'sm' | 'md';
  tone?: 'primary' | 'role' | 'neutral' | 'danger' | 'success' | 'warning';
  style?: StyleProp<ViewStyle>;
}

export const Chip: React.FC<ChipProps> = ({
  label,
  selected = false,
  disabled = false,
  onPress,
  onRemove,
  icon,
  count,
  size = 'md',
  tone = 'primary',
  style,
}) => {
  const theme = useAppTheme();
  const c = theme.colors;
  const activeColor =
    tone === 'role'
      ? c.roleAccent
      : tone === 'danger'
      ? c.danger
      : tone === 'success'
      ? c.success
      : tone === 'warning'
      ? c.warning
      : c.primary;
  const activeSoft =
    tone === 'role'
      ? c.roleAccentSoft
      : tone === 'danger'
      ? c.dangerSoft
      : tone === 'success'
      ? c.successSoft
      : tone === 'warning'
      ? c.warningSoft
      : c.primarySoft;
  const fg = selected ? c.primaryText : c.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || (!onPress && !onRemove)}
      hitSlop={onPress ? (size === 'sm' ? { top: 8, bottom: 8, left: 6, right: 6 } : { top: 4, bottom: 4, left: 4, right: 4 }) : undefined}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      style={(state: any) => [
        styles.chip,
        size === 'sm' ? styles.chipSm : styles.chipMd,
        {
          borderRadius: theme.radii.pill,
          backgroundColor: selected
            ? activeColor
            : state.pressed || state.hovered
            ? activeSoft
            : c.surface,
          borderColor: selected || state.hovered ? activeColor : c.border,
          opacity: disabled ? 0.5 : state.pressed ? 0.92 : 1,
          ...({ cursor: disabled ? 'not-allowed' : onPress || onRemove ? 'pointer' : 'default' } as any),
        },
        style,
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={size === 'sm' ? 13 : 15}
          color={selected ? c.primaryText : activeColor}
        />
      ) : null}
      <Text
        style={[
          styles.label,
          size === 'sm' ? { fontSize: 12 } : { fontSize: 13 },
          { color: fg },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {typeof count === 'number' ? (
        <View
          style={[
            styles.countPill,
            {
              backgroundColor: selected ? 'rgba(255,255,255,0.22)' : c.surfaceAlt,
            },
          ]}
        >
          <Text
            style={[
              styles.countText,
              { color: selected ? c.primaryText : c.muted },
            ]}
          >
            {count}
          </Text>
        </View>
      ) : null}
      {onRemove ? (
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${label}`}
          style={styles.removeBtn}
        >
          <Ionicons
            name="close-circle"
            size={15}
            color={selected ? c.primaryText : c.muted}
          />
        </Pressable>
      ) : null}
    </Pressable>
  );
};

interface SegmentedOption<T extends string = string> {
  value: T;
  label: string;
  count?: number;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
}

interface SegmentedControlProps<T extends string = string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  style?: StyleProp<ViewStyle>;
}

export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  style,
}: SegmentedControlProps<T>) {
  const theme = useAppTheme();
  const c = theme.colors;

  return (
    <View
      style={[
        styles.segTrack,
        {
          backgroundColor: c.surfaceAlt,
          borderColor: c.border,
        },
        style,
      ]}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={(state: any) => [
              styles.segBtn,
              {
                backgroundColor: active
                  ? c.surface
                  : state.hovered
                  ? c.borderSubtle
                  : 'transparent',
                borderColor: active ? c.border : 'transparent',
                borderWidth: active ? 1 : 0,
                ...({ cursor: 'pointer' } as any),
              },
            ]}
          >
            {opt.icon ? (
              <Ionicons
                name={opt.icon}
                size={15}
                color={active ? c.primary : c.muted}
              />
            ) : null}
            <Text
              style={[
                styles.segLabel,
                {
                  color: active ? c.primary : c.muted,
                  fontWeight: active ? '800' : '600',
                },
              ]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
            {typeof opt.count === 'number' ? (
              <View
                style={[
                  styles.segCount,
                  {
                    backgroundColor: active ? c.primarySoft : c.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.countText,
                    { color: active ? c.primary : c.muted },
                  ]}
                >
                  {opt.count}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
  },
  chipSm: {
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipMd: {
    minHeight: 40,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  label: { fontWeight: '700' },
  countPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
  },
  countText: {
    fontSize: 11,
    fontWeight: '800',
  },
  removeBtn: {
    marginLeft: 4,
  },
  segTrack: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
  },
  segBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 40,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  segLabel: {
    fontSize: 13,
  },
  segCount: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
  },
});
