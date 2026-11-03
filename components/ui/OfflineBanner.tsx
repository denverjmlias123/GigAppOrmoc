import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { strings } from '../../constants/strings';
import { useAppTheme } from '../../app/theme';
import { useAuth } from '../../hooks/useAuth';

export function useNetworkStatus(): { isOffline: boolean; isOnline: boolean } {
  const [isOffline, setIsOffline] = useState<boolean>(() => {
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      return !navigator.onLine;
    }
    return false;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return;
    }

    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return { isOffline, isOnline: !isOffline };
}

export const OfflineBanner: React.FC = () => {
  const { isOffline: webOffline } = useNetworkStatus();
  const { isOffline: authOffline } = useAuth();
  const theme = useAppTheme();
  let insets = { top: 0, bottom: 0, left: 0, right: 0 };
  try {
    insets = useSafeAreaInsets();
  } catch {
    // In case rendered outside SafeAreaProvider
  }

  const isOffline = webOffline || authOffline;

  if (!isOffline) {
    return null;
  }

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={[
        styles.banner,
        {
          paddingTop: Platform.OS === 'web' ? 8 : Math.max(insets.top, 8),
          backgroundColor: '#0F172A',
          borderBottomColor: 'rgba(255,255,255,0.12)',
        },
      ]}
    >
      <View style={styles.content}>
        <Ionicons name="cloud-offline-outline" size={16} color="#FBBF24" />
        <Text style={styles.text}>
          Offline mode — displaying cached gigs. Changes will sync when reconnected.
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    paddingBottom: 8,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    zIndex: 9999,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  text: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F8FAFC',
    textAlign: 'center',
  },
});
