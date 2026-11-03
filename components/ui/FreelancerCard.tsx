import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../app/theme';
import { Avatar } from './Avatar';
import { FreelancerSummary } from '../../services/profile';

interface FreelancerCardProps {
  freelancer: FreelancerSummary;
  onPress: () => void;
  compact?: boolean;
  style?: any;
}

const formatAvailability = (
  availability: string | null | undefined
): { label: string; dotColor: string } | null => {
  switch (availability) {
    case 'available_now':
      return { label: 'Available Now', dotColor: '#10B981' };
    case 'part_time':
      return { label: 'Part-time', dotColor: '#F59E0B' };
    case 'weekends':
      return { label: 'Weekends', dotColor: '#6366F1' };
    case 'not_taking_work':
      return { label: 'Busy', dotColor: '#9CA3AF' };
    default:
      return null;
  }
};

const formatExperience = (exp: string | null | undefined): string | null => {
  switch (exp) {
    case 'lt_1':
      return '< 1 yr exp';
    case '1_3':
      return '1–3 yrs exp';
    case '3_5':
      return '3–5 yrs exp';
    case '5_plus':
      return '5+ yrs exp';
    default:
      return null;
  }
};

const formatWorkType = (
  workType: string
): { label: string; icon: React.ComponentProps<typeof Ionicons>['name'] } => {
  switch (workType) {
    case 'remote':
      return { label: 'Remote', icon: 'laptop-outline' };
    case 'face_to_face':
      return { label: 'On-site', icon: 'people-outline' };
    case 'hybrid':
      return { label: 'Hybrid', icon: 'swap-horizontal-outline' };
    default:
      return { label: workType, icon: 'briefcase-outline' };
  }
};

