import { createRequestId } from './errors';

const inFlightPromises = new Map<string, Promise<any>>();
const attemptRequestIds = new Map<string, string>();

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

interface RunOnceOptions {
  /** Explicit request_id to use (e.g. for deterministic replay). */
  requestId?: string;
  /** If true (default), keeps the same request_id when an attempt throws so a retry reuses it. */
  reuseRequestIdOnError?: boolean;
}

/**
 * Returns the active request_id for a given action key, or creates one if none exists.
 */
export function getOrCreateAttemptRequestId(key: string): string {
  const existing = attemptRequestIds.get(key);
  if (existing && isUuid(existing)) return existing;
  const fresh = createRequestId();
  attemptRequestIds.set(key, fresh);
  return fresh;
}

/**
 * Clears the stored request_id for a key (called after a successful write or when resetting a form).
 */
function clearAttemptRequestId(key: string): void {
  attemptRequestIds.delete(key);
}

/**
 * Checks whether an RPC return value or error indicates the state transition was already completed
 * (for example on another device or a previous tap).
 */
export function isAlreadyDoneSignal(value: unknown): boolean {
  if (!value) return false;
  if (typeof value === 'object') {
    const obj = value as Record<string, any>;
    if (obj.already_done === true || obj.alreadyDone === true) {
      return true;
    }
    const msg = typeof obj.message === 'string' ? obj.message.toLowerCase() : '';
    if (msg.includes('already_done') || msg.includes('already done on your other device')) {
      return true;
    }
  }
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    return lower === 'already_done' || lower.includes('already done on your other device');
  }
  return false;
}

/**
 * Module-level single-flight wrapper for write operations.
 * - Synchronous in-flight Map lock: 10 rapid calls with the same key execute `fn` only once.
 * - Generates one `request_id` (UUID) per user attempt; a retry after failure reuses the same `request_id`,
 *   while a new deliberate action after success gets a new `request_id`.
 */
export function runOnce<T>(
  key: string,
  fn: (requestId: string) => Promise<T>,
  options?: RunOnceOptions
): Promise<T> {
  const existing = inFlightPromises.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const reuseOnError = options?.reuseRequestIdOnError ?? true;
  const requestId = options?.requestId || getOrCreateAttemptRequestId(key);

  const promise = (async () => {
    try {
      const result = await fn(requestId);
      clearAttemptRequestId(key);
      return result;
    } catch (err) {
      if (!reuseOnError) {
        clearAttemptRequestId(key);
      }
      throw err;
    } finally {
      inFlightPromises.delete(key);
    }
  })();

  inFlightPromises.set(key, promise);
  return promise;
}

/**
 * Deduplicates Realtime row events by row `id` so repeated deliveries or reconnect replays
 * do not insert duplicate items in UI state.
 */
export function createRealtimeDeduper(maxEntries: number = 500) {
  const seenIds = new Set<string>();

  return {
    shouldProcess(id: string | null | undefined): boolean {
      if (!id) return false;
      if (seenIds.has(id)) {
        return false;
      }
      if (seenIds.size >= maxEntries) {
        const oldest = seenIds.values().next().value;
        if (oldest !== undefined) {
          seenIds.delete(oldest);
        }
      }
      seenIds.add(id);
      return true;
    },
    markSeen(id: string | null | undefined): void {
      if (!id) return;
      seenIds.add(id);
    },
    clear(): void {
      seenIds.clear();
    },
  };
}
