import React from 'react';
import { View, Text, Pressable, StyleSheet, ViewStyle, StyleProp, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme, useResponsiveLayout } from '../../app/theme';
import { Button, IconButton } from './Button';

type CardTone =
  | 'neo-glass'
  | 'raised'
  | 'outline'
  | 'gradient'
  | 'inset'
  | 'role'
  | 'muted'
  | 'tinted-primary'
  | 'tinted-success'
  | 'tinted-danger';
type CardPadding = 'none' | 'sm' | 'md' | 'lg';

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * 'neo-glass' combines frosted translucent glass with dual soft neumorphic depth;
   * 'raised' floats on a deeper shadow;
   * 'outline' is crisp with a border;
   * 'gradient' uses a subtle surface gradient;
   * 'inset' is a recessed well box for metadata/inner blocks;
   * 'role' highlights the active Freelancer/Client role accent.
   */
  tone?: CardTone;
  padding?: CardPadding;
  accentPosition?: 'top' | 'left' | 'none';
  accentColor?: string;
  headerTitle?: string;
  headerSubtitle?: string;
  headerIcon?: React.ComponentProps<typeof Ionicons>['name'];
  headerRight?: React.ReactNode;
  onPress?: () => void;
}

const PADDING_MAP: Record<CardPadding, number> = {
  none: 0,
  sm: 12,
  md: 18,
  lg: 24,
};

export const Card: React.FC<CardProps> = ({
  children,
  style,
  tone = 'raised',
  padding = 'md',
  accentPosition = 'none',
  accentColor,
  headerTitle,
  headerSubtitle,
  headerIcon,
  headerRight,
  onPress,
}) => {
  const theme = useAppTheme();
  const c = theme.colors;
  const resolvedPadding = PADDING_MAP[padding];
  const resolvedAccent = accentColor || c.primary;

  const renderHeader = () => {
    if (!headerTitle && !headerRight) return null;
    return (
      <View
        style={[
          styles.headerRow,
          {
            borderBottomColor: c.border,
            marginBottom: resolvedPadding > 0 ? 14 : 0,
            paddingBottom: 12,
          },
        ]}
      >
        <View style={styles.headerTitleCol}>
          <View style={styles.headerTitleInline}>
            {headerIcon ? (
              <View style={[styles.headerIconWrap, { backgroundColor: c.primarySoft }]}>
                <Ionicons name={headerIcon} size={16} color={c.primary} />
              </View>
            ) : null}
            <View style={{ flex: 1 }}>
              {headerTitle ? (
                <Text style={[styles.headerTitle, { color: c.text }]}>{headerTitle}</Text>
              ) : null}
              {headerSubtitle ? (
                <Text style={[styles.headerSubtitle, { color: c.muted }]}>{headerSubtitle}</Text>
              ) : null}
            </View>
          </View>
        </View>
        {headerRight ? <View>{headerRight}</View> : null}
      </View>
    );
  };

  const accentStyle: ViewStyle =
    accentPosition === 'top'
      ? { borderTopWidth: 2, borderTopColor: resolvedAccent }
      : accentPosition === 'left'
      ? { borderWidth: 1, borderColor: resolvedAccent }
      : {};

  if (tone === 'gradient' && !onPress) {
    return (
      <View
        style={[
          styles.card,
          {
            padding: resolvedPadding,
            borderRadius: theme.radii.card,
            backgroundColor: c.surface,
            borderWidth: 1,
            borderColor: c.border,
          },
          accentStyle,
          style,
        ]}
      >
        {renderHeader()}
        {children}
      </View>
    );
  }

  const getToneStyle = (hovered = false, pressed = false) => {
    if (tone === 'inset' || tone === 'muted') {
      return [
        {
          backgroundColor: c.surfaceAlt,
          borderWidth: 1,
          borderColor: hovered && onPress ? c.primary : c.border,
          borderRadius: 10,
        },
      ];
    }
    if (tone === 'tinted-primary') {
      return [
        {
          backgroundColor: c.primarySoft,
          borderWidth: 1,
          borderColor: c.primary,
        },
      ];
    }
    if (tone === 'tinted-success') {
      return [
        {
          backgroundColor: c.successSoft,
          borderWidth: 1,
          borderColor: c.success,
        },
      ];
    }
    if (tone === 'tinted-danger') {
      return [
        {
          backgroundColor: c.dangerSoft,
          borderWidth: 1,
          borderColor: c.danger,
        },
      ];
    }
    if (tone === 'role') {
      return [
        {
          backgroundColor: c.surface,
          borderWidth: 1.5,
          borderColor: c.roleAccent,
        },
      ];
    }
    if (tone === 'raised') {
      return [
        {
          backgroundColor: c.surface,
          borderWidth: 1,
          borderColor: hovered && onPress ? c.primary : c.borderStrong,
        },
      ];
    }
    if (tone === 'outline') {
      return [
        {
          backgroundColor: pressed && onPress ? c.surfaceAlt : c.surface,
          borderWidth: 1,
          borderColor: hovered && onPress ? c.primary : c.border,
        },
      ];
    }
    return [
      {
        backgroundColor: pressed && onPress ? c.surfaceAlt : c.surface,
        borderWidth: 1,
        borderColor: hovered && onPress ? c.primary : c.border,
      },
    ];
  };

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={(state: any) => [
          styles.card,
          {
            padding: resolvedPadding,
            borderRadius: tone === 'inset' ? 14 : theme.radii.card,
            transform: [
              {
                scale: state.pressed ? 0.992 : state.hovered ? 1.005 : 1,
              },
            ],
            ...({ cursor: 'pointer' } as any),
          },
          ...getToneStyle(Boolean(state.hovered), Boolean(state.pressed)),
          accentStyle,
          style,
        ]}
      >
        {renderHeader()}
        {children}
      </Pressable>
    );
  }

  return (
    <View
      style={[
        styles.card,
        {
          padding: resolvedPadding,
          borderRadius: tone === 'inset' ? 14 : theme.radii.card,
        },
        ...getToneStyle(false, false),
        accentStyle,
        style,
      ]}
    >
      {renderHeader()}
      {children}
    </View>
  );
};

