import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput as RNTextInput,
  StyleSheet,
  Pressable,
  TextInputProps,
  Platform,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../app/theme';
import { strings } from '../../constants/strings';

interface Props extends TextInputProps {
  label?: string;
  error?: string | null;
  helperText?: string;
  isPassword?: boolean;
  prefixText?: string;
  leftIcon?: React.ComponentProps<typeof Ionicons>['name'];
  onClear?: () => void;
  showCharCount?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
}

export const TextInput = React.forwardRef<RNTextInput, Props>(function TextInput(
  {
    label = '',
    error,
    helperText,
    isPassword = false,
    prefixText,
    leftIcon,
    onClear,
    showCharCount = false,
    containerStyle,
    style,
    onFocus,
    onBlur,
    ...props
  },
  ref
) {
  const theme = useAppTheme();
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? theme.colors.danger
    : focused
    ? theme.colors.primary
    : theme.colors.border;

  const baseKey = (label || props.placeholder || 'input').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const safeId = (props as any).id || props.nativeID || `field-${baseKey}`;
  const safeName = (props as any).name || baseKey.replace(/-/g, '_');

  let normalizedAutoComplete = props.autoComplete;
  if (Platform.OS === 'web' && normalizedAutoComplete === ('password' as any)) {
    normalizedAutoComplete = 'current-password';
  }

  const currentLen = typeof props.value === 'string' ? props.value.length : 0;

  return (
    <View style={[styles.container, containerStyle]}>
      {label || (showCharCount && props.maxLength) ? (
        <View style={styles.labelRow}>
          {label ? <Text style={[styles.label, { color: theme.colors.text }]}>{label}</Text> : <View />}
          {showCharCount && props.maxLength ? (
            <Text style={[styles.charCount, { color: theme.colors.muted }]}>
              {currentLen}/{props.maxLength}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View
        style={[
          styles.inputBox,
          {
            borderColor,
            borderWidth: 1,
            backgroundColor: focused ? theme.colors.surface : theme.colors.surfaceAlt,
            borderRadius: theme.radii.input,
            ...(Platform.OS === 'web' && focused
              ? ({ boxShadow: `0 0 0 3px ${theme.colors.focusRing}` } as any)
              : null),
          },
        ]}
      >
        {leftIcon ? (
          <View style={styles.leftAdornment}>
            <Ionicons
              name={leftIcon}
              size={18}
              color={focused ? theme.colors.primary : theme.colors.muted}
            />
          </View>
        ) : null}
        {prefixText ? (
          <View
            style={[
              styles.prefixPill,
              { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.border },
            ]}
          >
            <Text style={[styles.prefixText, { color: theme.colors.primary }]}>{prefixText}</Text>
          </View>
        ) : null}
        <RNTextInput
          ref={ref}
          nativeID={safeId}
          accessibilityLabel={label || props.placeholder}
          autoComplete={normalizedAutoComplete}
          {...(Platform.OS === 'web' ? { id: safeId, name: safeName } : null)}
          style={[
            styles.input,
            {
              color: theme.colors.text,
              ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null),
            },
            Boolean(leftIcon) && { paddingLeft: 6 },
            Boolean(prefixText) && { paddingLeft: 10 },
            (isPassword || Boolean(onClear && props.value)) && styles.passwordInput,
            style,
          ]}
          placeholderTextColor={theme.colors.muted}
          secureTextEntry={isPassword && !showPassword}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...props}
        />
        {!isPassword && onClear && Boolean(props.value) ? (
          <Pressable
            style={styles.toggleBtn}
            onPress={onClear}
            accessibilityRole="button"
            accessibilityLabel="Clear text"
            hitSlop={8}
          >
            <Ionicons name="close-circle" size={19} color={theme.colors.muted} />
          </Pressable>
        ) : null}
        {isPassword ? (
          <Pressable
            style={styles.toggleBtn}
            onPress={() => setShowPassword(!showPassword)}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? strings.auth.passwordHide : strings.auth.passwordShow}
            hitSlop={8}
          >
            <Ionicons
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={22}
              color={theme.colors.muted}
            />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <View style={styles.errorRow}>
          <Ionicons
            name="alert-circle"
            size={14}
            color={theme.colors.dangerText}
            style={{ marginTop: 1 }}
          />
          <Text style={[styles.error, { color: theme.colors.dangerText }]}>{error}</Text>
        </View>
      ) : helperText ? (
        <Text style={[styles.helper, { color: theme.colors.muted }]}>{helperText}</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  label: { fontSize: 14, lineHeight: 18, fontWeight: '700', letterSpacing: 0.1 },
  charCount: { fontSize: 12, lineHeight: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  inputBox: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 54,
  },
  leftAdornment: {
    paddingLeft: 12,
    paddingRight: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  prefixPill: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  prefixText: {
    fontSize: 14,
    fontWeight: '800',
  },
  input: {
    flex: 1,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
  },
  passwordInput: { paddingRight: 52 },
  toggleBtn: {
    position: 'absolute',
    right: 6,
    top: 4,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    marginTop: 4,
  },
  error: { fontSize: 12, fontWeight: '600', flex: 1, lineHeight: 16 },
  helper: { fontSize: 12, marginTop: 4 },
});
