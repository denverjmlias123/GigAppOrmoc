import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { RotateCw, ShieldAlert } from 'lucide-react-native';
import { callRpc } from '../../lib/supabase';
import { colors, borderRadius, spacing, typography } from '../../lib/theme';

interface VisualCaptchaProps {
  identifier: string;
  onCaptchaChange: (code: string) => void;
}

export const VisualCaptcha: React.FC<VisualCaptchaProps> = ({
  identifier,
  onCaptchaChange,
}) => {
  const [captchaText, setCaptchaText] = useState<string>('------');
  const [userInput, setUserInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const fetchCaptcha = useCallback(async () => {
    if (!identifier) return;
    setIsLoading(true);
    try {
      const res = await callRpc<{ ok: boolean; captcha_code?: string }>('rpc_generate_captcha', {
        p_identifier: identifier,
      });
      if (res.ok && res.captcha_code) {
        setCaptchaText(res.captcha_code);
        setUserInput('');
        onCaptchaChange('');
      }
    } catch (err) {
      console.warn('Failed to fetch CAPTCHA:', err);
    } finally {
      setIsLoading(false);
    }
  }, [identifier, onCaptchaChange]);

  useEffect(() => {
    fetchCaptcha();
  }, [fetchCaptcha]);

  const handleChange = (text: string) => {
    const val = text.toUpperCase();
    setUserInput(val);
    onCaptchaChange(val);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <ShieldAlert size={14} color={colors.danger} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerText}>IAS 1 Anti-Automation Challenge</Text>
          <Text style={styles.headerSubtext}>
            Enter the 6-character code below to verify human access
          </Text>
        </View>
      </View>

      <View style={styles.captchaRow}>
        <View style={styles.captchaBox}>
          {captchaText.split('').map((char, index) => {
            const rot = ((index * 7 + 3) % 25) - 12;
            const offset = ((index * 5) % 8) - 4;
            return (
              <Text
                key={index}
                style={[
                  styles.captchaChar,
                  {
                    transform: [{ rotate: `${rot}deg` }, { translateY: offset }],
                  },
                ]}
              >
                {char}
              </Text>
            );
          })}
          <View style={styles.noiseLine} />
          <View style={styles.noiseLineAlt} />
        </View>

        <TouchableOpacity
          style={styles.refreshButton}
          onPress={fetchCaptcha}
          disabled={isLoading}
          accessibilityLabel="Refresh CAPTCHA code"
        >
          <RotateCw size={18} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.input}
        placeholder="TYPE 6-CHARACTER CODE"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={6}
        value={userInput}
        onChangeText={handleChange}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFF5F5',
    borderWidth: 1.5,
    borderColor: '#FECACA',
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    marginVertical: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  headerIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    fontSize: typography.xs + 1,
    fontWeight: '800',
    color: '#991B1B',
  },
  headerSubtext: {
    fontSize: 11,
    color: '#B91C1C',
  },
  captchaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  captchaBox: {
    flex: 1,
    height: 52,
    backgroundColor: '#0F172A',
    borderRadius: borderRadius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 14,
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#334155',
  },
  captchaChar: {
    fontSize: 22,
    fontWeight: '900',
    color: '#38BDF8',
    letterSpacing: 3,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  noiseLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 24,
    height: 1.5,
    backgroundColor: 'rgba(248, 250, 252, 0.3)',
    transform: [{ rotate: '-4deg' }],
  },
  noiseLineAlt: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 30,
    height: 1,
    backgroundColor: 'rgba(56, 189, 248, 0.35)',
    transform: [{ rotate: '3deg' }],
  },
  refreshButton: {
    width: 48,
    height: 52,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
    borderRadius: borderRadius.lg,
    paddingHorizontal: 12,
    height: 46,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 4,
    color: colors.textPrimary,
    textAlign: 'center',
  },
});

export default VisualCaptcha;
