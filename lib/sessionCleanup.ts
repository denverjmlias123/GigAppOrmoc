import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

interface CleanupOptions {
  /**
   * When true (logout), also removes Supabase session tokens from storage.
   * When false (mode switch), keeps the auth session token while clearing all user/role caches,
   * Realtime channels, private image caches, drafts, and notification badge counts.
   */
  clearAuthStorage?: boolean;
}

const privateImageUrlCache = new Map<string, { url: string; expiresAt: number }>();
let cachedUnreadBadgeCount = 0;

function clearPrivateImageCache(): void {
  privateImageUrlCache.clear();
}

/**
 * Shared cleanup routine used by BOTH Logout and Mode Switch (RESILIENCE_V5_4.md Section 2B):
 * - Removes all active Supabase Realtime channels (notifications, chat, conversation unread)
 * - Clears in-memory query/service caches, private signed-URL image caches, and notification badge counts
 * - Removes stored drafts or private user keys from AsyncStorage / localStorage
 * - When clearAuthStorage = true, also clears Supabase session storage keys
 */
export async function performSharedCleanup(options: CleanupOptions = {}): Promise<void> {
  const { clearAuthStorage = false } = options;

  // 1. Reset in-memory caches, private signed image URLs, and badge counts
  clearPrivateImageCache();
  cachedUnreadBadgeCount = 0;
  void cachedUnreadBadgeCount;

  // 2. Unsubscribe and remove all Realtime channels
  try {
    await supabase.removeAllChannels();
  } catch {
    // Ignore channel cleanup errors when offline
  }

  // 3. Clean up AsyncStorage drafts, cached data, and (if logging out) auth tokens
  try {
    const keys = await AsyncStorage.getAllKeys();
    const keysToRemove = keys.filter((k) => {
      const isPrivateOrDraft =
        k.startsWith('gigormoc:draft:') ||
        k.startsWith('gigormoc:cache:') ||
        k.startsWith('gigormoc:private:') ||
        k.startsWith('gigormoc:badge:') ||
        k.startsWith('gigormoc:session:') ||
        k.startsWith('@offline_');
      const isAuthKey = k.startsWith('sb-') || k.includes('supabase');
      return isPrivateOrDraft || (clearAuthStorage && isAuthKey);
    });
    if (keysToRemove.length > 0) {
      await AsyncStorage.multiRemove(keysToRemove);
    } else if (clearAuthStorage) {
      await AsyncStorage.clear();
    }
  } catch {
    if (clearAuthStorage) {
      try {
        await AsyncStorage.clear();
      } catch {
        // Ignore
      }
    }
  }

  // 4. Clean up web localStorage drafts/caches and (if logging out) auth tokens
  if (typeof window !== 'undefined' && window?.localStorage) {
    try {
      Object.keys(window.localStorage).forEach((key) => {
        const isPrivateOrDraft =
          key.startsWith('gigormoc:draft:') ||
          key.startsWith('gigormoc:cache:') ||
          key.startsWith('gigormoc:private:') ||
          key.startsWith('gigormoc:badge:') ||
          key.startsWith('gigormoc:session:') ||
          key.startsWith('@offline_');
        const isAuthKey = key.startsWith('sb-') || key.includes('supabase');
        if (isPrivateOrDraft || (clearAuthStorage && isAuthKey)) {
          window.localStorage.removeItem(key);
        }
      });
    } catch {
      // Ignore web storage errors
    }
  }
}
