import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppTheme, useResponsiveLayout } from '../../app/theme';
import { strings } from '../../constants/strings';
import { getPasswordChecks } from '../../utils/passwordPolicy';

interface Props {
  password: string;
  email?: string;
  displayName?: string;
}

const checkLabels = [
  ['length', strings.auth.passwordLengthRule],
  ['lowercase', strings.auth.passwordLowercaseRule],
  ['uppercase', strings.auth.passwordUppercaseRule],
  ['number', strings.auth.passwordNumberRule],
  ['special', strings.auth.passwordSpecialRule],
  ['noSpaces', strings.auth.passwordNoSpacesRule],
  ['notEmail', strings.auth.passwordNotEmailRule],
  ['notName', strings.auth.passwordNotNameRule],
] as const;

export function PasswordPolicyChecklist({ password, email, displayName }: Props) {
  const theme = useAppTheme();
  const { width } = useResponsiveLayout();
  const isVeryNarrow = width > 0 && width < 360;
  const checks = getPasswordChecks(password, email, displayName);
  const totalCount = checkLabels.filter(([key]) => checks[key]).length;
  const allPassed = checkLabels.every(([key]) => checks[key]);
  const strength = !password || totalCount <= 3
    ? strings.auth.passwordStrengthWeak
    : !allPassed || totalCount < 8
      ? strings.auth.passwordStrengthFair
      : strings.auth.passwordStrengthStrong;

  const meterColor = allPassed
    ? '#10B981'
    : totalCount >= 5
    ? '#F59E0B'
    : totalCount >= 1
    ? '#EF4444'
    : '#CBD5E1';

  return (
    <View style={styles.container} accessibilityLiveRegion="polite">
      <View style={styles.strengthRow}>
        <Text style={[styles.strengthLabel, { color: theme.colors.muted }]}>{strings.auth.passwordStrengthLabel}</Text>
        <Text
          style={[
            styles.strengthValue,
            { color: allPassed ? theme.colors.success : totalCount >= 5 ? theme.colors.warning : theme.colors.danger },
          ]}
        >
          {strength}
        </Text>
      </View>

      {/* 3-segment Visual Strength Bar */}
      <View style={styles.meterTrack}>
        <View style={[styles.meterSegment, { backgroundColor: totalCount >= 1 ? meterColor : '#E2E8F0' }]} />
        <View style={[styles.meterSegment, { backgroundColor: totalCount >= 5 ? meterColor : '#E2E8F0' }]} />
        <View style={[styles.meterSegment, { backgroundColor: allPassed ? meterColor : '#E2E8F0' }]} />
      </View>

      <View style={styles.grid}>
        {checkLabels.map(([key, label]) => {
          const isPassed = Boolean(checks[key]);
          return (
            <View key={key} style={[styles.rule, isVeryNarrow && { width: '100%' }]}>
              <View
                style={[
                  styles.checkBadge,
                  { backgroundColor: isPassed ? 'rgba(16, 185, 129, 0.15)' : 'rgba(148, 163, 184, 0.12)' },
                ]}
              >
                <Text style={{ color: isPassed ? '#10B981' : '#94A3B8', fontSize: 11, fontWeight: '700' }}>
                  {isPassed ? '✓' : '○'}
                </Text>
              </View>
              <Text
                style={[
                  styles.ruleText,
                  { color: isPassed ? theme.colors.text : theme.colors.muted, fontWeight: isPassed ? '600' : '400' },
                ]}
              >
                {label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 4,
    marginBottom: 14,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
  },
  strengthRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  strengthLabel: { fontSize: 12, fontWeight: '600' },
  strengthValue: { fontSize: 12, fontWeight: '700' },
  meterTrack: { flexDirection: 'row', gap: 6, marginVertical: 2 },
  meterSegment: { flex: 1, height: 4, borderRadius: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  rule: { width: '48%', flexDirection: 'row', alignItems: 'center', gap: 6 },
  checkBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ruleText: { fontSize: 11, flex: 1, lineHeight: 15 },
});
