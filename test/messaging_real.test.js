const test = require('node:test');
const assert = require('node:assert');

// 1. Participant check and self-conversation prevention
test('Messaging: Participant verification and own-content rule', () => {
  function canSendMessage(callerId, clientId, freelancerId) {
    if (!callerId) throw new Error('Not authenticated.');
    if (clientId === freelancerId) {
      throw new Error('Cannot converse with yourself.');
    }
    if (callerId !== clientId && callerId !== freelancerId) {
      throw new Error('Only conversation participants can send messages.');
    }
    return true;
  }

  // Client can send
  assert.strictEqual(canSendMessage('usr_client', 'usr_client', 'usr_freelancer'), true);

  // Freelancer can send
  assert.strictEqual(canSendMessage('usr_freelancer', 'usr_client', 'usr_freelancer'), true);

  // Non-participant rejected
  assert.throws(
    () => canSendMessage('usr_intruder', 'usr_client', 'usr_freelancer'),
    /Only conversation participants/
  );

  // Self-conversation rejected
  assert.throws(
    () => canSendMessage('usr_same', 'usr_same', 'usr_same'),
    /Cannot converse with yourself/
  );
});

// 2. Messaging rate limit check (max 30 per minute)
test('Messaging: Rate limit enforcement threshold', () => {
  function checkRateLimit(recentCount) {
    if (recentCount >= 30) {
      throw new Error('Message rate limit exceeded (max 30 messages per minute).');
    }
    return true;
  }

  assert.strictEqual(checkRateLimit(0), true);
  assert.strictEqual(checkRateLimit(29), true);
  assert.throws(() => checkRateLimit(30), /Message rate limit exceeded/);
});

// 3. Unread badge computation from conversation_reads
test('Messaging: Unread status logic from conversation_reads', () => {
  function computeIsUnread(callerId, message, lastReadAt) {
    if (!message) return false;
    // Messages sent by caller are never unread for caller
    if (message.sender_id === callerId) return false;
    if (!lastReadAt) return true;
    return new Date(lastReadAt).getTime() < new Date(message.created_at).getTime();
  }

  const msg1 = {
    sender_id: 'usr_other',
    created_at: '2026-10-11T04:00:00Z',
  };

  // Never read -> unread
  assert.strictEqual(computeIsUnread('usr_caller', msg1, null), true);

  // Read before message was sent -> unread
  assert.strictEqual(computeIsUnread('usr_caller', msg1, '2026-10-11T03:59:00Z'), true);

  // Read after message was sent -> read
  assert.strictEqual(computeIsUnread('usr_caller', msg1, '2026-10-11T04:01:00Z'), false);

  // Message sent by caller -> read
  assert.strictEqual(computeIsUnread('usr_other', msg1, null), false);
});
