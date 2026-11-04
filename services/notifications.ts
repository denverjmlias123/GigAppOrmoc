import { supabase } from '../lib/supabase';
import { createRealtimeDeduper, runOnce } from '../lib/singleFlight';

let notifChannelSeq = 0;

export interface NotificationItem {
  id: string;
  user_id: string;
  type: string;
  notification_type?: string;
  title: string;
  body: string;
  target_route?: string | null;
  entity_type: string | null;
  entity_id: string | null;
  data: Record<string, any>;
  read_at: string | null;
  is_read?: boolean;
  created_at: string;
}

function normalizeNotification(row: any): NotificationItem {
  const isRead = row.is_read ?? Boolean(row.read_at);
  return {
    id: row.id,
    user_id: row.user_id,
    type: row.notification_type || row.type || 'info',
    notification_type: row.notification_type || row.type || 'info',
    title: row.title || 'Notification',
    body: row.body || '',
    target_route: row.target_route || null,
    entity_type: row.entity_type || null,
    entity_id: row.entity_id || null,
    data: row.data || {},
    read_at: row.read_at || (isRead ? row.created_at : null),
    is_read: isRead,
    created_at: row.created_at,
  };
}

export const notificationsService = {
  async getNotifications(): Promise<NotificationItem[]> {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return (data || []).map(normalizeNotification);
  },

  async getUnreadCount(): Promise<number> {
    try {
      const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('is_read', false);

      if (!error && typeof count === 'number') {
        return count;
      }
    } catch {}

    try {
      const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .is('read_at', null);

      if (!error && typeof count === 'number') {
        return count;
      }
    } catch {}

    return 0;
  },

  async markAsRead(id: string): Promise<boolean> {
    return runOnce(`mark_notification_read:${id}`, async () => {
      try {
        const { data, error } = await supabase.rpc('mark_notification_read', {
          p_id: id,
        });
        if (!error) return Boolean(data ?? true);
      } catch {}

      // Fallback: direct update
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', id);

      return !error;
    });
  },

  async markAllAsRead(): Promise<number> {
    return runOnce('mark_all_notifications_read', async () => {
      try {
        const { data, error } = await supabase.rpc('mark_all_notifications_read');
        if (!error && typeof data === 'number') return data;
      } catch {}

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return 0;

      const { data, error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', user.id)
        .eq('is_read', false)
        .select('id');

      if (error) throw error;
      return data?.length || 0;
    });
  },

  subscribeToNotifications(
    userId: string,
    onNotification: (item: NotificationItem, eventType: 'INSERT' | 'UPDATE') => void
  ) {
    notifChannelSeq += 1;
    const deduper = createRealtimeDeduper(500);
    const channelTopic = `user-notifications:${userId}-${Date.now()}-${notifChannelSeq}`;
    const channel = supabase
      .channel(channelTopic)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const raw = payload.new as any;
          if (raw && (payload.eventType === 'UPDATE' || deduper.shouldProcess(raw.id))) {
            onNotification(normalizeNotification(raw), payload.eventType as 'INSERT' | 'UPDATE');
          }
        }
      )
      .subscribe();

    return () => {
      deduper.clear();
      supabase.removeChannel(channel);
    };
  },
};
