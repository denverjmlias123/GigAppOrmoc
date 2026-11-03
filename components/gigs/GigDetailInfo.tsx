import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GigDetail } from '../../services/gigs';
import { AppTheme } from '../../app/theme';
import { formatPrice, getWorkTypeIcon } from '../ui/GigCard';
import { Avatar } from '../ui/Avatar';
import { Card } from '../ui/Card';

interface GigDetailInfoProps {
  gig: GigDetail;
  theme: AppTheme;
  onClientPress?: () => void;
}

export function GigDetailInfo({ gig, theme, onClientPress }: GigDetailInfoProps) {
  const priceDisplay =
    gig.price_min === gig.price_max
      ? formatPrice(gig.price_min)
      : `${formatPrice(gig.price_min)} - ${formatPrice(gig.price_max)}`;

  const appDeadline = new Date(gig.application_deadline).toLocaleDateString('en-PH', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const completionDeadline = new Date(gig.deadline).toLocaleDateString('en-PH', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <>
      {/* Main Info */}
      <Card accentPosition="top" accentColor={theme.colors.primary}>
        <View style={[styles.categoryPill, { backgroundColor: theme.colors.primarySoft }]}>
          <Ionicons name="pricetag-outline" size={12} color={theme.colors.primary} />
          <Text style={[styles.categoryBadge, { color: theme.colors.primary }]}>
            {gig.category_name || 'General Category'}
          </Text>
        </View>
        <Text style={[styles.title, { color: theme.colors.text }]}>{gig.title}</Text>
        <Text style={[styles.price, { color: theme.colors.primary }]}>{priceDisplay}</Text>

        <Card tone="inset" padding="sm" style={{ marginBottom: 0 }}>
          <View style={styles.gridMeta}>
            <View style={styles.metaCol}>
              <Text style={[styles.metaLabel, { color: theme.colors.muted }]}>Work Type</Text>
              <Text style={[styles.metaVal, { color: theme.colors.text }]}>
                {getWorkTypeIcon(gig.work_type)}
              </Text>
            </View>
            {gig.area ? (
              <View style={styles.metaCol}>
                <Text style={[styles.metaLabel, { color: theme.colors.muted }]}>Location</Text>
                <Text style={[styles.metaVal, { color: theme.colors.text }]}>📍 {gig.area}</Text>
              </View>
            ) : null}
            <View style={styles.metaCol}>
              <Text style={[styles.metaLabel, { color: theme.colors.muted }]}>Apply Deadline</Text>
              <Text style={[styles.metaVal, { color: theme.colors.text }]}>{appDeadline}</Text>
            </View>
            <View style={styles.metaCol}>
              <Text style={[styles.metaLabel, { color: theme.colors.muted }]}>
                Project Deadline
              </Text>
              <Text style={[styles.metaVal, { color: theme.colors.text }]}>
                {completionDeadline}
              </Text>
            </View>
          </View>
        </Card>
      </Card>

      {/* Description */}
      <Card headerTitle="Description" headerIcon="document-text-outline">
        <Text style={[styles.bodyText, { color: theme.colors.text }]}>{gig.description}</Text>
      </Card>

      {/* Requirements */}
      {gig.requirements ? (
        <Card headerTitle="Requirements" headerIcon="checkbox-outline">
          <Text style={[styles.bodyText, { color: theme.colors.text }]}>{gig.requirements}</Text>
        </Card>
      ) : null}

      {/* Client Profile Summary */}
      <Card
        headerTitle="Posted By"
        headerIcon="person-outline"
        onPress={onClientPress}
      >
        <View style={styles.clientRow}>
          <Avatar
            name={gig.client.display_name || 'Client'}
            imageUri={(gig.client as any).avatar_path}
            size={48}
          />
          <View style={styles.clientInfo}>
            <Text style={[styles.clientName, { color: theme.colors.text }]}>
              {gig.client.display_name}
            </Text>
            <Text style={[styles.clientStats, { color: theme.colors.muted }]}>
              ★ {Number(gig.client.client_rating_avg || 0).toFixed(1)} (
              {gig.client.client_rating_count || 0} reviews) •{' '}
              {gig.client.client_completed_gigs || 0} completed gigs
            </Text>
          </View>
          {onClientPress ? (
            <Ionicons name="chevron-forward" size={18} color={theme.colors.primary} />
          ) : null}
        </View>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginBottom: 8,
  },
  categoryBadge: {
    fontSize: 12, lineHeight: 16,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 28,
    marginBottom: 6,
  },
  price: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 14,
    fontVariant: ['tabular-nums'],
  },
  gridMeta: {
    gap: 10,
  },
  metaCol: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metaLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  metaVal: {
    fontSize: 13,
    fontWeight: '700',
  },
  bodyText: {
    fontSize: 15,
    lineHeight: 22,
  },
  clientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  clientInfo: {
    flex: 1,
  },
  clientName: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 2,
  },
  clientStats: {
    fontSize: 13,
    fontWeight: '500',
  },
});
