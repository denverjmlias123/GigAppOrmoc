import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, Briefcase, Zap, ShieldCheck, Sparkles } from 'lucide-react-native';
import { colors, borderRadius, typography, spacing, shadows } from '../../lib/theme';

export interface RoleBannerProps {
  activeMode: 'freelancer' | 'client' | string;
  showSwitchAction?: boolean;
}

export const RoleBanner: React.FC<RoleBannerProps> = ({
  activeMode,
  showSwitchAction = true,
}) => {
  const router = useRouter();
  const isFreelancer = activeMode === 'freelancer';

  const handlePress = () => {
    if (showSwitchAction) {
      router.push('/settings/mode');
    }
  };

  return (
    <TouchableOpacity
      activeOpacity={showSwitchAction ? 0.88 : 1}
      onPress={handlePress}
      disabled={!showSwitchAction}
      style={[
        styles.container,
        isFreelancer ? styles.freelancerContainer : styles.clientContainer,
      ]}
      accessibilityRole={showSwitchAction ? 'button' : 'none'}
      accessibilityLabel={`Active mode: ${isFreelancer ? 'Freelancer' : 'Client'}. Tap to switch mode.`}
    >
      {/* Decorative Ormoc Accent Strip */}
      <View
        style={[
          styles.leftAccentBar,
          { backgroundColor: isFreelancer ? colors.freelancer : colors.ormocGold },
        ]}
      />

      <View style={styles.leftRow}>
        <View
          style={[
            styles.iconWrapper,
            isFreelancer ? styles.freelancerIconWrapper : styles.clientIconWrapper,
          ]}
        >
          {isFreelancer ? (
            <Zap size={18} color={colors.freelancer} />
          ) : (
            <Briefcase size={18} color={colors.client} />
          )}
        </View>

        <View style={styles.textCol}>
          <View style={styles.titleRow}>
            <Text
              style={[
                styles.modeLabel,
                isFreelancer ? styles.freelancerText : styles.clientText,
              ]}
            >
              {isFreelancer ? 'Freelancer Mode' : 'Client Mode'}
            </Text>

            <View
              style={[
                styles.activePill,
                isFreelancer ? styles.freelancerPill : styles.clientPill,
              ]}
            >
              <ShieldCheck
                size={10}
                color={isFreelancer ? '#0284C7' : '#B45309'}
              />
              <Text
                style={[
                  styles.activePillText,
                  { color: isFreelancer ? '#0369A1' : '#92400E' },
                ]}
              >
                ACTIVE ROLE
              </Text>
            </View>
          </View>

          <Text style={styles.subtext} numberOfLines={1}>
            {isFreelancer
              ? 'Browsing Ormoc gigs, proposals & milestone payouts'
              : 'Posting Ormoc gigs, hiring local talent & releasing funds'}
          </Text>
        </View>
      </View>

      {showSwitchAction && (
        <View
          style={[
            styles.rightAction,
            isFreelancer ? styles.freelancerRightAction : styles.clientRightAction,
          ]}
        >
          <Text
            style={[
              styles.actionText,
              isFreelancer ? styles.freelancerActionText : styles.clientActionText,
            ]}
          >
            Switch
          </Text>
          <ChevronRight
            size={13}
            color={isFreelancer ? colors.freelancer : colors.ormocGoldDark}
          />
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingLeft: spacing.md + 6,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    marginVertical: spacing.xs + 2,
    position: 'relative',
    overflow: 'hidden',
    ...shadows.sm,
  },
  leftAccentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  freelancerContainer: {
    backgroundColor: '#F0F9FF',
    borderColor: '#BAE6FD',
  },
  clientContainer: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  leftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    flex: 1,
    marginRight: spacing.sm,
  },
  iconWrapper: {
    width: 38,
    height: 38,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  freelancerIconWrapper: {
    backgroundColor: '#FFFFFF',
    borderColor: '#BAE6FD',
  },
  clientIconWrapper: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FDE68A',
  },
  textCol: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
    flexWrap: 'wrap',
  },
  modeLabel: {
    fontSize: typography.sm + 1,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  freelancerText: {
    color: '#0369A1',
  },
  clientText: {
    color: '#92400E',
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  freelancerPill: {
    backgroundColor: '#E0F2FE',
    borderColor: '#BAE6FD',
  },
  clientPill: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
  },
  activePillText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  subtext: {
    fontSize: typography.xs,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  rightAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
  },
  freelancerRightAction: {
    borderColor: '#BAE6FD',
  },
  clientRightAction: {
    borderColor: '#FDE68A',
  },
  actionText: {
    fontSize: typography.xs,
    fontWeight: '700',
  },
  freelancerActionText: {
    color: colors.freelancer,
  },
  clientActionText: {
    color: '#92400E',
  },
});

export default RoleBanner;
