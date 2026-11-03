import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../app/theme';
import { Button } from './Button';
import { Card } from './Card';
import { strings } from '../../constants/strings';

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  message = strings.errors.network,
  onRetry,
}) => {
  const theme = useAppTheme();

  return (
    <Card
      padding="lg"
      accentPosition="top"
      accentColor={theme.colors.danger}
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.dangerSoft,
          borderColor: theme.colors.danger,
        },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: theme.colors.surface }]}>
        <Ionicons name="cloud-offline-outline" size={28} color={theme.colors.dangerText} />
      </View>
      <Text style={[styles.title, { color: theme.colors.dangerText }]}>
        {strings.common.errorTitle}
      </Text>
      <Text style={[styles.message, { color: theme.colors.dangerText }]}>{message}</Text>
      {onRetry && (
        <Button
          title={strings.common.retry}
          onPress={onRetry}
          variant="danger"
          size="md"
          icon="refresh"
        />
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  container: { alignItems: 'center', marginVertical: 16 },
  iconWrap: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: { fontSize: 17, fontWeight: '800', marginBottom: 6, textAlign: 'center' },
  message: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 16, maxWidth: 460 },
});
