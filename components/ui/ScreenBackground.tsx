import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { useAppTheme } from '../../app/theme';

interface ScreenBackgroundProps {
  children?: React.ReactNode;
  style?: ViewStyle;
  /** Kept for backwards compatibility */
  aurora?: boolean;
}

export const ScreenBackground: React.FC<ScreenBackgroundProps> = ({
  children,
  style,
}) => {
  const theme = useAppTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }, style]}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
