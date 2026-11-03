import { useState, useEffect } from 'react';
import { Platform } from 'react-native';
import { subscribeNetworkStatus, offlineSyncService } from '../services/offlineSync';

export function useNetworkStatus(): { isOnline: boolean } {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && 'onLine' in navigator) {
      return navigator.onLine && offlineSyncService.isOnline();
    }
    return offlineSyncService.isOnline();
  });

  useEffect(() => {
    // 1. Listen to service-level network events
    const unsubscribeService = subscribeNetworkStatus((online) => {
      setIsOnline(online);
    });

    // 2. Listen to web browser network change events
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const handleOnline = () => {
        offlineSyncService.setKnownOffline(false);
        setIsOnline(true);
      };
      const handleOffline = () => {
        offlineSyncService.setKnownOffline(true);
        setIsOnline(false);
      };

      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);

      return () => {
        unsubscribeService();
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }

    return () => {
      unsubscribeService();
    };
  }, []);

  return { isOnline };
}
