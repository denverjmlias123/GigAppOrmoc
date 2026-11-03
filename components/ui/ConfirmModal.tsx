import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { AlertTriangle, ShieldCheck } from 'lucide-react-native';
import { colors, borderRadius, typography, spacing, shadows } from '../../lib/theme';

export interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDestructive = false,
  isLoading = false,
  onConfirm,
  onCancel,
}) => {
  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <View style={styles.modalContent}>
          <View
            style={[
              styles.topBar,
              { backgroundColor: isDestructive ? colors.danger : colors.primary },
            ]}
          />

          <View style={styles.headerRow}>
            <View
              style={[
                styles.iconCircle,
                isDestructive ? styles.iconDestructive : styles.iconPrimary,
              ]}
            >
              {isDestructive ? (
                <AlertTriangle size={22} color={colors.danger} />
              ) : (
                <ShieldCheck size={22} color={colors.primary} />
              )}
            </View>
            <View style={styles.headerTextCol}>
              <Text style={styles.securityTag}>
                {isDestructive ? 'CRITICAL ACTION CONFIRMATION' : 'VERIFIED CONTRACT ACTION'}
              </Text>
              <Text style={styles.title}>{title}</Text>
            </View>
          </View>

          <Text style={styles.message}>{message}</Text>

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={onCancel}
              disabled={isLoading}
              accessibilityRole="button"
            >
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.confirmButton,
                isDestructive ? styles.destructiveButton : styles.primaryButton,
                isLoading && styles.disabledButton,
              ]}
              onPress={onConfirm}
              disabled={isLoading}
              accessibilityRole="button"
            >
              {isLoading ? (
                <ActivityIndicator color={colors.textInverse} size="small" />
              ) : (
                <Text style={styles.confirmText}>{confirmLabel}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(11, 25, 44, 0.68)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalContent: {
    backgroundColor: colors.surface,
    width: '100%',
    maxWidth: 440,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    position: 'relative',
    overflow: 'hidden',
    ...shadows.modal,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 5,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
    marginTop: 4,
  },
  iconCircle: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  iconPrimary: {
    backgroundColor: colors.primarySurface,
    borderColor: colors.primaryBorder,
  },
  iconDestructive: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  headerTextCol: {
    flex: 1,
  },
  securityTag: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.textMuted,
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  title: {
    fontSize: typography.lg,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -0.2,
  },
  message: {
    fontSize: typography.base,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.xl,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm + 2,
  },
  cancelButton: {
    paddingVertical: spacing.sm + 3,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    fontSize: typography.base,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  confirmButton: {
    paddingVertical: spacing.sm + 3,
    paddingHorizontal: spacing.lg + 2,
    borderRadius: borderRadius.lg,
    minWidth: 112,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  disabledButton: {
    opacity: 0.7,
  },
  primaryButton: {
    backgroundColor: colors.primary,
  },
  destructiveButton: {
    backgroundColor: colors.danger,
  },
  confirmText: {
    fontSize: typography.base,
    fontWeight: '700',
    color: colors.textInverse,
  },
});

export default ConfirmModal;
