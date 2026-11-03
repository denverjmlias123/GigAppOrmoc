import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
  StyleProp,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../app/theme';

type ButtonVariant =
  | 'primary'
  | 'accent'
  | 'secondary'
  | 'soft'
  | 'success'
  | 'warning'
  | 'danger'
  | 'danger-soft'
  | 'ghost'
  | 'ai';

type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

export const BUTTON_COOLDOWN_MS = 800;

interface ButtonProps {
  title: string;
  onPress: () => void | Promise<unknown>;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  cooldownMs?: number;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  rightIcon?: React.ComponentProps<typeof Ionicons>['name'];
  pill?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

const SIZE_METRICS: Record<
  ButtonSize,
  { minHeight: number; py: number; px: number; fontSize: number; iconSize: number; radius: number }
> = {
  xs: { minHeight: 32, py: 6, px: 12, fontSize: 12, iconSize: 14, radius: 10 },
  sm: { minHeight: 38, py: 8, px: 14, fontSize: 13, iconSize: 15, radius: 12 },
  md: { minHeight: 46, py: 11, px: 18, fontSize: 14, iconSize: 17, radius: 14 },
  lg: { minHeight: 54, py: 14, px: 20, fontSize: 16, iconSize: 18, radius: 16 },
};

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'lg',
  disabled = false,
  loading = false,
  cooldownMs = BUTTON_COOLDOWN_MS,
  icon,
  rightIcon,
  pill = false,
  fullWidth = false,
  style,
  textStyle,
}) => {
  const theme = useAppTheme();
  const c = theme.colors;

  const inFlightRef = useRef(false);
  const coolingDownRef = useRef(false);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [internalBusy, setInternalBusy] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handlePress = useCallback(() => {
    if (disabled || loading || inFlightRef.current || coolingDownRef.current) {
      return;
    }

    inFlightRef.current = true;
    let isAsync = false;

    try {
      const maybePromise = onPress();
      if (maybePromise && typeof (maybePromise as Promise<unknown>).then === 'function') {
        isAsync = true;
        if (mountedRef.current) {
          setInternalBusy(true);
        }
        (maybePromise as Promise<unknown>).then(
          () => {
            inFlightRef.current = false;
            if (mountedRef.current) {
              setInternalBusy(false);
            }
            if (cooldownMs > 0 && mountedRef.current) {
              coolingDownRef.current = true;
              timerRef.current = setTimeout(() => {
                coolingDownRef.current = false;
              }, cooldownMs);
            }
          },
          () => {
            inFlightRef.current = false;
            if (mountedRef.current) {
              setInternalBusy(false);
            }
          }
        );
      }
    } finally {
      if (!isAsync) {
        inFlightRef.current = false;
        if (cooldownMs > 0 && mountedRef.current) {
          coolingDownRef.current = true;
          timerRef.current = setTimeout(() => {
            coolingDownRef.current = false;
          }, cooldownMs);
        }
      }
    }
  }, [disabled, loading, onPress, cooldownMs]);

  type Scheme = { bg: string; fg: string; border: string; pressed: string };
  const schemes: Record<ButtonVariant, Scheme> = {
    primary: { bg: c.primary, fg: c.primaryText, border: 'transparent', pressed: c.primaryDark },
    accent: { bg: c.roleAccent, fg: c.primaryText, border: 'transparent', pressed: c.primaryDark },
    success: { bg: c.success, fg: c.primaryText, border: 'transparent', pressed: c.successText },
    warning: { bg: c.warningSoft, fg: c.warningText, border: c.warning, pressed: c.surfaceAlt },
    danger: { bg: c.danger, fg: c.primaryText, border: 'transparent', pressed: c.dangerText },
    'danger-soft': { bg: c.dangerSoft, fg: c.dangerText, border: c.danger, pressed: c.surfaceAlt },
    soft: { bg: c.primarySoft, fg: c.primary, border: 'transparent', pressed: c.surfaceAlt },
    secondary: { bg: c.surface, fg: c.text, border: c.borderStrong, pressed: c.surfaceAlt },
    ghost: { bg: 'transparent', fg: c.primary, border: 'transparent', pressed: c.primarySoft },
    ai: { bg: c.primarySoft, fg: c.primary, border: c.primary, pressed: c.surfaceAlt },
  };
  const scheme = schemes[variant] || schemes.primary;
  const metrics = SIZE_METRICS[size] || SIZE_METRICS.lg;
  const resolvedRadius = pill || variant === 'ai' ? theme.radii.pill : metrics.radius;

  const isBusy = loading || internalBusy;
  const inactive = disabled || isBusy;
  const bg = disabled
    ? c.borderStrong
    : scheme.bg;
  const hasBorder =
    variant === 'secondary' ||
    variant === 'warning' ||
    variant === 'danger-soft' ||
    variant === 'ai';

  return (
    <Pressable
      onPress={handlePress}
      disabled={inactive}
      hitSlop={
        size === 'xs'
          ? { top: 8, bottom: 8, left: 8, right: 8 }
          : size === 'sm'
          ? { top: 5, bottom: 5, left: 6, right: 6 }
          : size === 'md'
          ? { top: 1, bottom: 1, left: 2, right: 2 }
          : 0
      }
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: isBusy }}
      style={(state: any) => {
        const { pressed, hovered, focused } = state;
        const currentBg = inactive
          ? bg
          : pressed
          ? scheme.pressed
          : hovered
          ? scheme.pressed
          : bg;

        return [
          styles.base,
          {
            minHeight: metrics.minHeight,
            paddingVertical: metrics.py,
            paddingHorizontal: metrics.px,
            borderRadius: resolvedRadius,
            width: fullWidth ? '100%' : undefined,
            backgroundColor: currentBg,
            borderColor:
              variant === 'secondary' && hovered && !inactive
                ? c.primary
                : scheme.border,
            borderWidth: hasBorder ? 1 : 0,
            opacity: disabled ? 0.55 : 1,
            transform: [
              {
                scale: pressed && !inactive ? 0.985 : 1,
              },
            ],
            overflow: 'hidden',
            ...({
              cursor: inactive ? 'not-allowed' : 'pointer',
              outlineStyle: focused ? 'solid' : 'none',
              outlineWidth: focused ? 2 : 0,
              outlineColor: c.focusRing,
            } as any),
          },
          style,
        ];
      }}
    >
      {isBusy ? (
        <ActivityIndicator size="small" color={scheme.fg} />
      ) : (
        <View style={styles.content}>
          {icon ? <Ionicons name={icon} size={metrics.iconSize} color={scheme.fg} /> : null}
          <Text
            style={[
              styles.text,
              { color: scheme.fg, fontSize: metrics.fontSize },
              textStyle,
            ]}
            numberOfLines={1}
          >
            {title}
          </Text>
          {rightIcon ? <Ionicons name={rightIcon} size={metrics.iconSize} color={scheme.fg} /> : null}
        </View>
      )}
    </Pressable>
  );
};

