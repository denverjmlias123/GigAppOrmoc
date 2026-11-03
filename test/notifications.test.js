const test = require('node:test');
const assert = require('node:assert');

// 1. Never notify actor about their own action
test('Notifications: Self-notification suppression rule', () => {
  function shouldCreateNotification(actorId, recipientId) {
    if (!recipientId) return false;
    // Rule: Never notify actor about their own action
    if (actorId && actorId === recipientId) return false;
    return true;
  }

  // Client applies to own gig -> suppressed
  assert.strictEqual(shouldCreateNotification('usr_client', 'usr_client'), false);

  // Freelancer applies to client gig -> allowed
  assert.strictEqual(shouldCreateNotification('usr_freelancer', 'usr_client'), true);
});

// 2. Unread notification count calculation
test('Notifications: Unread count computation', () => {
  const notifications = [
    { id: '1', user_id: 'usr_a', read_at: null },
    { id: '2', user_id: 'usr_a', read_at: '2026-10-11T00:00:00Z' },
    { id: '3', user_id: 'usr_a', read_at: null },
    { id: '4', user_id: 'usr_b', read_at: null },
  ];

  function getUnreadCount(userId, list) {
    return list.filter((n) => n.user_id === userId && n.read_at === null).length;
  }

  assert.strictEqual(getUnreadCount('usr_a', notifications), 2);
  assert.strictEqual(getUnreadCount('usr_b', notifications), 1);
  assert.strictEqual(getUnreadCount('usr_c', notifications), 0);
});

// 3. Deep link routing resolver
test('Notifications: Deep link target resolver', () => {
  function resolveNotificationRoute(item) {
    if (item.entity_type === 'agreement' && item.entity_id) {
      return { pathname: '/agreements/[id]', id: item.entity_id };
    }
    if (item.entity_type === 'application') {
      const gigId = item.data?.gig_id;
      if (gigId) {
        return { pathname: '/gigs/[id]/applicants', id: gigId };
      }
      return { pathname: '/(tabs)/activity' };
    }
    if (item.entity_type === 'gig' && item.entity_id) {
      return { pathname: '/gigs/[id]', id: item.entity_id };
    }
    return { pathname: '/notifications' };
  }

  const r1 = resolveNotificationRoute({
    entity_type: 'agreement',
    entity_id: 'agr_123',
  });
  assert.strictEqual(r1.pathname, '/agreements/[id]');
  assert.strictEqual(r1.id, 'agr_123');

  const r2 = resolveNotificationRoute({
    entity_type: 'application',
    data: { gig_id: 'gig_456' },
  });
  assert.strictEqual(r2.pathname, '/gigs/[id]/applicants');
  assert.strictEqual(r2.id, 'gig_456');
});

// 4. Mark all read state transition
test('Notifications: mark_all_notifications_read updates all unread', () => {
  const userNotifications = [
    { id: '1', read_at: null },
    { id: '2', read_at: null },
    { id: '3', read_at: '2026-10-10T12:00:00Z' },
  ];

  function markAllRead(list, now = new Date().toISOString()) {
    let updated = 0;
    const nextList = list.map((n) => {
      if (!n.read_at) {
        updated++;
        return { ...n, read_at: now };
      }
      return n;
    });
    return { nextList, updated };
  }

  const res = markAllRead(userNotifications);
  assert.strictEqual(res.updated, 2);
  assert.strictEqual(res.nextList.every((n) => n.read_at !== null), true);
});
