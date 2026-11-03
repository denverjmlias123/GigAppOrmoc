import { supabase } from '../lib/supabase';
import { createRealtimeDeduper, runOnce } from '../lib/singleFlight';

let notifChannelSeq = 0;

export interface NotificationItem {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  data: Record<string, any>;
  read_at: string | null;
  created_at: string;
}

export const notificationsService = {
  async getNotifications(): Promise<NotificationItem[]> {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return (data || []) as NotificationItem[];
  },

  async getUnreadCount(): Promise<number> {
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .is('read_at', null);

    if (error) throw error;
    return count || 0;
  },

  async markAsRead(id: string): Promise<boolean> {
    return runOnce(`mark_notification_read:${id}`, async () => {
      const { data, error } = await supabase.rpc('mark_notification_read', {
        p_id: id,
      });
      if (error) throw error;
      return Boolean(data);
    });
  },

  async markAllAsRead(): Promise<number> {
    return runOnce('mark_all_notifications_read', async () => {
      const { data, error } = await supabase.rpc('mark_all_notifications_read');
      if (error) throw error;
      return (data as number) || 0;
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
          const item = payload.new as NotificationItem | undefined;
          if (item && (payload.eventType === 'UPDATE' || deduper.shouldProcess(item.id))) {
            onNotification(item, payload.eventType as 'INSERT' | 'UPDATE');
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
