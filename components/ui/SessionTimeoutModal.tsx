import React from 'react';
import { View, Text, StyleSheet, Modal, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../app/theme';
import { Button } from './Button';

interface SessionTimeoutModalProps {
  visible: boolean;
  secondsRemaining: number;
  onExtend: () => void;
  onSignOut: () => void;
}

export const SessionTimeoutModal: React.FC<SessionTimeoutModalProps> = ({
  visible,
  secondsRemaining,
  onExtend,
  onSignOut,
}) => {
  const theme = useAppTheme();

  if (!visible) return null;

  const formattedSeconds = String(Math.max(0, secondsRemaining)).padStart(2, '0');

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={onExtend}
    >
      <View style={styles.backdrop}>
        <View
          style={[
            styles.dialogCard,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
            },
            theme.shadow.raised,
          ]}
        >
          <View style={[styles.iconCircle, { backgroundColor: theme.colors.warningSoft }]}>
            <Ionicons name="time-outline" size={32} color={theme.colors.warningText} />
          </View>

          <Text style={[styles.title, { color: theme.colors.text }]}>
            Session Inactivity Warning
          </Text>

          <Text style={[styles.message, { color: theme.colors.muted }]}>
            You have been inactive. To protect your account security, your session will automatically expire in:
          </Text>

          <View style={[styles.countdownBox, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border }]}>
            <Text style={[styles.countdownText, { color: theme.colors.danger }]}>
              00:{formattedSeconds}
            </Text>
          </View>

          <View style={styles.actionsColumn}>
            <Button
              title="Stay Logged In"
              variant="primary"
              icon="refresh-outline"
              fullWidth
              onPress={onExtend}
            />
            <Button
              title="Log Out Now"
              variant="secondary"
              icon="log-out-outline"
              fullWidth
              onPress={onSignOut}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 9999,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 460,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 16,
  },
  countdownBox: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 20,
  },
  countdownText: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  actionsColumn: {
    width: '100%',
    gap: 10,
  },
});
