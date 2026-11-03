import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  Platform,
  TextInput as RNTextInput,
  Pressable,
  Modal,
  ScrollView,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { useAuth } from '../../hooks/useAuth';
import { chatService, ConversationSummary } from '../../services/chat';
import { notificationsService } from '../../services/notifications';
import { Avatar } from '../../components/ui/Avatar';
import { IconButton } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { EmptyState } from '../../components/ui/EmptyState';
import { ScreenBackground } from '../../components/ui/ScreenBackground';
import { ErrorState } from '../../components/ui/ErrorState';
import { SkeletonMessageList } from '../../components/ui/Skeleton';

export interface PartnerConversationGroup {
  partner_id: string;
  partner_name: string;
  partner_avatar: string | null;
  threads: ConversationSummary[];
  latest_thread: ConversationSummary;
  is_unread: boolean;
  unread_count: number;
}

function formatMessageTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
}

export default function MessagesScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { isWide, topSpace, bottomSpace } = useResponsiveLayout();
  const { user } = useAuth();

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);

  // Selected partner group for multi-thread picker modal
  const [selectedPartnerGroup, setSelectedPartnerGroup] = useState<PartnerConversationGroup | null>(null);

  const loadConversations = useCallback(async () => {
    setError(null);
    try {
      const data = await chatService.getUserConversations();
      setConversations(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load conversations.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadConversations();
      if (!user?.id) return;
      return notificationsService.subscribeToNotifications(user.id, () => {
        void loadConversations();
      });
    }, [loadConversations, user?.id])
  );

  // Group conversations by partner_id so each account appears exactly once
  const partnerGroups = useMemo(() => {
    const map = new Map<string, PartnerConversationGroup>();

    for (const c of conversations) {
      const existing = map.get(c.partner_id);
      if (!existing) {
        map.set(c.partner_id, {
          partner_id: c.partner_id,
          partner_name: c.partner_name || 'Ormoc User',
          partner_avatar: c.partner_avatar || null,
          threads: [c],
          latest_thread: c,
          is_unread: c.is_unread,
          unread_count: c.is_unread ? 1 : 0,
        });
      } else {
        existing.threads.push(c);
        if (c.is_unread) {
          existing.is_unread = true;
          existing.unread_count += 1;
        }
        const currentTime = new Date(c.last_message_created_at || c.updated_at).getTime();
        const latestTime = new Date(
          existing.latest_thread.last_message_created_at || existing.latest_thread.updated_at
        ).getTime();
        if (currentTime > latestTime) {
          existing.latest_thread = c;
        }
      }
    }

    const list = Array.from(map.values());
    list.sort((a, b) => {
      const timeA = new Date(
        a.latest_thread.last_message_created_at || a.latest_thread.updated_at
      ).getTime();
      const timeB = new Date(
        b.latest_thread.last_message_created_at || b.latest_thread.updated_at
      ).getTime();
      return timeB - timeA;
    });

    return list;
  }, [conversations]);

  // Filter partner groups by search query & unread filter
  const filteredGroups = useMemo(() => {
    let base = partnerGroups;
    if (unreadOnly) {
      base = base.filter((g) => g.is_unread);
    }
    if (!searchQuery.trim()) return base;
    const q = searchQuery.toLowerCase().trim();
    return base.filter((g) => {
      const matchesName = g.partner_name.toLowerCase().includes(q);
      const matchesMsg = g.threads.some((t) =>
        t.last_message_content?.toLowerCase().includes(q)
      );
      const matchesGig = g.threads.some((t) =>
        t.gig_title.toLowerCase().includes(q)
      );
      return matchesName || matchesMsg || matchesGig;
    });
  }, [partnerGroups, searchQuery, unreadOnly]);

  const unreadGroupCount = useMemo(
    () => partnerGroups.filter((g) => g.is_unread).length,
    [partnerGroups]
  );

  const navigateToConversation = useCallback(
    (thread: ConversationSummary, partnerName: string) => {
      if (thread.is_unread) {
        setConversations((prev) =>
          prev.map((c) => (c.id === thread.id ? { ...c, is_unread: false } : c))
        );
        chatService.markConversationRead(thread.id).catch(() => {});
      }

      router.push({
        pathname: '/chat/[conversationId]',
        params: {
          conversationId: thread.id,
          partnerName: partnerName || 'Ormoc User',
        },
      });
    },
    [router]
  );

  const handlePartnerPress = useCallback(
    (group: PartnerConversationGroup) => {
      if (group.threads.length === 1) {
        navigateToConversation(group.threads[0], group.partner_name);
      } else {
        // Open project selection modal for this user
        setSelectedPartnerGroup(group);
      }
    },
    [navigateToConversation]
  );

  const keyExtractor = useCallback((item: PartnerConversationGroup) => item.partner_id, []);

  const renderItem = useCallback(
    ({ item }: { item: PartnerConversationGroup }) => (
      <PartnerCard item={item} theme={theme} onPress={handlePartnerPress} />
    ),
    [theme, handlePartnerPress]
  );

  return (
    <ScreenBackground style={styles.container}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: theme.colors.surface,
            borderBottomColor: theme.colors.border,
            paddingTop: isWide ? 24 : topSpace,
          },
        ]}
      >
        <View style={styles.headerInner}>
          <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Messages</Text>
          <Text style={[styles.headerSubtitle, { color: theme.colors.muted }]}>
            Conversations with clients and freelancers
          </Text>

          {/* Search bar & filter chips */}
          {partnerGroups.length > 0 && (
            <>
              <View
                style={[
                  styles.searchBox,
                  {
                    backgroundColor: theme.colors.surfaceAlt,
                    borderRadius: theme.radii.input,
                    borderColor: theme.colors.border,
                  },
                ]}
              >
                <Ionicons name="search" size={18} color={theme.colors.muted} />
                <RNTextInput
                  style={[
                    styles.searchInput,
                    { color: theme.colors.text },
                    Platform.OS === 'web' && ({ outlineStyle: 'none' } as any),
                  ]}
                  placeholder="Search by contact name, gig title, or message..."
                  placeholderTextColor={theme.colors.muted}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  returnKeyType="search"
                />
                {searchQuery ? (
                  <Pressable
                    onPress={() => setSearchQuery('')}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                  >
                    <Ionicons name="close-circle" size={18} color={theme.colors.muted} />
                  </Pressable>
                ) : null}
              </View>

              <View style={styles.filterPillsRow}>
                <Chip
                  label="All"
                  count={partnerGroups.length}
                  selected={!unreadOnly}
                  onPress={() => setUnreadOnly(false)}
                />
                <Chip
                  label="Unread"
                  count={unreadGroupCount > 0 ? unreadGroupCount : undefined}
                  selected={unreadOnly}
                  onPress={() => setUnreadOnly(true)}
                />
              </View>
            </>
          )}
        </View>
      </View>

      {/* Body */}
      {loading ? (
        <SkeletonMessageList count={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={loadConversations} />
      ) : partnerGroups.length === 0 ? (
        <EmptyState
          icon="chatbubbles-outline"
          title="No conversations yet"
          description="When you apply for a gig or receive proposals, real-time messaging starts here."
        />
      ) : filteredGroups.length === 0 ? (
        <EmptyState
          icon="search-outline"
          title="No conversations found"
          description="Try checking for typos or clearing your active filter."
          actionTitle="Clear filter"
          onAction={() => {
            setSearchQuery('');
            setUnreadOnly(false);
          }}
        />
      ) : (
        <FlatList
          data={filteredGroups}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={Platform.OS === 'android'}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void loadConversations();
              }}
              tintColor={theme.colors.primary}
            />
          }
          contentContainerStyle={styles.listContent}
        />
      )}

      {/* Multi-thread selection modal when a contact has more than 1 project conversation */}
      <Modal
        visible={!!selectedPartnerGroup}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedPartnerGroup(null)}
      >
        <Pressable
          style={[styles.modalOverlay, !isWide && styles.modalOverlaySheet]}
          onPress={() => setSelectedPartnerGroup(null)}
        >
          <Pressable
            style={[
              styles.modalContent,
              !isWide && [styles.modalContentSheet, { paddingBottom: bottomSpace }],
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              theme.shadow.card,
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            {!isWide && (
              <View style={[styles.sheetHandle, { backgroundColor: theme.colors.border }]} />
            )}
            <View style={[styles.modalHeader, { borderBottomColor: theme.colors.border }]}>
              <Avatar
                name={selectedPartnerGroup?.partner_name}
                imageUri={selectedPartnerGroup?.partner_avatar}
                size={44}
              />
              <View style={styles.modalHeaderTitleCol}>
                <Text style={[styles.modalTitle, { color: theme.colors.text }]} numberOfLines={1}>
                  {selectedPartnerGroup?.partner_name}
                </Text>
                <Text style={[styles.modalSubtitle, { color: theme.colors.muted }]}>
                  Select a project thread to view:
                </Text>
              </View>
              <IconButton
                icon="close"
                variant="ghost"
                size="sm"
                onPress={() => setSelectedPartnerGroup(null)}
                accessibilityLabel="Close"
              />
            </View>

            <ScrollView
              style={{ maxHeight: 340 }}
              contentContainerStyle={styles.modalScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {selectedPartnerGroup?.threads.map((thread) => (
                <Card
                  key={thread.id}
                  tone={thread.is_unread ? 'role' : 'raised'}
                  padding="sm"
                  onPress={() => {
                    const partner = selectedPartnerGroup.partner_name;
                    setSelectedPartnerGroup(null);
                    navigateToConversation(thread, partner);
                  }}
                >
                  <View style={styles.modalThreadTop}>
                    <View style={styles.modalThreadTitleRow}>
                      <Ionicons
                        name="briefcase-outline"
                        size={14}
                        color={theme.colors.primary}
                      />
                      <Text
                        style={[styles.modalThreadTitle, { color: theme.colors.text }]}
                        numberOfLines={1}
                      >
                        {thread.gig_title}
                      </Text>
                    </View>
                    {thread.last_message_created_at ? (
                      <Text
                        style={[styles.modalThreadTime, { color: theme.colors.muted }]}
                      >
                        {formatMessageTime(thread.last_message_created_at)}
                      </Text>
                    ) : null}
                  </View>

                  <Text
                    style={[
                      styles.modalThreadMsg,
                      {
                        color: thread.is_unread
                          ? theme.colors.text
                          : theme.colors.muted,
                        fontWeight: thread.is_unread ? '700' : '400',
                      },
                    ]}
                    numberOfLines={2}
                  >
                    {thread.last_message_content || 'No messages yet.'}
                  </Text>

                  {thread.is_unread && (
                    <View
                      style={[
                        styles.modalUnreadBadge,
                        { backgroundColor: theme.colors.primary },
                      ]}
                    >
                      <Text style={[styles.modalUnreadText, { color: theme.colors.heroText }]}>New message</Text>
                    </View>
                  )}
                </Card>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenBackground>
  );
}

const PartnerCard = React.memo(function PartnerCard({
  item,
  theme,
  onPress,
}: {
  item: PartnerConversationGroup;
  theme: any;
  onPress: (item: PartnerConversationGroup) => void;
}) {
  const formattedTime = formatMessageTime(
    item.latest_thread.last_message_created_at || item.latest_thread.updated_at
  );
  const isMultiGig = item.threads.length > 1;

  return (
    <Card
      tone={item.is_unread ? 'raised' : 'outline'}
      padding="md"
      style={styles.convCard}
      onPress={() => onPress(item)}
    >
      <Avatar
        name={item.partner_name || 'U'}
        imageUri={item.partner_avatar}
        size={48}
      />

      <View style={styles.convDetails}>
        <View style={styles.nameRow}>
          <Text style={[styles.partnerName, { color: theme.colors.text }]} numberOfLines={1}>
            {item.partner_name || 'Anonymous User'}
          </Text>
          {formattedTime ? (
            <Text style={[styles.timeText, { color: theme.colors.muted }]}>
              {formattedTime}
            </Text>
          ) : null}
        </View>

        {/* Project indicator pill */}
        <View style={styles.projectPillRow}>
          <View
            style={[
              styles.projectPill,
              {
                backgroundColor: isMultiGig
                  ? theme.colors.primarySoft
                  : theme.colors.surfaceAlt,
              },
            ]}
          >
            <Ionicons
              name={isMultiGig ? 'layers-outline' : 'briefcase-outline'}
              size={11}
              color={isMultiGig ? theme.colors.primaryDark : theme.colors.muted}
            />
            <Text
              style={[
                styles.projectPillText,
                { color: isMultiGig ? theme.colors.primaryDark : theme.colors.muted },
              ]}
              numberOfLines={1}
            >
              {isMultiGig
                ? `${item.threads.length} Projects: ${item.threads.map((t) => t.gig_title).join(' · ')}`
                : item.latest_thread.gig_title}
            </Text>
          </View>
        </View>

        {/* Message preview row */}
        <View style={styles.messageRow}>
          <Text
            style={[
              styles.previewText,
              {
                color: item.is_unread ? theme.colors.text : theme.colors.muted,
                fontWeight: item.is_unread ? '700' : '400',
              },
            ]}
            numberOfLines={1}
          >
            {item.latest_thread.last_message_content || 'No messages yet.'}
          </Text>
          {item.is_unread && (
            <View style={[styles.unreadBadgePill, { backgroundColor: theme.colors.primary }]}>
              <Text style={[styles.unreadBadgeText, { color: theme.colors.heroText }]}>{item.unread_count}</Text>
            </View>
          )}
        </View>
      </View>
    </Card>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerInner: {
    maxWidth: 680,
    width: '100%',
    alignSelf: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 13,
    marginTop: 2,
    marginBottom: 10,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    height: '100%',
  },
  filterPillsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 12,
    maxWidth: 680,
    width: '100%',
    alignSelf: 'center',
  },
  convCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  convDetails: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  partnerName: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  timeText: {
    fontSize: 11,
  },
  projectPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 5,
  },
  projectPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    maxWidth: '95%',
  },
  projectPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  previewText: {
    fontSize: 13,
    flex: 1,
  },
  unreadBadgePill: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    marginLeft: 8,
  },
  unreadBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalOverlaySheet: {
    justifyContent: 'flex-end',
    padding: 0,
  },
  modalContent: {
    width: '100%',
    maxWidth: 460,
    borderRadius: 22,
    borderWidth: 1,
    padding: 18,
  },
  modalContentSheet: {
    maxWidth: '100%',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 12,
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
    gap: 12,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalHeaderTitleCol: {
    flex: 1,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  modalSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  modalScrollContent: {
    gap: 8,
    paddingVertical: 10,
  },
  modalThreadTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  modalThreadTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  modalThreadTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  modalThreadTime: {
    fontSize: 11,
  },
  modalThreadMsg: {
    fontSize: 12,
    lineHeight: 16,
  },
  modalUnreadBadge: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  modalUnreadText: {
    fontSize: 10,
    fontWeight: '700',
  },
});
