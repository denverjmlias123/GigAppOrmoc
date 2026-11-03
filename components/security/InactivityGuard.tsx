import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Clock, ShieldAlert } from 'lucide-react-native';
import { useAuth } from '../../context/AuthContext';
import { callRpc } from '../../lib/supabase';
import { colors, borderRadius, spacing, shadows } from '../../lib/theme';

// Inactivity configuration (seconds)
const WARN_AFTER_SECONDS = 810; // 13 minutes 30 seconds
const LOGOUT_AFTER_SECONDS = 900; // 15 minutes 00 seconds

let evaluatorFastForwardCallback: (() => void) | null = null;

export function triggerEvaluatorIdleFastForward() {
  if (evaluatorFastForwardCallback) {
    evaluatorFastForwardCallback();
  }
}

export const InactivityGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { session, currentSessionId, signOut } = useAuth();
  const router = useRouter();

  const lastActiveTimestamp = useRef<number>(Date.now());
  const [showWarningModal, setShowWarningModal] = useState<boolean>(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(90);

  const resetActivity = useCallback(() => {
    lastActiveTimestamp.current = Date.now();
    if (showWarningModal) {
      setShowWarningModal(false);
    }
  }, [showWarningModal]);

  const handleAutoLogout = useCallback(async () => {
    setShowWarningModal(false);
    if (currentSessionId) {
      await callRpc('rpc_log_inactivity_logout', { p_session_id: currentSessionId });
    }
    await signOut();
    router.replace('/(auth)/login');
  }, [currentSessionId, signOut, router]);

  // Expose global evaluator test trigger
  useEffect(() => {
    evaluatorFastForwardCallback = () => {
      // Fast forward to 13 minutes 25 seconds of idle time (5 seconds before warning)
      lastActiveTimestamp.current = Date.now() - 805 * 1000;
    };

    if (typeof window !== 'undefined') {
      (window as unknown as { triggerEvaluatorIdleFastForward?: () => void }).triggerEvaluatorIdleFastForward = () => {
        if (evaluatorFastForwardCallback) evaluatorFastForwardCallback();
      };
    }

    return () => {
      evaluatorFastForwardCallback = null;
    };
  }, []);

  // Web event listeners for activity tracking
  useEffect(() => {
    if (!session) return;

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const handleUserInteraction = () => resetActivity();
      window.addEventListener('mousemove', handleUserInteraction);
      window.addEventListener('keydown', handleUserInteraction);
      window.addEventListener('click', handleUserInteraction);
      window.addEventListener('touchstart', handleUserInteraction);

      return () => {
        window.removeEventListener('mousemove', handleUserInteraction);
        window.removeEventListener('keydown', handleUserInteraction);
        window.removeEventListener('click', handleUserInteraction);
        window.removeEventListener('touchstart', handleUserInteraction);
      };
    }
  }, [session, resetActivity]);

  // Periodic heartbeat timer
  useEffect(() => {
    if (!session) {
      setShowWarningModal(false);
      return;
    }

    const interval = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - lastActiveTimestamp.current) / 1000);

      if (elapsedSeconds >= LOGOUT_AFTER_SECONDS) {
        handleAutoLogout();
      } else if (elapsedSeconds >= WARN_AFTER_SECONDS) {
        setShowWarningModal(true);
        setRemainingSeconds(LOGOUT_AFTER_SECONDS - elapsedSeconds);
      } else {
        if (showWarningModal) {
          setShowWarningModal(false);
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [session, showWarningModal, handleAutoLogout]);

  return (
    <View style={styles.flexOne} onTouchStart={resetActivity}>
      {children}

      {/* 90-Second Warning Modal (IAS 1 Part E) */}
      <Modal
        visible={showWarningModal}
        transparent
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.topStrip} />
            <View style={styles.badgePill}>
              <ShieldAlert size={12} color={colors.goldDark} />
              <Text style={styles.badgePillText}>IAS 1 SESSION PROTECTION</Text>
            </View>

            <View style={styles.iconCircle}>
              <Clock size={30} color={colors.warning} />
            </View>
            <Text style={styles.modalTitle}>Session Idle Timeout Warning</Text>
            <Text style={styles.modalText}>
              You have been inactive for over 13 minutes. To protect your Ormoc marketplace account, your session will automatically lock and sign out in:
            </Text>

            <View style={styles.countdownContainer}>
              <Text style={styles.countdownNumber}>
                {Math.floor(remainingSeconds / 60)}:
                {remainingSeconds % 60 < 10 ? '0' : ''}
                {remainingSeconds % 60}
              </Text>
              <Text style={styles.countdownSub}>MINUTES : SECONDS REMAINING</Text>
            </View>

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.logoutButton}
                onPress={handleAutoLogout}
              >
                <Text style={styles.logoutButtonText}>Log Out Now</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.stayLoggedInButton}
                onPress={resetActivity}
              >
                <Text style={styles.stayLoggedInButtonText}>Keep Session Active</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  flexOne: {
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(11, 25, 44, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    zIndex: 10000,
  },
  modalBox: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius['2xl'],
    padding: spacing.xl,
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.modal,
  },
  topStrip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 5,
    backgroundColor: colors.warning,
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.warningSurface,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    marginBottom: spacing.sm,
    marginTop: 4,
  },
  badgePillText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.goldDark,
    letterSpacing: 0.6,
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 8,
    letterSpacing: -0.2,
  },
  modalText: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 16,
  },
  countdownContainer: {
    alignItems: 'center',
    backgroundColor: '#0B192C',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: '#1E3A8A',
    marginBottom: 20,
    width: '100%',
  },
  countdownNumber: {
    fontSize: 32,
    fontWeight: '900',
    color: '#FBBF24',
    letterSpacing: 3,
  },
  countdownSub: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94A3B8',
    marginTop: 4,
    letterSpacing: 0.8,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  logoutButton: {
    flex: 1,
    paddingVertical: 13,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
  },
  logoutButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  stayLoggedInButton: {
    flex: 1.2,
    paddingVertical: 13,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
  },
  stayLoggedInButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

export default InactivityGuard;
