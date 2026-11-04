import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme, useResponsiveLayout } from './theme';
import { useAuth } from '../hooks/useAuth';
import { notificationsService, NotificationItem } from '../services/notifications';
import { Button } from '../components/ui/Button';
import { Card, PageHeaderBox } from '../components/ui/Card';
import { SegmentedControl } from '../components/ui/Chip';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { showToast } from '../components/ui/Toast';
import { strings } from '../constants/strings';

export default function NotificationsScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { bottomPad } = useResponsiveLayout();
  const { user, profile } = useAuth();

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [filterMode, setFilterMode] = useState<'all' | 'unread'>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNotifications = useCallback(async () => {
    setError(null);
    try {
      const data = await notificationsService.getNotifications();
      setNotifications(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load notifications.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadNotifications();
      if (!user?.id) return;
      return notificationsService.subscribeToNotifications(user.id, (changedNotification, eventType) => {
        setNotifications((prev) => {
          if (eventType === 'INSERT') {
            return [changedNotification, ...prev.filter((item) => item.id !== changedNotification.id)].slice(0, 50);
          }
          return prev.map((item) => item.id === changedNotification.id ? changedNotification : item);
        });
      });
    }, [user?.id, loadNotifications])
  );

  const handleNotificationPress = useCallback(async (item: NotificationItem) => {
    if (!item.read_at) {
      try {
        const marked = await notificationsService.markAsRead(item.id);
        if (marked) {
          setNotifications((prev) =>
            prev.map((n) => (n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n))
          );
        } else {
          await loadNotifications();
        }
      } catch {
        showToast(strings.errors.notificationReadFailed, 'error');
      }
    }

    if (item.target_route) {
      try {
        router.push(item.target_route as any);
        return;
      } catch {}
    }

    const agreementId =
      item.entity_type === 'agreement'
        ? item.entity_id
        : item.data?.agreement_id || null;
    const milestoneId =
      item.entity_type === 'milestone'
        ? item.entity_id
        : item.data?.milestone_id || null;
    const conversationId =
      item.entity_type === 'conversation'
        ? item.entity_id
        : item.data?.conversation_id || null;

    // 1. Chat / Conversation notifications
    if (conversationId || item.type === 'new_message') {
      if (conversationId) {
        router.push({
          pathname: '/chat/[conversationId]',
          params: { conversationId },
        });
        return;
      }
      router.push('/(tabs)/messages');
      return;
    }

    // 2. Milestone-specific stage deep links
    if (agreementId && milestoneId) {
      if (
        item.type === 'milestone_submitted' ||
        item.type === 'milestone_review_reminder_3d' ||
        item.type === 'milestone_review_reminder_7d'
      ) {
        router.push({
          pathname: '/agreements/[id]/milestones/[milestoneId]/review',
          params: { id: agreementId, milestoneId },
        });
        return;
      }
      if (item.type === 'milestone_revision_requested') {
        router.push({
          pathname: '/agreements/[id]/milestones/[milestoneId]/submit',
          params: { id: agreementId, milestoneId },
        });
        return;
      }
    }

    // 3. Agreement / Payment / Review notifications -> Agreement loop screen
    if (
      agreementId ||
      item.entity_type === 'agreement' ||
      item.entity_type === 'milestone' ||
      item.entity_type === 'payment' ||
      item.entity_type === 'review' ||
      item.type.startsWith('milestone_') ||
      item.type.startsWith('payment_') ||
      item.type.startsWith('agreement_') ||
      item.type === 'review_window_closing_3d'
    ) {
      const targetAgrId = agreementId || item.entity_id;
      if (targetAgrId) {
        if (item.type === 'review_window_closing_3d') {
          router.push({
            pathname: '/agreements/[id]/review',
            params: { id: targetAgrId },
          });
          return;
        }
        router.push({ pathname: '/agreements/[id]', params: { id: targetAgrId } });
        return;
      }
    }

    // 4. Application / Proposal stage deep links
    if (
      item.entity_type === 'application' ||
      item.type === 'proposal_withdrawn' ||
      item.type === 'application_withdrawn'
    ) {
      const gigId = item.data?.gig_id;
      if (
        (item.type === 'application_received' ||
          item.type === 'counter_declined' ||
          item.type === 'proposal_withdrawn' ||
          item.type === 'application_withdrawn') &&
        gigId &&
        profile?.active_mode === 'hire'
      ) {
        router.push({ pathname: '/gigs/[id]/applicants', params: { id: gigId } });
      } else {
        router.push('/(tabs)/activity');
      }
      return;
    }

    // 5. Gig detail deep link
    if (
      (item.entity_type === 'gig' && item.entity_id) ||
      item.type === 'gig_application_deadline_24h' ||
      item.type === 'gig_expired'
    ) {
      const gigId = item.entity_id || item.data?.gig_id;
      if (gigId) {
        router.push({ pathname: '/gigs/[id]', params: { id: gigId } });
        return;
      }
    }

    // 6. Safety & Report notifications
    if (item.entity_type === 'report' || item.type === 'report_resolved') {
      router.push('/(tabs)');
      return;
    }

    // 7. Profile completeness / account status deep link
    if (
      item.entity_type === 'profile' ||
      item.type === 'profile_complete' ||
      item.type === 'account_status_changed'
    ) {
      router.push('/(tabs)/profile');
    }
  }, [router, loadNotifications, profile?.active_mode]);

  const markingAllRef = React.useRef(false);
  const handleMarkAllRead = async () => {
    if (markingAllRef.current) return;
    markingAllRef.current = true;
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() }))
    );
    try {
      await notificationsService.markAllAsRead();
    } catch {
      await loadNotifications();
    } finally {
      markingAllRef.current = false;
    }
  };

  const getNotificationIcon = (type: string): React.ComponentProps<typeof Ionicons>['name'] => {
    switch (type) {
      case 'application_received':
      case 'application_accepted':
      case 'application_countered':
      case 'proposal_withdrawn':
      case 'application_withdrawn':
        return 'document-text-outline';
      case 'agreement_created':
      case 'agreement_completed':
      case 'agreement_deadline_48h':
        return 'shield-checkmark-outline';
      case 'milestones_defined':
      case 'milestones_updated':
      case 'milestone_submitted':
      case 'milestone_approved':
      case 'milestone_revision_requested':
      case 'milestone_review_reminder_3d':
      case 'milestone_review_reminder_7d':
        return 'flag-outline';
      case 'payment_reported':
      case 'payment_confirmed':
      case 'payment_disputed':
      case 'payment_confirm_reminder_2d':
        return 'cash-outline';
      case 'review_received':
      case 'review_window_closing_3d':
        return 'star-outline';
      case 'gig_application_deadline_24h':
      case 'gig_expired':
        return 'time-outline';
      case 'report_resolved':
        return 'checkmark-done-circle-outline';
      case 'profile_complete':
      case 'account_status_changed':
        return 'checkmark-circle-outline';
      default:
        return 'notifications-outline';
    }
  };

  const unreadCount = notifications.filter((n) => !n.read_at).length;
  const visibleNotifications =
    filterMode === 'unread' ? notifications.filter((n) => !n.read_at) : notifications;

  const keyExtractor = useCallback((item: NotificationItem) => item.id, []);

  const renderItem = useCallback(
    ({ item }: { item: NotificationItem }) => (
      <NotificationCard
        item={item}
        theme={theme}
        icon={getNotificationIcon(item.type)}
        onPress={handleNotificationPress}
      />
    ),
    [theme, handleNotificationPress]
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <PageHeaderBox
        title="Notifications"
        subtitle="Stay updated on your gigs, milestones, and messages"
        onBack={() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace('/(tabs)');
          }
        }}
        maxWidth={680}
        rightAction={
          unreadCount > 0 ? (
            <Button
              title="Mark all read"
              variant="ghost"
              size="xs"
              fullWidth={false}
              onPress={handleMarkAllRead}
            />
          ) : undefined
        }
      />

      {/* Filter Bar */}
      {!loading && !error && notifications.length > 0 ? (
        <View style={styles.filterBarWrap}>
          <View style={styles.filterBarInner}>
            <SegmentedControl
              options={[
                { value: 'all', label: 'All', count: notifications.length },
                { value: 'unread', label: 'Unread', count: unreadCount },
              ]}
              value={filterMode}
              onChange={(val) => setFilterMode(val as 'all' | 'unread')}
            />
          </View>
        </View>
      ) : null}

      {/* Body */}
      <View style={styles.bodyWrap}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        ) : error ? (
          <ErrorState message={error} onRetry={loadNotifications} />
        ) : visibleNotifications.length === 0 ? (
          <EmptyState
            icon="notifications-off-outline"
            title={filterMode === 'unread' ? 'No unread notifications' : "You're all caught up"}
            description="When clients or freelancers respond to your gigs and milestones, you'll see notifications here."
          />
        ) : (
          <FlatList
            data={visibleNotifications}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={7}
            removeClippedSubviews={Platform.OS === 'android'}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  loadNotifications();
                }}
                tintColor={theme.colors.primary}
              />
            }
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: Math.max(bottomPad, 32) },
            ]}
          />
        )}
      </View>
    </View>
  );
}

