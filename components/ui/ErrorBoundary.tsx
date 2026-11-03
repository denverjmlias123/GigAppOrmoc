import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createRequestId } from '../../lib/errors';
import { theme } from '../../app/theme';
import { Button } from './Button';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  requestId: string;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      requestId: '',
    };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return {
      hasError: true,
      requestId: createRequestId(),
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(`[ErrorBoundary ${this.state.requestId}] Unhandled UI error:`, error, info.componentStack);
  }

  handleReload = (): void => {
    this.setState({ hasError: false, requestId: '' });
    if (typeof window !== 'undefined' && window.location && typeof window.location.reload === 'function') {
      window.location.reload();
    }
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]} accessibilityRole="alert">
          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
              },
              theme.shadow.raised,
            ]}
          >
            <View style={[styles.iconBadge, { backgroundColor: theme.colors.dangerSoft }]}>
              <Ionicons name="warning-outline" size={28} color={theme.colors.danger} />
            </View>
            <Text style={[styles.title, { color: theme.colors.text }]}>Something went wrong</Text>
            <Text style={[styles.subtitle, { color: theme.colors.muted }]}>
              We ran into an unexpected display issue. Your data is safe—please reload to continue.
            </Text>
            {Boolean(this.state.requestId) && (
              <View style={[styles.refPill, { backgroundColor: theme.colors.surfaceAlt }]}>
                <Text style={[styles.refCode, { color: theme.colors.muted }]}>
                  Support ID: {this.state.requestId}
                </Text>
              </View>
            )}
            <Button
              title="Something went wrong. Reload"
              onPress={this.handleReload}
              variant="primary"
              icon="refresh"
              fullWidth
            />
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    maxWidth: 460,
    width: '100%',
    padding: 26,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
  },
  iconBadge: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 14,
  },
  refPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 20,
  },
  refCode: {
    fontSize: 12,
    fontWeight: '600',
  },
});