interface IconButtonProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void | Promise<unknown>;
  label?: string;
  accessibilityLabel?: string;
  variant?: 'surface' | 'secondary' | 'soft' | 'primary' | 'danger-soft' | 'ghost' | 'hero';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  badgeCount?: number;
  style?: StyleProp<ViewStyle>;
}

export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  onPress,
  label,
  accessibilityLabel,
  variant = 'surface',
  size = 'md',
  disabled = false,
  badgeCount = 0,
  style,
}) => {
  const theme = useAppTheme();
  const c = theme.colors;
  const dim = size === 'sm' ? 34 : size === 'lg' ? 46 : 40;
  const iconSize = size === 'sm' ? 17 : size === 'lg' ? 22 : 19;

  const getPalette = (hovered: boolean, pressed: boolean) => {
    switch (variant) {
      case 'primary':
        return {
          bg: pressed ? c.primaryDark : c.primary,
          fg: c.primaryText,
          border: 'transparent',
        };
      case 'soft':
        return {
          bg: pressed || hovered ? c.surfaceAlt : c.primarySoft,
          fg: c.primary,
          border: hovered ? c.primary : 'transparent',
        };
      case 'danger-soft':
        return {
          bg: pressed ? c.danger : c.dangerSoft,
          fg: pressed ? c.primaryText : c.dangerText,
          border: c.danger,
        };
      case 'hero':
        return {
          bg: c.heroChip,
          fg: c.heroText,
          border: 'rgba(255,255,255,0.22)',
        };
      case 'ghost':
        return {
          bg: pressed || hovered ? c.primarySoft : 'transparent',
          fg: c.primary,
          border: 'transparent',
        };
      case 'surface':
      default:
        return {
          bg: pressed || hovered ? c.surfaceAlt : c.surface,
          fg: hovered ? c.primary : c.text,
          border: hovered ? c.primary : c.border,
        };
    }
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label || icon}
      style={(state: any) => {
        const { hovered, pressed } = state;
        const pal = getPalette(Boolean(hovered), Boolean(pressed));
        return [
          styles.iconBtnBase,
          label ? { paddingHorizontal: 12, height: dim, borderRadius: dim / 2 } : { width: dim, height: dim, borderRadius: dim / 2 },
          {
            backgroundColor: pal.bg,
            borderColor: pal.border,
            borderWidth: pal.border !== 'transparent' ? 1 : 0,
            opacity: disabled ? 0.5 : 1,
            transform: [{ scale: pressed && !disabled ? 0.95 : hovered && !disabled ? 1.03 : 1 }],
            ...({ cursor: disabled ? 'not-allowed' : 'pointer' } as any),
          },
          variant === 'surface' ? theme.shadow.card : null,
          style,
        ];
      }}
    >
      {(state: any) => {
        const pal = getPalette(Boolean(state.hovered), Boolean(state.pressed));
        return (
          <>
            <Ionicons name={icon} size={iconSize} color={pal.fg} />
            {label ? (
              <Text style={[styles.iconBtnLabel, { color: pal.fg }]} numberOfLines={1}>
                {label}
              </Text>
            ) : null}
            {badgeCount > 0 ? (
              <View style={[styles.badgeDot, { backgroundColor: c.danger }]}>
                <Text style={styles.badgeDotText}>{badgeCount > 9 ? '9+' : badgeCount}</Text>
              </View>
            ) : null}
          </>
        );
      }}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  text: { fontWeight: '800', letterSpacing: -0.1 },
  iconBtnBase: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    position: 'relative',
  },
  iconBtnLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  badgeDot: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDotText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
});
