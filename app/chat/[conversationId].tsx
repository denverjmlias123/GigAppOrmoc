import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { useAuth } from '../../hooks/useAuth';
import { chatService, MessageItem, ConversationItem, ConversationSummary } from '../../services/chat';
import { applicationsService } from '../../services/applications';
import { Button, IconButton } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Avatar } from '../../components/ui/Avatar';
import { showToast } from '../../components/ui/Toast';
import { mapSqlErrorToFriendlyMessage, strings } from '../../constants/strings';

export default function ChatScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { isWide, insets } = useResponsiveLayout();
  const { conversationId, partnerName } = useLocalSearchParams<{
    conversationId: string;
    partnerName: string;
  }>();
  const { user } = useAuth();

  const [conversation, setConversation] = useState<ConversationItem | null>(null);
  const [linkedAgreementId, setLinkedAgreementId] = useState<string | null>(null);
  const [linkedGigId, setLinkedGigId] = useState<string | null>(null);
  const [currentGigTitle, setCurrentGigTitle] = useState<string>('');
  const [relatedThreads, setRelatedThreads] = useState<ConversationSummary[]>([]);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const flatListRef = useRef<FlatList>(null);
  const readFailureNotifiedRef = useRef(false);

  useEffect(() => {
    if (!conversationId) return;

    let unsubscribe: (() => void) | undefined;
    let unsubscribeConversation: (() => void) | undefined;

    const loadChat = async () => {
      setLoading(true);
      setError(null);
      try {
        const [convData, msgList, convSummaries, myAgreements] = await Promise.all([
          chatService.getConversation(conversationId),
          chatService.getMessages(conversationId),
          chatService.getUserConversations(),
          applicationsService.getMyAgreements(),
        ]);
        if (!convData) {
          setError('Conversation not found or access denied.');
          return;
        }
        setConversation(convData);
        setMessages(msgList);
        unsubscribeConversation = chatService.subscribeToConversationChanges(conversationId, (change) => {
          setConversation((current) => current ? { ...current, ...change } : current);
          if (change.closed_at) showToast(strings.errors.deletedConversationReadOnly, 'info');
        });

        const matchingSummary = convSummaries.find((s) => s.id === conversationId);
        const gigId = matchingSummary?.gig_id || null;
        setLinkedGigId(gigId);
        setCurrentGigTitle(matchingSummary?.gig_title || '');

        const partnerId =
          matchingSummary?.partner_id ||
          (user?.id === convData?.client_id ? convData?.freelancer_id : convData?.client_id);

        if (partnerId) {
          const others = convSummaries.filter(
            (s) => s.partner_id === partnerId && s.id !== conversationId
          );
          setRelatedThreads(others);
        }

        if (gigId) {
          const matchingAgr = myAgreements.find((a) => a.gig_id === gigId);
          setLinkedAgreementId(matchingAgr?.id || null);
        }

        // Mark conversation read
        const markConversationRead = async () => {
          try {
            await chatService.markConversationRead(conversationId);
            readFailureNotifiedRef.current = false;
          } catch {
            if (!readFailureNotifiedRef.current) {
              readFailureNotifiedRef.current = true;
              showToast(strings.errors.conversationReadFailed, 'error');
            }
          }
        };
        void markConversationRead();

        // Subscribe to real-time incoming messages
        unsubscribe = chatService.subscribeToMessages(conversationId, (newMsg: MessageItem) => {
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            const tempMatch = prev.find(
              (m) => m.sender_id === newMsg.sender_id && m.content === newMsg.content && m.id.startsWith('temp-')
            );
            if (tempMatch) {
              return prev.map((m) => (m.id === tempMatch.id ? newMsg : m));
            }
            return [...prev, newMsg];
          });
          void markConversationRead();
        });
      } catch (err: any) {
        setError(mapSqlErrorToFriendlyMessage(err, 'Could not load conversation.'));
      } finally {
        setLoading(false);
      }
    };

    loadChat();

    return () => {
      if (unsubscribe) unsubscribe();
      if (unsubscribeConversation) unsubscribeConversation();
    };
  }, [conversationId, loadAttempt]);

  const handleGoToStage = () => {
    if (linkedAgreementId) {
      router.push({ pathname: '/agreements/[id]', params: { id: linkedAgreementId } });
      return;
    }
    if (linkedGigId) {
      if (user?.id === conversation?.client_id) {
        router.push({ pathname: '/gigs/[id]/applicants', params: { id: linkedGigId } });
      } else {
        router.push({ pathname: '/gigs/[id]', params: { id: linkedGigId } });
      }
      return;
    }
    router.push('/(tabs)/activity');
  };

  const sendingRef = useRef(false);

  const handleSend = async () => {
    if (sendingRef.current || sending || !inputText.trim() || !conversationId) return;

    sendingRef.current = true;
    const textToSend = inputText.trim();
    setInputText('');
    setSending(true);

    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: MessageItem = {
      id: tempId,
      conversation_id: conversationId,
      sender_id: user?.id || '',
      content: textToSend,
      created_at: new Date().toISOString(),
      is_system: false,
      sender: user ? { id: user.id, display_name: 'You', avatar_path: null } : undefined,
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    try {
      const realId = await chatService.sendMessage(conversationId, textToSend);
      if (realId) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, id: realId } : m))
        );
      }
      showToast(strings.toasts.messageSent);
    } catch (err: any) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      showToast(mapSqlErrorToFriendlyMessage(err, 'Failed to send message.'), 'error');
      setInputText(textToSend); // restore on error
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const partnerTitle =
    partnerName ||
    (user?.id === conversation?.client_id
      ? conversation?.freelancer?.display_name
      : conversation?.client?.display_name) ||
    'Chat';

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
    >
      {/* Top Bar */}
      <View
        style={[
          styles.topBar,
          {
            borderBottomColor: theme.colors.border,
            backgroundColor: theme.glass.surface,
            paddingTop: isWide ? 14 : Math.max(insets.top + 8, 14),
          },
        ]}
      >
        <View style={styles.topBarInner}>
          <Button
            title="‹ Back"
            variant="ghost"
            size="xs"
            fullWidth={false}
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/(tabs)/messages');
              }
            }}
          />
          <View style={styles.topBarCenter}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Avatar name={partnerTitle} size={28} />
              <Text style={[styles.topBarTitle, { color: theme.colors.text }]} numberOfLines={1}>
                {partnerTitle}
              </Text>
            </View>
            {currentGigTitle ? (
              relatedThreads.length > 0 ? (
                <TouchableOpacity
                  style={[styles.projectSwitchPill, { backgroundColor: theme.colors.primarySoft }]}
                  onPress={() => setShowProjectPicker(true)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="briefcase-outline" size={11} color={theme.colors.primaryDark} />
                  <Text
                    style={[styles.projectSwitchText, { color: theme.colors.primaryDark }]}
                    numberOfLines={1}
                  >
                    {currentGigTitle}
                  </Text>
                  <Ionicons name="chevron-down" size={11} color={theme.colors.primaryDark} />
                </TouchableOpacity>
              ) : (
                <Text style={[styles.topBarSubtitle, { color: theme.colors.muted }]} numberOfLines={1}>
                  📁 {currentGigTitle}
                </Text>
              )
            ) : null}
          </View>
          <Button
            title={strings.loop.viewStageBtn}
            variant="soft"
            size="xs"
            fullWidth={false}
            onPress={handleGoToStage}
          />
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: theme.colors.danger }]}>{error}</Text>
          <Button
            title={strings.common.retry}
            onPress={() => setLoadAttempt((attempt) => attempt + 1)}
          />
          <Button
            title="Go Back"
            variant="secondary"
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/(tabs)/messages');
              }
            }}
          />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.messagesList, styles.centeredChatColumn]}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => {
            const isMe = item.sender_id === user?.id;
            if (item.is_system) {
              return (
                <View style={styles.systemMessageWrapper}>
                  <View
                    style={[
                      styles.systemPill,
                      {
                        backgroundColor: theme.colors.surfaceAlt,
                        borderColor: theme.colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.systemMessageText, { color: theme.colors.muted }]}>
                      {item.content}
                    </Text>
                  </View>
                </View>
              );
            }
            return (
              <View
                style={[
                  styles.messageBubbleWrapper,
                  isMe ? styles.myMessageWrapper : styles.theirMessageWrapper,
                ]}
              >
                {!isMe && item.sender?.display_name && (
                  <Text style={[styles.senderLabel, { color: theme.colors.muted }]}>
                    {item.sender.display_name}
                  </Text>
                )}
                <View
                  style={[
                    styles.bubble,
                    isMe
                      ? [styles.myBubble, { backgroundColor: theme.colors.primary }]
                      : [
                          styles.theirBubble,
                          {
                            backgroundColor: theme.colors.surface,
                            borderColor: theme.colors.border,
                            borderWidth: 1,
                          },
                        ],
                  ]}
                >
                  <Text
                    style={[
                      styles.messageText,
                      { color: isMe ? theme.colors.primaryContrast : theme.colors.text },
                    ]}
                  >
                    {item.content}
                  </Text>
                  <Text
                    style={[
                      styles.timestamp,
                      { color: isMe ? theme.colors.primarySoft : theme.colors.muted },
                    ]}
                  >
                    {new Date(item.created_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: theme.colors.muted }]}>
                No messages yet. Send a message to start communicating.
              </Text>
            </View>
          }
        />
      )}

      {/* Input Bar */}
      {conversation?.closed_at ? (
        <View
          style={[
            styles.inputBarWrapper,
            {
              borderTopColor: theme.colors.border,
              backgroundColor: theme.colors.surface,
              paddingBottom: Math.max(insets.bottom, 10),
            },
          ]}
        >
          <View style={styles.inputBarInner}>
            <Text style={[styles.emptyText, { color: theme.colors.muted }]}>
              {strings.errors.deletedConversationReadOnly}
            </Text>
          </View>
        </View>
      ) : (
        <View
          style={[
            styles.inputBarWrapper,
            {
              borderTopColor: theme.colors.border,
              backgroundColor: theme.colors.surface,
              paddingBottom: Math.max(insets.bottom, 10),
            },
          ]}
        >
          <View style={styles.inputBarInner}>
            <TextInput
              style={[
                styles.inputField,
                {
                  borderColor: theme.colors.border,
                  color: theme.colors.text,
                  backgroundColor: theme.colors.surfaceAlt,
                },
              ]}
              placeholder={isWide ? 'Type a message... (Enter to send, Shift+Enter for new line)' : 'Type a message...'}
              placeholderTextColor={theme.colors.muted}
              value={inputText}
              onChangeText={setInputText}
              multiline
              maxLength={2000}
              onKeyPress={(e: any) => {
                if (Platform.OS === 'web' && e?.nativeEvent?.key === 'Enter' && !e?.nativeEvent?.shiftKey) {
                  e.preventDefault?.();
                  void handleSend();
                }
              }}
            />
            <Button
              title="Send"
              icon="send"
              size="sm"
              fullWidth={false}
              onPress={handleSend}
              disabled={!inputText.trim() || sending}
              loading={sending}
            />
          </View>
        </View>
      )}

      {/* Switch Project Discussion Modal */}
      <Modal
        visible={showProjectPicker}
        transparent
        animationType={isWide ? 'fade' : 'slide'}
        onRequestClose={() => setShowProjectPicker(false)}
      >
        <Pressable
          style={[styles.modalOverlay, !isWide && styles.modalOverlayBottom]}
          onPress={() => setShowProjectPicker(false)}
        >
          <Pressable
            style={[
              styles.modalContent,
              !isWide && styles.modalContentBottomSheet,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              theme.shadow.card,
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            {!isWide && (
              <View style={[styles.sheetHandle, { backgroundColor: theme.colors.borderStrong }]} />
            )}
            <View style={[styles.modalHeader, { borderBottomColor: theme.colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, { color: theme.colors.text }]}>
                  Project Conversations
                </Text>
                <Text style={[styles.modalSubtitle, { color: theme.colors.muted }]}>
                  Switch discussion with {partnerTitle}:
                </Text>
              </View>
              <IconButton
                icon="close"
                variant="ghost"
                size="sm"
                onPress={() => setShowProjectPicker(false)}
                accessibilityLabel="Close"
              />
            </View>

            <ScrollView
              style={{ maxHeight: 280 }}
              contentContainerStyle={{ gap: 8, paddingVertical: 10 }}
              showsVerticalScrollIndicator={false}
            >
              {/* Current gig thread */}
              <Card tone="tinted-primary" padding="sm">
                <View style={styles.modalThreadRow}>
                  <Ionicons name="checkmark-circle" size={16} color={theme.colors.primary} />
                  <Text
                    style={[styles.modalThreadTitle, { color: theme.colors.primaryDark }]}
                    numberOfLines={1}
                  >
                    {currentGigTitle} (Current)
                  </Text>
                </View>
              </Card>

              {/* Other threads with this partner */}
              {relatedThreads.map((thread) => (
                <Card
                  key={thread.id}
                  tone="muted"
                  padding="sm"
                  onPress={() => {
                    setShowProjectPicker(false);
                    router.replace({
                      pathname: '/chat/[conversationId]',
                      params: {
                        conversationId: thread.id,
                        partnerName: partnerTitle,
                      },
                    });
                  }}
                >
                  <View style={styles.modalThreadRow}>
                    <Ionicons name="briefcase-outline" size={14} color={theme.colors.primary} />
                    <Text
                      style={[styles.modalThreadTitle, { color: theme.colors.text }]}
                      numberOfLines={1}
                    >
                      {thread.gig_title}
                    </Text>
                  </View>
                  <Text style={[styles.modalThreadSnippet, { color: theme.colors.muted }]} numberOfLines={1}>
                    {thread.last_message_content || 'No messages yet.'}
                  </Text>
                </Card>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  topBarInner: {
    width: '100%',
    maxWidth: 1120,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topBarTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorText: {
    fontSize: 16,
    marginBottom: 16,
    textAlign: 'center',
  },
  messagesList: {
    padding: 16,
    paddingBottom: 24,
    gap: 12,
  },
  centeredChatColumn: {
    width: '100%',
    maxWidth: 1120,
    alignSelf: 'center',
  },
  messageBubbleWrapper: {
    maxWidth: '80%',
  },
  myMessageWrapper: {
    alignSelf: 'flex-end',
  },
  theirMessageWrapper: {
    alignSelf: 'flex-start',
  },
  systemMessageWrapper: {
    alignSelf: 'center',
    maxWidth: '90%',
    marginVertical: 4,
  },
  systemPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  systemMessageText: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  senderLabel: {
    fontSize: 11,
    marginBottom: 2,
    marginLeft: 4,
  },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 4,
  },
  myBubble: {
    borderBottomRightRadius: 4,
  },
  theirBubble: {
    borderWidth: 1,
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
  },
  timestamp: {
    fontSize: 10,
    alignSelf: 'flex-end',
    fontVariant: ['tabular-nums'],
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  inputBarWrapper: {
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  inputBarInner: {
    width: '100%',
    maxWidth: 1120,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  inputField: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 100,
  },
  topBarCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  topBarSubtitle: {
    fontSize: 11,
    marginTop: 2,
    fontWeight: '500',
  },
  projectSwitchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    marginTop: 2,
    maxWidth: '90%',
  },
  projectSwitchText: {
    fontSize: 11,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalOverlayBottom: {
    justifyContent: 'flex-end',
    padding: 0,
  },
  modalContent: {
    width: '100%',
    maxWidth: 460,
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
  },
  modalContentBottomSheet: {
    maxWidth: '100%',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingBottom: 28,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  modalSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  modalThreadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  modalThreadTitle: {
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  modalThreadSnippet: {
    fontSize: 12,
    lineHeight: 16,
    paddingLeft: 20,
  },
});
