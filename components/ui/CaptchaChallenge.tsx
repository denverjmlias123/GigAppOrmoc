import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../app/theme';
import { TextInput } from './TextInput';

interface CaptchaChallengeProps {
  onSolved: (solved: boolean) => void;
  isSolved: boolean;
  required?: boolean;
}

export const CaptchaChallenge: React.FC<CaptchaChallengeProps> = ({
  onSolved,
  isSolved,
  required = false,
}) => {
  const theme = useAppTheme();
  const [num1, setNum1] = useState(0);
  const [num2, setNum2] = useState(0);
  const [operator, setOperator] = useState<'+' | '-'>('+');
  const [userAnswer, setUserAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);

  const generateChallenge = useCallback(() => {
    // Generate pseudo-random numbers using timestamps to prevent predictability
    const seed = Date.now() % 100;
    const a = (seed % 18) + 7;
    const b = ((seed * 3) % 9) + 2;
    const op = seed % 2 === 0 ? '+' : '-';
    setNum1(a);
    setNum2(b);
    setOperator(op);
    setUserAnswer('');
    setError(null);
    onSolved(false);
  }, [onSolved]);

  useEffect(() => {
    if (required) {
      generateChallenge();
    }
  }, [required, generateChallenge]);

  const expectedAnswer = operator === '+' ? num1 + num2 : num1 - num2;

  const handleAnswerChange = (val: string) => {
    setUserAnswer(val);
    setError(null);
    const parsed = parseInt(val.trim(), 10);
    if (!isNaN(parsed) && parsed === expectedAnswer) {
      onSolved(true);
    } else {
      onSolved(false);
      if (val.trim().length >= String(expectedAnswer).length && parsed !== expectedAnswer) {
        setError('Incorrect security answer. Try again.');
      }
    }
  };

  if (!required) return null;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isSolved ? theme.colors.successSoft : theme.colors.surfaceAlt,
          borderColor: isSolved ? theme.colors.success : error ? theme.colors.danger : theme.colors.border,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <Ionicons
            name={isSolved ? 'checkmark-circle' : 'shield-checkmark-outline'}
            size={18}
            color={isSolved ? theme.colors.success : theme.colors.primary}
          />
          <Text
            style={[
              styles.headerText,
              { color: isSolved ? theme.colors.successText : theme.colors.text },
            ]}
          >
            {isSolved ? 'Security Check Passed' : 'Security Check (CAPTCHA)'}
          </Text>
        </View>

        {!isSolved && (
          <Pressable
            onPress={generateChallenge}
            hitSlop={8}
            style={({ pressed }) => [styles.refreshBtn, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="Refresh security challenge"
          >
            <Ionicons name="refresh-outline" size={16} color={theme.colors.primary} />
            <Text style={[styles.refreshText, { color: theme.colors.primary }]}>New Challenge</Text>
          </Pressable>
        )}
      </View>

      {isSolved ? (
        <Text style={[styles.solvedText, { color: theme.colors.successText }]}>
          ✓ Security challenge solved. You may now proceed to log in.
        </Text>
      ) : (
        <View style={styles.challengeBody}>
          <Text style={[styles.hintText, { color: theme.colors.muted }]}>
            Repeated failed attempts detected. Solve the challenge below:
          </Text>

          <View style={[styles.mathDisplay, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Text style={[styles.mathText, { color: theme.colors.text }]}>
              {num1} {operator} {num2} = ?
            </Text>
          </View>

          <TextInput
            label="Enter Answer"
            value={userAnswer}
            onChangeText={handleAnswerChange}
            keyboardType="numeric"
            placeholder="Your answer"
            error={error}
            containerStyle={{ marginBottom: 0 }}
          />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
    marginBottom: 16,
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerText: {
    fontSize: 14,
    fontWeight: '700',
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  refreshText: {
    fontSize: 12,
    fontWeight: '600',
  },
  challengeBody: {
    gap: 8,
    marginTop: 4,
  },
  hintText: {
    fontSize: 13,
    lineHeight: 18,
  },
  mathDisplay: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  mathText: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  solvedText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
