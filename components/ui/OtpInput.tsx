import React, { useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, TextInput as RNTextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../app/theme';
import { strings } from '../../constants/strings';

interface OtpInputProps {
  value: string;
  onChangeText: (code: string) => void;
  length?: number;
  error?: string | null;
  disabled?: boolean;
  onComplete?: (code: string) => void;
  label?: string;
  onPasteSuccess?: () => void;
}

export const OtpInput: React.FC<OtpInputProps> = ({
  value,
  onChangeText,
  length = 8,
  error,
  disabled = false,
  onComplete,
  label = strings.auth.otpCodeLabel,
  onPasteSuccess,
}) => {
  const theme = useAppTheme();
  const inputRef = useRef<RNTextInput>(null);

  const activeLength = length;
  const cleanValue = value.replace(/\D/g, '').slice(0, activeLength);
  const digits = Array.from({ length: activeLength }, (_, i) => cleanValue[i] || '');

  const handleChange = (rawText: string) => {
    const cleaned = rawText.replace(/\D/g, '').slice(0, activeLength);
    onChangeText(cleaned);
    if (cleaned.length === activeLength && onComplete) {
      onComplete(cleaned);
    }
  };

  const handlePasteFromClipboard = async () => {
    if (disabled) return;
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        const extracted = text.replace(/\D/g, '').slice(0, activeLength);
        if (extracted) {
          onChangeText(extracted);
          onPasteSuccess?.();
          if (extracted.length >= 6 && onComplete) {
            onComplete(extracted);
          }
          return;
        }
      }
    } catch {}
    // Focus input so native paste / keyboard suggestion appears
    inputRef.current?.focus();
  };

  const handleBoxPress = () => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  };

  const isCompact = activeLength > 6;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={[styles.label, { color: theme.colors.text }]}>{label}</Text>
        <Pressable
          onPress={handlePasteFromClipboard}
          disabled={disabled}
          hitSlop={6}
          style={({ pressed }) => [
            styles.pasteBtn,
            { backgroundColor: theme.colors.primarySoft },
            pressed && { opacity: 0.8 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={strings.auth.otpPasteButton}
        >
          <Ionicons name="clipboard-outline" size={14} color={theme.colors.primary} />
          <Text style={[styles.pasteBtnText, { color: theme.colors.primary }]}>
            {strings.auth.otpPasteButton}
          </Text>
        </Pressable>
      </View>

      <Pressable onPress={handleBoxPress} style={[styles.boxesRow, isCompact && styles.boxesRowCompact]} accessibilityRole="none">
        {digits.map((digit, index) => {
          const isCurrent = cleanValue.length === index;
          const isFilled = digit.length > 0;
          const borderColor = error
            ? theme.colors.danger
            : isCurrent
            ? theme.colors.primary
            : isFilled
            ? theme.colors.border
            : theme.colors.border;

          return (
            <View
              key={index}
              style={[
                styles.box,
                isCompact && styles.boxCompact,
                {
                  borderColor,
                  borderWidth: isCurrent || error ? 2 : 1,
                  backgroundColor: isCurrent ? theme.colors.surface : theme.colors.surfaceAlt,
                  borderRadius: theme.radii.input,
                },
              ]}
            >
              <Text style={[styles.digitText, isCompact && styles.digitTextCompact, { color: theme.colors.text }]}>
                {digit}
              </Text>
            </View>
          );
        })}
      </Pressable>

      {/* Hidden input overlay that handles keyboard typing and native clipboard paste */}
      <RNTextInput
        ref={inputRef}
        value={cleanValue}
        onChangeText={handleChange}
        maxLength={activeLength}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        editable={!disabled}
        style={styles.hiddenInput}
        caretHidden
        accessibilityLabel={label}
      />

      {error ? (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle" size={14} color={theme.colors.dangerText} style={{ marginTop: 1 }} />
          <Text style={[styles.errorText, { color: theme.colors.dangerText }]}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 12,
    position: 'relative',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  pasteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  pasteBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  boxesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    maxWidth: 460,
    width: '100%',
    alignSelf: 'center',
  },
  boxesRowCompact: {
    gap: 6,
  },
  box: {
    flex: 1,
    maxWidth: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxCompact: {
    maxWidth: 48,
    height: 50,
  },
  digitText: {
    fontSize: 22,
    fontWeight: '800',
  },
  digitTextCompact: {
    fontSize: 19,
  },
  hiddenInput: {
    position: 'absolute',
    top: 28,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.01,
    height: 56,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    marginTop: 4,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
    lineHeight: 16,
  },
});
