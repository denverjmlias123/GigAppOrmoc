import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../app/theme';
import { Badge } from './Badge';
import { strings } from '../../constants/strings';

export interface GigSummary {
  id: string;
  title: string;
  category_name?: string;
  price_min: number; // in centavos
  price_max: number; // in centavos
  work_type: 'remote' | 'face_to_face' | 'hybrid';
  area?: string;
  application_deadline: string;
  deadline: string;
  status: string;
  client?: {
    display_name?: string;
    client_rating_avg?: number;
    client_rating_count?: number;
  };
}

interface GigCardProps {
  gig: GigSummary;
  onPress?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  style?: any;
  /** Override the status badge colors (e.g. make "open" appear green in client dashboard) */
  statusBadgeOverride?: { bg: string; text: string };
}

export const formatPrice = (centavos: number): string => {
  const pesos = centavos / 100;
  return `₱${pesos.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};

export const getWorkTypeIcon = (workType: string): string => {
  switch (workType) {
    case 'remote':
      return '💻 Remote';
    case 'face_to_face':
      return '🤝 Face-to-face';
    case 'hybrid':
      return '🔄 Hybrid';
    default:
      return workType;
  }
};

const workTypeMeta: Record<string, { label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = {
  remote: { label: 'Remote', icon: 'laptop-outline' },
  face_to_face: { label: 'Face-to-face', icon: 'people-outline' },
  hybrid: { label: 'Hybrid', icon: 'swap-horizontal-outline' },
};

export const GigCard: React.FC<GigCardProps> = React.memo(function GigCard({
  gig,
  onPress,
  onDelete,
  deleting = false,
  style,
  statusBadgeOverride,
}) {
  const theme = useAppTheme();
  const c = theme.colors;
  const [hovered, setHovered] = React.useState(false);

  const priceDisplay =
    gig.price_min === gig.price_max
      ? formatPrice(gig.price_min)
      : `${formatPrice(gig.price_min)} – ${formatPrice(gig.price_max)}`;

  const deadlineDate = gig.application_deadline ? new Date(gig.application_deadline) : null;
  const deadlineFormatted =
    deadlineDate && !isNaN(deadlineDate.getTime())
      ? deadlineDate.toLocaleDateString('en-PH', {
          month: 'short',
          day: 'numeric',
        })
      : '';

  const meta =
    (gig.work_type && workTypeMeta[gig.work_type]) || {
      label: gig.work_type || 'Gig',
      icon: 'briefcase-outline' as const,
    };
  const normalizedStatus = String(gig.status || '').toLowerCase().trim();
  // Freelancers browse open gigs, so "Open" is noise for them; clients manage status.
  const showStatus = theme.isClient || normalizedStatus !== 'open';

  // Compute badge colors: allow override (e.g. green for "open" in client dashboard)
  const defaultColors = (() => {
    switch (normalizedStatus) {
      case 'open':
      case 'active':
      case 'in_progress':
        return { bg: c.primarySoft, text: c.primary };
      case 'pending':
      case 'countered':
      case 'revision_requested':
      case 'suspended':
        return { bg: c.warningSoft, text: c.warningText };
      case 'approved':
      case 'confirmed':
      case 'completed':
        return { bg: c.successSoft, text: c.successText };
      case 'declined':
      case 'cancelled':
      case 'expired':
      case 'disputed':
      case 'deleted':
        return { bg: c.dangerSoft, text: c.dangerText };
      default:
        return { bg: c.surfaceAlt, text: c.muted };
    }
  })();

  const badgeColors =
    normalizedStatus === 'open' && statusBadgeOverride
      ? statusBadgeOverride
      : defaultColors;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: c.surface,
          borderColor: hovered ? c.primary : c.border,
          borderWidth: 1,
          borderRadius: 12,
        },
        style,
      ]}
    >
      <Pressable
        style={(state: any) => [
          styles.pressableInner,
          {
            opacity: state.pressed ? 0.92 : 1,
            ...({ cursor: 'pointer' } as any),
          },
        ]}
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityRole="button"
        accessibilityLabel={`${gig.title}, ${priceDisplay}`}
      >
        <View>
          <View style={styles.topRow}>
            <View style={[styles.categoryBadge, { backgroundColor: c.primarySoft, borderRadius: theme.radii.chip }]}>
              <Text style={[styles.categoryText, { color: c.primary }]} numberOfLines={1} ellipsizeMode="tail">
                {gig.category_name || 'General'}
              </Text>
            </View>
            {showStatus ? (
              <Badge status={gig.status} bgColor={badgeColors.bg} textColor={badgeColors.text} />
            ) : null}
          </View>

          <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
            {gig.title}
          </Text>

          <Text style={[styles.price, { color: c.primary }]}>{priceDisplay}</Text>

          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Ionicons name={meta.icon} size={15} color={c.muted} />
              <Text style={[styles.metaText, { color: c.muted }]}>{meta.label}</Text>
            </View>
            {gig.area ? (
              <View style={styles.metaItem}>
                <Ionicons name="location-outline" size={15} color={c.muted} />
                <Text style={[styles.metaText, { color: c.muted }]} numberOfLines={1}>
                  {gig.area}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={[styles.footerRow, { borderTopColor: c.border }]}>
          <View style={styles.metaItem}>
            <Ionicons name="time-outline" size={15} color={c.muted} />
            <Text style={[styles.metaText, { color: c.muted }]}>Apply by {deadlineFormatted}</Text>
          </View>
          {gig.client && !theme.isClient ? (
            <View style={styles.metaItem}>
              <Ionicons name="star" size={14} color={c.spark} />
              <Text style={[styles.clientRating, { color: c.text }]}>
                {Number(gig.client.client_rating_avg || 0).toFixed(1)} ({gig.client.client_rating_count || 0})
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>
      {onDelete ? (
        <Pressable
          onPress={onDelete}
          disabled={deleting}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${gig.title}`}
          style={[styles.deleteButton, { borderTopColor: c.border }]}
        >
          <Ionicons name="trash-outline" size={16} color={c.danger} />
          <Text style={[styles.deleteText, { color: c.danger }]}>{deleting ? strings.gigs.deletingGig : strings.gigs.deleteGigBtn}</Text>
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  card: { padding: 16, marginBottom: 12 },
  pressableInner: { flex: 1, justifyContent: 'space-between' },
  deleteButton: { minHeight: 44, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 12, paddingTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  deleteText: { fontSize: 13, fontWeight: '700' },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' },
  categoryBadge: { paddingHorizontal: 10, paddingVertical: 4, flex: 1, minWidth: 0 },
  categoryText: { fontSize: 12, fontWeight: '700' },
  title: { fontSize: 16, fontWeight: '700', lineHeight: 22, letterSpacing: -0.2, marginBottom: 6 },
  price: { fontSize: 19, fontWeight: '700', letterSpacing: -0.3, marginBottom: 10, fontVariant: ['tabular-nums'] },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 14, marginBottom: 12 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  metaText: { fontSize: 13, fontWeight: '500' },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  clientRating: { fontSize: 12, fontWeight: '700' },
});