type AlertBoxTone = 'info' | 'success' | 'warning' | 'danger' | 'ai' | 'neutral';

interface AlertBoxProps {
  tone?: AlertBoxTone;
  title?: string;
  message?: string;
  children?: React.ReactNode;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  action?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  style?: StyleProp<ViewStyle>;
}

export const AlertBox: React.FC<AlertBoxProps> = ({
  tone = 'info',
  title,
  message,
  children,
  icon,
  action,
  actionLabel,
  onAction,
  onDismiss,
  style,
}) => {
  const theme = useAppTheme();
  const c = theme.colors;

  const paletteMap: Record<
    AlertBoxTone,
    {
      bg: string;
      border: string;
      fg: string;
      textFg: string;
      closeColor: string;
      defaultIcon: React.ComponentProps<typeof Ionicons>['name'];
    }
  > = {
    info: {
      bg: 'rgba(37, 99, 235, 0.06)',
      border: 'rgba(37, 99, 235, 0.22)',
      fg: c.primary,
      textFg: '#1E3A8A',
      closeColor: c.primary,
      defaultIcon: 'information-circle',
    },
    neutral: {
      bg: c.surfaceAlt,
      border: c.borderStrong,
      fg: c.text,
      textFg: c.text,
      closeColor: c.muted,
      defaultIcon: 'information-circle-outline',
    },
    success: {
      bg: c.successSoft,
      border: 'rgba(22, 163, 74, 0.25)',
      fg: c.successText,
      textFg: c.successText,
      closeColor: c.successText,
      defaultIcon: 'checkmark-circle',
    },
    warning: {
      bg: c.warningSoft,
      border: 'rgba(217, 119, 6, 0.25)',
      fg: c.warningText,
      textFg: c.warningText,
      closeColor: c.warningText,
      defaultIcon: 'warning',
    },
    danger: {
      bg: c.dangerSoft,
      border: 'rgba(220, 38, 38, 0.25)',
      fg: c.dangerText,
      textFg: c.dangerText,
      closeColor: c.dangerText,
      defaultIcon: 'alert-circle',
    },
    ai: {
      bg: 'rgba(37, 99, 235, 0.06)',
      border: 'rgba(37, 99, 235, 0.22)',
      fg: c.primary,
      textFg: '#1E3A8A',
      closeColor: c.primary,
      defaultIcon: 'sparkles',
    },
  };

  const pal = paletteMap[tone] || paletteMap.info;
  const resolvedIcon = icon || pal.defaultIcon;

  return (
    <View
      style={[
        styles.alertBox,
        {
          backgroundColor: pal.bg,
          borderColor: pal.border,
        },
        style,
      ]}
    >
      <View style={[styles.alertRow, !title && styles.alertRowCentered]}>
        <Ionicons
          name={resolvedIcon}
          size={20}
          color={pal.fg}
          style={title ? { marginTop: 1 } : undefined}
        />
        <View style={styles.alertTextCol}>
          {title ? <Text style={[styles.alertTitle, { color: pal.fg }]}>{title}</Text> : null}
          {message ? (
            <Text style={[styles.alertMessage, { color: pal.textFg || pal.fg }]}>{message}</Text>
          ) : null}
          {children}
          {action ? <View style={{ marginTop: 6 }}>{action}</View> : null}
        </View>
        {actionLabel && onAction ? (
          <Button
            title={actionLabel}
            size="xs"
            variant={tone === 'danger' ? 'danger' : 'secondary'}
            onPress={onAction}
          />
        ) : null}
        {onDismiss ? (
          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={({ hovered, pressed }: any) => [
              styles.alertDismissBtn,
              hovered && { backgroundColor: 'rgba(0,0,0,0.06)' },
              pressed && { backgroundColor: 'rgba(0,0,0,0.12)' },
              Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
            ]}
          >
            <Ionicons name="close" size={16} color={pal.closeColor || pal.fg} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
};

interface StatBoxProps {
  label: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'role';
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export const StatBox: React.FC<StatBoxProps> = ({
  label,
  value,
  subtitle,
  icon,
  tone = 'primary',
  onPress,
  style,
}) => {
  const theme = useAppTheme();
  const c = theme.colors;

  const toneColors = {
    primary: { fg: c.primary, soft: c.primarySoft },
    success: { fg: c.success, soft: c.successSoft },
    warning: { fg: c.warning, soft: c.warningSoft },
    danger: { fg: c.danger, soft: c.dangerSoft },
    role: { fg: c.roleAccent, soft: c.roleAccentSoft },
  }[tone];

  return (
    <Card
      padding="md"
      onPress={onPress}
      accentPosition="top"
      accentColor={toneColors.fg}
      style={[styles.statBox, style]}
    >
      <View style={styles.statTopRow}>
        <Text style={[styles.statLabel, { color: c.muted }]} numberOfLines={1}>
          {label}
        </Text>
        {icon ? (
          <View style={[styles.statIconWrap, { backgroundColor: toneColors.soft }]}>
            <Ionicons name={icon} size={16} color={toneColors.fg} />
          </View>
        ) : null}
      </View>
      <Text style={[styles.statValue, { color: toneColors.fg }]}>{value}</Text>
      {subtitle ? (
        <Text style={[styles.statSubtitle, { color: c.muted }]} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </Card>
  );
};

interface PageHeaderBoxProps {
  title: string;
  subtitle?: string;
  backLabel?: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
  maxWidth?: number;
  style?: StyleProp<ViewStyle>;
}

export const PageHeaderBox: React.FC<PageHeaderBoxProps> = ({
  title,
  subtitle,
  backLabel,
  onBack,
  rightAction,
  maxWidth = 960,
  style,
}) => {
  const theme = useAppTheme();
  const { isWide, topSpace } = useResponsiveLayout();
  const c = theme.colors;

  return (
    <View
      style={[
        styles.pageHeaderOuter,
        {
          backgroundColor: theme.glass.surface,
          borderBottomColor: c.border,
          paddingTop: isWide ? 18 : topSpace,
        },
        theme.shadow.card,
        style,
      ]}
    >
      <View style={[styles.pageHeaderInner, { maxWidth }]}>
        {onBack ? (
          <IconButton
            icon="arrow-back"
            label={isWide && backLabel ? backLabel : undefined}
            accessibilityLabel={backLabel || 'Go back'}
            variant="soft"
            size="sm"
            onPress={onBack}
          />
        ) : null}
        <View style={styles.pageHeaderTitleCol}>
          <Text style={[styles.pageHeaderTitle, { color: c.text }]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[styles.pageHeaderSubtitle, { color: c.muted }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {rightAction ? <View>{rightAction}</View> : null}
      </View>
    </View>
  );
};

interface StickyFooterBoxProps {
  children: React.ReactNode;
  maxWidth?: number;
  style?: StyleProp<ViewStyle>;
}

export const StickyFooterBox: React.FC<StickyFooterBoxProps> = ({
  children,
  maxWidth = 960,
  style,
}) => {
  const theme = useAppTheme();
  const { bottomSpace } = useResponsiveLayout();

  return (
    <View
      style={[
        styles.stickyFooterOuter,
        {
          backgroundColor: theme.glass.surface,
          borderTopColor: theme.colors.border,
          paddingBottom: bottomSpace,
        },
        theme.shadow.stickyDock,
        style,
      ]}
    >
      <View style={[styles.stickyFooterInner, { maxWidth }]}>{children}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  headerTitleCol: {
    flex: 1,
  },
  headerTitleInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  alertBox: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  alertRowCentered: {
    alignItems: 'center',
  },
  alertTextCol: {
    flex: 1,
    gap: 3,
  },
  alertTitle: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  alertMessage: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
  },
  alertDismissBtn: {
    width: 26,
    height: 26,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  statBox: {
    marginBottom: 0,
  },
  statTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 6,
  },
  statIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    flex: 1,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  statSubtitle: {
    fontSize: 12,
    marginTop: 4,
    fontWeight: '500',
  },
  pageHeaderOuter: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  pageHeaderInner: {
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pageHeaderTitleCol: {
    flex: 1,
  },
  pageHeaderTitle: {
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  pageHeaderSubtitle: {
    fontSize: 12,
    marginTop: 2,
    fontWeight: '500',
  },
  stickyFooterOuter: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  stickyFooterInner: {
    width: '100%',
    alignSelf: 'center',
  },
});
