import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
} from 'react-native';
import { Mail, ChevronDown, ChevronUp, Copy, CheckCircle, X, Inbox } from 'lucide-react-native';
import { useSegments } from 'expo-router';
import { callRpc } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../lib/theme';

interface InboxMessage {
  id: string;
  otp_challenge_id?: string;
  subject: string;
  recipient_email: string;
  purpose: string;
  otp_code_display: string;
  expires_at: string;
  is_read: boolean;
  created_at: string;
}

export const ProjectMailInbox: React.FC = () => {
  const { profile, activeInboxEmail, activeChallengeId, setActiveInboxContext } = useAuth();
  const segments = useSegments();
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<InboxMessage | null>(null);

  // On web, also check window.location.search if present to capture parameters directly
  let urlEmail: string | null = null;
  let urlChallenge: string | null = null;
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.search) {
    try {
      const sp = new URLSearchParams(window.location.search);
      urlEmail = sp.get('email');
      urlChallenge = sp.get('challengeId') || sp.get('challenge_id');
    } catch {
      // ignore
    }
  }

  // Determine effective recipient email for evaluation inbox
  const effectiveEmail =
    urlEmail ||
    activeInboxEmail ||
    profile?.email ||
    (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage
      ? window.localStorage.getItem('gigormoc_inbox_email') ||
        window.localStorage.getItem('gigormoc_confirm_email') ||
        window.localStorage.getItem('gigormoc_signup_email') ||
        null
      : null);

  const effectiveChallengeId =
    urlChallenge ||
    activeChallengeId ||
    (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage
      ? window.localStorage.getItem('gigormoc_inbox_challenge') || null
      : null);

  // The Project Mail Inbox should ONLY appear when actively getting an OTP:
  // e.g. on confirm-email, forgot-password, or settings/email with an active challenge.
  const path = segments.join('/');
  const isConfirmEmailRoute = path.includes('confirm-email');
  const isForgotPasswordRoute = path.includes('forgot-password');
  const isEmailSettingsRoute = path.includes('settings') && path.includes('email');
  const isOtpScreen = isConfirmEmailRoute || isForgotPasswordRoute || isEmailSettingsRoute;

  // Once OTP is applied/verified, or when not on an OTP receiving screen, hide completely
  const isEmailAlreadyVerified = Boolean(profile?.email_verified);
  const shouldHide =
    !isOtpScreen ||
    (isConfirmEmailRoute && isEmailAlreadyVerified && !effectiveChallengeId);

  const fetchMessages = useCallback(async () => {
    if (shouldHide || (!effectiveEmail && !effectiveChallengeId)) {
      return;
    }

    try {
      const res = await callRpc<InboxMessage[]>('rpc_get_project_inbox_messages', {
        p_recipient_email: effectiveEmail || null,
        p_challenge_id: effectiveChallengeId || null,
      });

      if (Array.isArray(res)) {
        // Filter out expired messages
        const valid = res.filter((m) => new Date(m.expires_at).getTime() > Date.now());
        setMessages(valid);

        if (valid.length > 0) {
          const latest = valid[0];

          // If activeChallengeId wasn't known, save it into auth context
          if (!activeChallengeId && latest.otp_challenge_id) {
            setActiveInboxContext(effectiveEmail || latest.recipient_email, latest.otp_challenge_id);
          }

          // Trigger push banner for latest message if fresh (< 30s)
          if (!bannerMessage && !isEmailAlreadyVerified) {
            const ageSeconds = (Date.now() - new Date(latest.created_at).getTime()) / 1000;
            if (ageSeconds < 30) {
              setBannerMessage(latest);
              setTimeout(() => setBannerMessage(null), 8000);
            }
          }
        }
      }
    } catch (err) {
      // Quiet fail if not in unauth/auth inbox context
    }
  }, [shouldHide, effectiveEmail, effectiveChallengeId, activeChallengeId, bannerMessage, isEmailAlreadyVerified, setActiveInboxContext]);

  useEffect(() => {
    if (shouldHide) {
      setMessages([]);
      return;
    }
    fetchMessages();
    const interval = setInterval(fetchMessages, 3000); // Poll every 3 seconds only on OTP screens
    return () => clearInterval(interval);
  }, [shouldHide, fetchMessages]);

  const handleCopy = (code: string, id: string) => {
    setCopiedId(id);
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(code);
    }
    setTimeout(() => setCopiedId(null), 2500);
  };

  // Only hide completely if shouldHide is true
  if (shouldHide) {
    return null;
  }

  return (
    <View style={styles.floatingWrapper} pointerEvents="box-none">
      {/* Top Push Notification Banner */}
      {bannerMessage && (
        <TouchableOpacity
          style={styles.pushBanner}
          onPress={() => setIsExpanded(true)}
          activeOpacity={0.9}
        >
          <View style={styles.bannerIcon}>
            <Mail size={18} color="#FFFFFF" />
          </View>
          <View style={styles.bannerContent}>
            <Text style={styles.bannerTitle}>New Project Email Received</Text>
            <Text style={styles.bannerSubtitle}>
              {bannerMessage.subject} • Code: {bannerMessage.otp_code_display}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.dismissBannerBtn}
            onPress={() => setBannerMessage(null)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <X size={16} color="#FFFFFF" />
          </TouchableOpacity>
        </TouchableOpacity>
      )}

      {/* Top Pull-Down Drawer Trigger Bar */}
      <View style={styles.drawerBarContainer}>
        <TouchableOpacity
          style={styles.drawerHeader}
          onPress={() => setIsExpanded(!isExpanded)}
          activeOpacity={0.8}
        >
          <View style={styles.headerLeft}>
            <Mail size={16} color={colors.primary} />
            <Text style={styles.headerTitle}>
              Project Mail Inbox ({messages.length})
            </Text>
            {messages.length > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{messages.length}</Text>
              </View>
            )}
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.pullDownHint}>
              {isExpanded ? 'Push up' : 'Pull down'}
            </Text>
            {isExpanded ? (
              <ChevronUp size={18} color={colors.textSecondary} />
            ) : (
              <ChevronDown size={18} color={colors.textSecondary} />
            )}
            {isExpanded && (
              <TouchableOpacity
                style={styles.dismissHeaderBtn}
                onPress={(e) => {
                  e.stopPropagation();
                  setIsExpanded(false);
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <X size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>

        {/* Expanded Drawer Content */}
        {isExpanded && (
          <View style={styles.drawerBody}>
            <Text style={styles.demoNotice}>
              Simulated In-App Email Client (IAS 1 Evaluator Mailbox)
            </Text>
            {messages.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Inbox size={28} color={colors.textMuted} />
                <Text style={styles.emptyTitle}>No messages received yet</Text>
                <Text style={styles.emptySubtitle}>
                  Verification codes and notifications sent to{' '}
                  <Text style={styles.boldEmail}>{effectiveEmail || 'your email'}</Text> will
                  appear here automatically.
                </Text>
              </View>
            ) : (
              <ScrollView style={styles.messageList} nestedScrollEnabled>
                {messages.map((msg) => {
                  const expiresAt = new Date(msg.expires_at).getTime();
                  const now = Date.now();
                  const remainingSecs = Math.max(0, Math.floor((expiresAt - now) / 1000));
                  const mins = Math.floor(remainingSecs / 60);
                  const secs = remainingSecs % 60;
                  const isExpired = remainingSecs === 0;

                  return (
                    <View key={msg.id} style={styles.messageCard}>
                      <View style={styles.messageCardHeader}>
                        <Text style={styles.messageSubject}>{msg.subject}</Text>
                        <Text
                          style={[
                            styles.timerText,
                            isExpired ? styles.timerExpired : styles.timerActive,
                          ]}
                        >
                          {isExpired ? 'Expired' : `${mins}:${secs < 10 ? '0' : ''}${secs}`}
                        </Text>
                      </View>
                      <Text style={styles.recipientText}>To: {msg.recipient_email}</Text>

                      <View style={styles.codeRow}>
                        <Text style={styles.otpCode}>{msg.otp_code_display}</Text>
                        <TouchableOpacity
                          style={styles.copyButton}
                          onPress={() => handleCopy(msg.otp_code_display, msg.id)}
                        >
                          {copiedId === msg.id ? (
                            <CheckCircle size={14} color={colors.primary} />
                          ) : (
                            <Copy size={14} color={colors.textSecondary} />
                          )}
                          <Text style={styles.copyButtonText}>
                            {copiedId === msg.id ? 'Copied!' : 'Copy Code'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  floatingWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
  },
  pushBanner: {
    position: 'absolute',
    top: 56,
    left: 16,
    right: 16,
    maxWidth: 520,
    alignSelf: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 10,
    gap: 12,
    zIndex: 10001,
  },
  bannerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerContent: {
    flex: 1,
  },
  bannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  bannerSubtitle: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.9)',
  },
  drawerBarContainer: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 10000,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  badge: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pullDownHint: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  dismissHeaderBtn: {
    padding: 2,
    marginLeft: 4,
  },
  dismissBannerBtn: {
    padding: 4,
    marginLeft: 4,
  },
  drawerBody: {
    maxHeight: 280,
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  demoNotice: {
    fontSize: 11,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginBottom: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 6,
  },
  emptyTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  emptySubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 16,
  },
  boldEmail: {
    fontWeight: '700',
    color: colors.primary,
  },
  messageList: {
    maxHeight: 220,
  },
  messageCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  messageCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  messageSubject: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
  },
  timerText: {
    fontSize: 11,
    fontWeight: '700',
  },
  timerActive: {
    color: colors.success,
  },
  timerExpired: {
    color: colors.danger,
  },
  recipientText: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  codeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  otpCode: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 4,
    color: colors.primary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  copyButtonText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
  },
});
