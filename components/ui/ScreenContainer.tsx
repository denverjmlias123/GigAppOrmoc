import React from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  ViewStyle,
  RefreshControlProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, layout, useResponsive } from '../../lib/theme';

export interface ScreenContainerProps {
  scrollable?: boolean;
  preset?: 'scroll' | 'fixed';
  backgroundColor?: string;
  children: React.ReactNode;
  style?: ViewStyle;
  contentContainerStyle?: ViewStyle;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  edges?: readonly ('top' | 'right' | 'bottom' | 'left')[];
}

export function ScreenContainer({
  scrollable,
  preset = 'scroll',
  backgroundColor,
  children,
  style,
  contentContainerStyle,
  refreshControl,
  header,
  footer,
  edges = ['top', 'left', 'right'],
}: ScreenContainerProps) {
  const { isDesktop, isTablet } = useResponsive();
  const isWide = isDesktop || isTablet;
  const isScroll = scrollable !== undefined ? scrollable : preset !== 'fixed';

  return (
    <SafeAreaView
      edges={edges}
      style={[
        styles.root,
        backgroundColor ? { backgroundColor } : null,
        style,
      ]}
    >
      {header && <View style={styles.headerWrapper}>{header}</View>}
      {isScroll ? (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.scrollContent,
            isWide && styles.wideContent,
            contentContainerStyle,
          ]}
          refreshControl={refreshControl}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.staticContent, isWide && styles.wideContent, contentContainerStyle]}>
          {children}
        </View>
      )}
      {footer && <View style={styles.footerWrapper}>{footer}</View>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
    width: '100%',
  },
  scrollContent: {
    flexGrow: 1,
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  staticContent: {
    flex: 1,
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  wideContent: {
    maxWidth: layout.maxWidth,
    alignSelf: 'center',
    paddingHorizontal: 24,
  },
  headerWrapper: {
    width: '100%',
  },
  footerWrapper: {
    width: '100%',
  },
});

export default ScreenContainer;