const NotificationCard = React.memo(function NotificationCard({
  item,
  theme,
  icon,
  onPress,
}: {
  item: NotificationItem;
  theme: any;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: (item: NotificationItem) => void;
}) {
  const isUnread = !item.read_at;
  return (
    <Card
      tone={isUnread ? 'tinted-primary' : 'raised'}
      padding="md"
      onPress={() => onPress(item)}
      style={styles.notificationCard}
    >
      <View
        style={[
          styles.iconCircle,
          {
            backgroundColor: isUnread ? theme.colors.surface : theme.colors.surfaceAlt,
          },
        ]}
      >
        <Ionicons
          name={icon}
          size={20}
          color={isUnread ? theme.colors.primary : theme.colors.muted}
        />
      </View>

      <View style={styles.contentCol}>
        <View style={styles.titleRow}>
          <Text style={[styles.itemTitle, { color: theme.colors.text }]} numberOfLines={1}>
            {item.title}
          </Text>
          {isUnread && <View style={[styles.unreadDot, { backgroundColor: theme.colors.primary }]} />}
        </View>
        <Text style={[styles.itemBody, { color: theme.colors.muted }]}>{item.body}</Text>
        <Text style={[styles.itemDate, { color: theme.colors.muted }]}>
          {new Date(item.created_at).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
      </View>
    </Card>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  filterBarWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  filterBarInner: {
    maxWidth: 680,
    width: '100%',
    alignSelf: 'center',
  },
  bodyWrap: {
    flex: 1,
    maxWidth: 680,
    width: '100%',
    alignSelf: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    padding: 16,
    gap: 10,
  },
  notificationCard: {
    flexDirection: 'row',
    gap: 12,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentCol: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 6,
  },
  itemBody: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 6,
  },
  itemDate: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
});
