import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../app/theme';
import { Button } from './Button';
import { Card } from './Card';

interface EmptyStateProps {
  title: string;
  description: string;
  actionTitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Ionicons name. Legacy emoji values are ignored in favor of the default. */
  icon?: React.ComponentProps<typeof Ionicons>['name'] | string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  actionTitle,
  actionLabel,
  onAction,
  icon,
}) => {
  const theme = useAppTheme();
  const resolvedActionTitle = actionTitle || actionLabel;
  const iconName = (typeof icon === 'string' && /^[a-z0-9-]+$/.test(icon)
    ? icon
    : 'albums-outline') as any;

  return (
    <Card
      tone="outline"
      padding="lg"
      style={[
        styles.container,
        {
          borderColor: theme.colors.border,
          borderTopWidth: 4,
          borderTopColor: theme.colors.primary,
          backgroundColor: theme.colors.surface,
          borderRadius: 20,
          borderWidth: 1,
          borderStyle: 'solid',
          ...(Platform.OS === 'web'
            ? ({
                boxShadow: '0 8px 24px -10px rgba(15, 23, 42, 0.06)',
              } as any)
            : {
                shadowColor: '#0F172A',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.04,
                shadowRadius: 10,
                elevation: 2,
              }),
        },
      ]}
    >
      <View
        style={[
          styles.iconWrap,
          {
            backgroundColor: theme.colors.primarySoft,
            borderColor: 'transparent',
          },
        ]}
      >
        <Ionicons name={iconName} size={30} color={theme.colors.primary} />
      </View>
      <Text style={[styles.title, { color: theme.colors.text }]}>{title}</Text>
      <Text style={[styles.description, { color: theme.colors.muted }]}>{description}</Text>
      {resolvedActionTitle && onAction && (
        <Button
          title={resolvedActionTitle}
          onPress={onAction}
          variant="primary"
          size="md"
          rightIcon="arrow-forward"
        />
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginVertical: 14,
    borderRadius: 20,
    paddingVertical: 28,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: { fontSize: 18, fontWeight: '800', marginBottom: 6, textAlign: 'center' },
  description: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 20,
    maxWidth: 440,
  },
});