export const FreelancerCard: React.FC<FreelancerCardProps> = React.memo(function FreelancerCard({
  freelancer,
  onPress,
  compact = false,
  style,
}) {
  const theme = useAppTheme();

  const ratingText =
    freelancer.freelancer_rating_avg > 0
      ? freelancer.freelancer_rating_avg.toFixed(1)
      : 'New';

  const expLabel = formatExperience(freelancer.experience_years);
  const avail = formatAvailability(freelancer.availability);

  // Subtitle hierarchy: headline -> bio snippet -> skills preview -> fallback
  const subtitle =
    freelancer.headline?.trim() ||
    (freelancer.bio?.trim()
      ? freelancer.bio.trim().length > 65
        ? `${freelancer.bio.trim().slice(0, 65)}…`
        : freelancer.bio.trim()
      : freelancer.skills && freelancer.skills.length > 0
      ? freelancer.skills.slice(0, 2).join(' · ')
      : 'Ormoc Freelancer');

  return (
    <Pressable
      style={(state: any) => [
        styles.card,
        compact ? styles.compactCard : styles.fullCard,
        {
          backgroundColor: theme.colors.surface,
          borderColor: state.hovered ? theme.colors.primary : theme.colors.border,
          borderWidth: 1,
          borderRadius: theme.radii.card,
          opacity: state.pressed ? 0.92 : 1,
          transform: [{ scale: state.pressed ? 0.985 : 1 }],
          ...({ cursor: 'pointer' } as any),
        },
        theme.shadow.raised,
        style,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${freelancer.display_name}, ${subtitle}`}
    >
      {/* Top Header Row: Avatar, Info, and Availability */}
      <View style={styles.topRow}>
        <Avatar
          name={freelancer.display_name}
          imageUri={freelancer.avatar_path}
          size={compact ? 44 : 50}
        />
        <View style={styles.nameCol}>
          <View style={styles.nameHeaderRow}>
            <Text
              style={[styles.name, { color: theme.colors.text }]}
              numberOfLines={1}
            >
              {freelancer.display_name}
            </Text>
            {avail && (
              <View style={[styles.availBadge, { backgroundColor: theme.colors.surfaceAlt }]}>
                <View style={[styles.availDot, { backgroundColor: avail.dotColor }]} />
                <Text style={[styles.availText, { color: theme.colors.text }]}>
                  {avail.label}
                </Text>
              </View>
            )}
          </View>

          <Text
            style={[styles.headline, { color: theme.colors.muted }]}
            numberOfLines={compact ? 1 : 2}
          >
            {subtitle}
          </Text>

          <View style={styles.metaRow}>
            <Ionicons name="location-outline" size={12} color={theme.colors.muted} />
            <Text style={[styles.metaText, { color: theme.colors.muted }]} numberOfLines={1}>
              {freelancer.area || 'Ormoc City'}
            </Text>
            {expLabel && (
              <>
                <Text style={[styles.metaBullet, { color: theme.colors.muted }]}>·</Text>
                <Text style={[styles.metaText, { color: theme.colors.muted }]}>
                  {expLabel}
                </Text>
              </>
            )}
          </View>
        </View>

        {!compact && (
          <View style={styles.viewActionCol}>
            <View
              style={[
                styles.viewProfileBtn,
                { backgroundColor: theme.colors.primarySoft },
              ]}
            >
              <Text style={[styles.viewProfileText, { color: theme.colors.primaryDark }]}>
                View
              </Text>
              <Ionicons name="chevron-forward" size={14} color={theme.colors.primaryDark} />
            </View>
          </View>
        )}
      </View>

      {/* Stats row: Rating, Completed, Work Types */}
      <View style={styles.statsRow}>
        <View style={[styles.statChip, { backgroundColor: theme.colors.surfaceAlt }]}>
          <Ionicons name="star" size={12} color="#F59E0B" />
          <Text style={[styles.statText, { color: theme.colors.text }]}>
            {ratingText}
            {freelancer.freelancer_rating_count > 0 && (
              <Text style={{ color: theme.colors.muted }}> ({freelancer.freelancer_rating_count})</Text>
            )}
          </Text>
        </View>

        <View style={[styles.statChip, { backgroundColor: theme.colors.surfaceAlt }]}>
          <Ionicons name="checkmark-circle-outline" size={12} color={theme.colors.success} />
          <Text style={[styles.statText, { color: theme.colors.text }]}>
            {freelancer.freelancer_completed_gigs}{' '}
            {freelancer.freelancer_completed_gigs === 1 ? 'gig' : 'gigs'}
          </Text>
        </View>

        {/* Work type badges (e.g. Remote, On-site) */}
        {freelancer.work_types && freelancer.work_types.length > 0 && (
          freelancer.work_types.slice(0, compact ? 1 : 2).map((wt) => {
            const meta = formatWorkType(wt);
            return (
              <View
                key={wt}
                style={[styles.statChip, { backgroundColor: theme.colors.surfaceAlt }]}
              >
                <Ionicons name={meta.icon} size={12} color={theme.colors.muted} />
                <Text style={[styles.statText, { color: theme.colors.muted }]}>
                  {meta.label}
                </Text>
              </View>
            );
          })
        )}
      </View>

      {/* Skills row */}
      {freelancer.skills && freelancer.skills.length > 0 && (
        <View style={styles.skillsRow}>
          {freelancer.skills.slice(0, compact ? 2 : 4).map((skill, idx) => (
            <View
              key={`${skill}-${idx}`}
              style={[styles.skillChip, { backgroundColor: theme.colors.primarySoft }]}
            >
              <Text
                style={[styles.skillChipText, { color: theme.colors.primaryDark }]}
                numberOfLines={1}
              >
                {skill}
              </Text>
            </View>
          ))}
          {freelancer.skills.length > (compact ? 2 : 4) && (
            <Text style={[styles.moreSkillsText, { color: theme.colors.muted }]}>
              +{freelancer.skills.length - (compact ? 2 : 4)}
            </Text>
          )}
        </View>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderWidth: 1,
  },
  fullCard: {
    marginBottom: 12,
  },
  compactCard: {
    width: 250,
    marginRight: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  nameCol: {
    flex: 1,
  },
  nameHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    flexWrap: 'wrap',
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  availBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  availDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  availText: {
    fontSize: 10,
    fontWeight: '700',
  },
  headline: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 4,
  },
  metaText: {
    fontSize: 11,
  },
  metaBullet: {
    fontSize: 11,
    marginHorizontal: 1,
  },
  viewActionCol: {
    justifyContent: 'center',
    alignSelf: 'center',
    paddingLeft: 4,
  },
  viewProfileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  viewProfileText: {
    fontSize: 12,
    fontWeight: '700',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  statText: {
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  skillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  skillChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    maxWidth: 130,
  },
  skillChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  moreSkillsText: {
    fontSize: 11,
    fontWeight: '500',
  },
});
