import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Check, Circle, ShieldCheck } from 'lucide-react-native';
import { validatePassword, PasswordValidationResult } from '../../lib/passwordValidation';
import { colors, borderRadius, typography, spacing } from '../../lib/theme';

export { validatePassword, PasswordValidationResult };

interface PasswordChecklistProps {
  password: string;
}

export const PasswordChecklist: React.FC<PasswordChecklistProps> = ({ password }) => {
  const checks = validatePassword(password);

  const rules = [
    { label: 'At least 8 characters', satisfied: checks.minLength },
    { label: 'At least one uppercase letter (A-Z)', satisfied: checks.hasUpper },
    { label: 'At least one lowercase letter (a-z)', satisfied: checks.hasLower },
    { label: 'At least one number (0-9)', satisfied: checks.hasNumber },
    { label: 'At least one special character (!@#$%^&*)', satisfied: checks.hasSpecial },
  ];

  const passedCount = rules.filter((r) => r.satisfied).length;
  const strengthLabel =
    passedCount === 5
      ? 'Strong (IAS 1 Compliant)'
      : passedCount >= 3
      ? 'Moderate'
      : passedCount >= 1
      ? 'Weak'
      : 'Enter Password';
  const strengthColor =
    passedCount === 5
      ? colors.success
      : passedCount >= 3
      ? colors.warning
      : passedCount >= 1
      ? colors.danger
      : colors.textMuted;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <ShieldCheck size={15} color={passedCount === 5 ? colors.success : colors.primary} />
          <Text style={styles.title}>Password Security Policy</Text>
        </View>
        <Text style={[styles.strengthBadge, { color: strengthColor }]}>
          {strengthLabel} ({passedCount}/5)
        </Text>
      </View>

      {/* Segmented Strength Bar */}
      <View style={styles.segmentsRow}>
        {[1, 2, 3, 4, 5].map((step) => (
          <View
            key={step}
            style={[
              styles.segment,
              step <= passedCount
                ? { backgroundColor: strengthColor }
                : { backgroundColor: colors.border },
            ]}
          />
        ))}
      </View>

      <View style={styles.rulesList}>
        {rules.map((rule, index) => (
          <View key={index} style={styles.ruleRow}>
            <View
              style={[
                styles.checkIconBox,
                rule.satisfied ? styles.checkBoxSatisfied : styles.checkBoxPending,
              ]}
            >
              {rule.satisfied ? (
                <Check size={11} color="#FFFFFF" />
              ) : (
                <Circle size={8} color={colors.textMuted} />
              )}
            </View>
            <Text
              style={[
                styles.ruleText,
                rule.satisfied ? styles.ruleSatisfied : styles.rulePending,
              ]}
            >
              {rule.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surfaceSecondary,
    padding: spacing.md,
    borderRadius: borderRadius.xl,
    marginVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs + 2,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontSize: typography.xs + 1,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  strengthBadge: {
    fontSize: 11,
    fontWeight: '700',
  },
  segmentsRow: {
    flexDirection: 'row',
    gap: 5,
    marginBottom: spacing.sm + 2,
  },
  segment: {
    flex: 1,
    height: 5,
    borderRadius: 3,
  },
  rulesList: {
    gap: 5,
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkIconBox: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxSatisfied: {
    backgroundColor: colors.success,
  },
  checkBoxPending: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ruleText: {
    fontSize: typography.xs + 1,
  },
  ruleSatisfied: {
    color: '#15803D',
    fontWeight: '700',
  },
  rulePending: {
    color: colors.textSecondary,
  },
});

export default PasswordChecklist;
