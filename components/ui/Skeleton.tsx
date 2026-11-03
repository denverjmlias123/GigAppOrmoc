import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, ViewStyle, Animated, Platform } from 'react-native';
import { useAppTheme } from '../../app/theme';

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = 20,
  borderRadius = 8,
  style,
}) => {
  const theme = useAppTheme();
  const pulseAnim = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.85,
          duration: 750,
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.35,
          duration: 750,
          useNativeDriver: Platform.OS !== 'web',
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: theme.colors.border,
          opacity: pulseAnim,
        },
        style,
      ]}
    />
  );
};

const SkeletonGigCard: React.FC<{ style?: ViewStyle }> = ({ style }) => {
  const theme = useAppTheme();
  return (
    <View
      style={[
        styles.cardContainer,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
        theme.shadow.card,
        style,
      ]}
    >
      <View style={styles.cardHeaderRow}>
        <Skeleton width="65%" height={20} borderRadius={6} />
        <Skeleton width="25%" height={24} borderRadius={12} />
      </View>
      <Skeleton width="90%" height={14} borderRadius={4} style={{ marginTop: 8 }} />
      <Skeleton width="70%" height={14} borderRadius={4} style={{ marginTop: 6 }} />
      <View style={styles.chipRow}>
        <Skeleton width={70} height={22} borderRadius={11} />
        <Skeleton width={85} height={22} borderRadius={11} />
        <Skeleton width={60} height={22} borderRadius={11} />
      </View>
    </View>
  );
};

export const SkeletonGigList: React.FC<{ count?: number }> = ({ count = 3 }) => {
  return (
    <View style={styles.listContainer}>
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonGigCard key={`skeleton-gig-${index}`} />
      ))}
    </View>
  );
};

const SkeletonMessageCard: React.FC<{ style?: ViewStyle }> = ({ style }) => {
  const theme = useAppTheme();
  return (
    <View
      style={[
        styles.messageCard,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
        style,
      ]}
    >
      <Skeleton width={48} height={48} borderRadius={24} />
      <View style={styles.messageContentCol}>
        <View style={styles.cardHeaderRow}>
          <Skeleton width="45%" height={16} borderRadius={4} />
          <Skeleton width={50} height={12} borderRadius={4} />
        </View>
        <Skeleton width={110} height={16} borderRadius={8} style={{ marginTop: 4 }} />
        <Skeleton width="80%" height={13} borderRadius={4} style={{ marginTop: 6 }} />
      </View>
    </View>
  );
};

export const SkeletonMessageList: React.FC<{ count?: number }> = ({ count = 4 }) => {
  return (
    <View style={styles.listContainer}>
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonMessageCard key={`skeleton-msg-${index}`} />
      ))}
    </View>
  );
};

const SkeletonActivityCard: React.FC<{ style?: ViewStyle }> = ({ style }) => {
  const theme = useAppTheme();
  return (
    <View
      style={[
        styles.cardContainer,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
        theme.shadow.card,
        style,
      ]}
    >
      <View style={styles.cardHeaderRow}>
        <Skeleton width="55%" height={18} borderRadius={6} />
        <Skeleton width={75} height={22} borderRadius={11} />
      </View>
      <View style={[styles.cardHeaderRow, { marginTop: 12 }]}>
        <Skeleton width={80} height={14} borderRadius={4} />
        <Skeleton width={90} height={18} borderRadius={6} />
      </View>
      <Skeleton width="100%" height={1} borderRadius={1} style={{ marginVertical: 12 }} />
      <View style={styles.cardHeaderRow}>
        <Skeleton width={120} height={14} borderRadius={4} />
        <Skeleton width={80} height={32} borderRadius={8} />
      </View>
    </View>
  );
};

export const SkeletonActivityList: React.FC<{ count?: number }> = ({ count = 3 }) => {
  return (
    <View style={styles.listContainer}>
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonActivityCard key={`skeleton-act-${index}`} />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  skeleton: {
    marginVertical: 2,
  },
  listContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 12,
  },
  cardContainer: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  messageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
  },
  messageContentCol: {
    flex: 1,
  },
});
