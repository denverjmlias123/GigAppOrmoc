import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Easing,
  Platform,
  ScrollView,
  useWindowDimensions,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme, lightFreelancerTheme, clientTheme, useResponsiveLayout } from '../theme';
import { useAuth } from '../../hooks/useAuth';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const USE_NATIVE = Platform.OS !== 'web';

/** Gentle fade + rise on mount, staggered by `delay`. */
function useEntrance(delay = 0) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, {
      toValue: 1,
      duration: 650,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: USE_NATIVE,
    }).start();
  }, [v, delay]);
  return {
    opacity: v,
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
  };
}

function LocationBadge() {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.05,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: USE_NATIVE,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: USE_NATIVE,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  return (
    <Animated.View style={[styles.locationBadge, { transform: [{ scale: pulse }] }]}>
      <View style={styles.locationPulseDot} />
      <Ionicons name="location" size={13} color="#FBBF24" />
      <Text style={styles.locationBadgeText}>Exclusively for Ormoc City</Text>
    </Animated.View>
  );
}

// Interactive & Animated Preview Cards showing real marketplace flow
function GigPreview({ compact }: { compact?: boolean }) {
  const theme = useAppTheme();
  return (
    <View
      style={[
        styles.previewCard,
        styles.glassCard,
        {
          borderTopColor: '#3B82F6',
          borderRadius: 18,
        },
        compact && { padding: 14 },
      ]}
    >
      <View style={styles.rowBetween}>
        <View style={styles.categoryTag}>
          <Text style={styles.categoryTagText}>Home Services</Text>
        </View>
        <View style={styles.statusPill}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>Open for Proposals</Text>
        </View>
      </View>
      <Text style={styles.cardTitle}>Aircon Cleaning & Repair (2 Units)</Text>
      <Text style={styles.cardPrice}>₱1,200 – ₱1,800</Text>
      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <Ionicons name="location-outline" size={13} color="#94A3B8" />
          <Text style={styles.metaText}>Cogon, Ormoc City</Text>
        </View>
        <View style={styles.metaItem}>
          <Ionicons name="time-outline" size={13} color="#94A3B8" />
          <Text style={styles.metaText}>Needs service this week</Text>
        </View>
      </View>
    </View>
  );
}

function ProposalPreview() {
  return (
    <View
      style={[
        styles.previewCard,
        styles.smallCard,
        styles.glassCard,
        {
          borderTopColor: '#F59E0B',
          borderRadius: 18,
        },
      ]}
    >
      <View style={[styles.avatarCircle, { backgroundColor: 'rgba(245, 158, 11, 0.20)' }]}>
        <Text style={[styles.avatarText, { color: '#FBBF24' }]}>MS</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.smallTitle}>Maria S. submitted a proposal</Text>
        <View style={styles.metaItem}>
          <Ionicons name="star" size={12} color="#FBBF24" />
          <Text style={styles.metaText}>4.9 rating · 32 completed local gigs</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#64748B" />
    </View>
  );
}

function MilestonePreview() {
  return (
    <View
      style={[
        styles.previewCard,
        styles.smallCard,
        styles.glassCard,
        {
          backgroundColor: 'rgba(16, 185, 129, 0.12)',
          borderTopColor: '#10B981',
          borderColor: 'rgba(16, 185, 129, 0.35)',
          borderRadius: 18,
        },
      ]}
    >
      <View style={[styles.avatarCircle, { backgroundColor: '#10B981' }]}>
        <Ionicons name="checkmark" size={18} color="#FFFFFF" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.smallTitle, { color: '#34D399', fontWeight: '700' }]}>
          Milestone 1 Approved & Confirmed
        </Text>
        <Text style={[styles.metaText, { color: '#A7F3D0' }]}>
          ₱900 confirmed received directly
        </Text>
      </View>
    </View>
  );
}

function Showcase({ wide }: { wide: boolean }) {
  const enter = useEntrance(250);
  const floatAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const float = Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: -4,
          duration: 2500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: USE_NATIVE,
        }),
        Animated.timing(floatAnim, {
          toValue: 0,
          duration: 2500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: USE_NATIVE,
        }),
      ])
    );
    float.start();
    return () => float.stop();
  }, [floatAnim]);

  return (
    <Animated.View style={[{ width: '100%', maxWidth: 460, alignSelf: 'center' }, enter]}>
      <Animated.View style={[{ gap: 12 }, { transform: [{ translateY: floatAnim }] }]}>
        <GigPreview compact={!wide} />
        <ProposalPreview />
        <MilestonePreview />
      </Animated.View>
    </Animated.View>
  );
}

const trustFeatures: { icon: IconName; title: string; desc: string }[] = [
  {
    icon: 'shield-checkmark',
    title: '18+ Ormoc Locals Only',
    desc: 'Confirmed age & local profiles protecting our community.',
  },
  {
    icon: 'layers',
    title: 'Milestone Agreements',
    desc: 'Clear scope & deliverables agreed before any work starts.',
  },
  {
    icon: 'wallet-outline',
    title: 'Direct Payments',
    desc: 'Pay freely via GCash, Maya, or cash with no middleman escrow fees.',
  },
];

export default function WelcomeScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { authNotice, clearAuthNotice } = useAuth();
  const { width } = useWindowDimensions();
  const { topSpace, bottomSpace } = useResponsiveLayout();
  const wide = width >= theme.layout.wideBreakpoint;

  const eBrand = useEntrance(0);
  const eHead = useEntrance(120);
  const eActions = useEntrance(380);

  const goSignup = () => {
    clearAuthNotice();
    router.push('/(auth)/signup-step1');
  };

  const goLogin = () => {
    clearAuthNotice();
    router.push('/(auth)/login');
  };

  const copy = (
    <View style={wide ? styles.copyWide : undefined}>
      <Animated.View style={[styles.brandRow, eBrand]}>
        <Image
          source={require('../../assets/logo.png')}
          style={styles.logoMark}
          resizeMode="contain"
          accessibilityLabel="Gigormoc logo"
        />
        <View>
          <Text style={styles.brandTitle}>Gigormoc</Text>
          <Text style={styles.brandSubtitle}>Local Freelance Marketplace</Text>
        </View>
      </Animated.View>

      <Animated.View style={eHead}>
        <LocationBadge />

        <Text style={[styles.headline, wide && styles.headlineWide]}>
          Reliable local work,{'\n'}
          <Text style={{ color: '#60A5FA' }}>trusted</Text> in Ormoc.
        </Text>

        <Text style={styles.sub}>
          Whether you want to earn as a skilled freelancer or hire trusted help for home services, creative tasks, or tech projects — manage milestones and direct payments with confidence.
        </Text>

        <View style={styles.roleComparisonRow}>
          <View style={[styles.roleMiniBox, { borderColor: 'rgba(96, 165, 250, 0.32)' }]}>
            <View style={[styles.roleMiniIcon, { backgroundColor: 'rgba(37, 99, 235, 0.25)' }]}>
              <Ionicons name="briefcase" size={15} color="#60A5FA" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.roleMiniTitle}>Freelancers</Text>
              <Text style={styles.roleMiniDesc}>Find open local gigs, apply, and get paid per milestone.</Text>
            </View>
          </View>

          <View style={[styles.roleMiniBox, { borderColor: 'rgba(245, 158, 11, 0.32)' }]}>
            <View style={[styles.roleMiniIcon, { backgroundColor: 'rgba(245, 158, 11, 0.22)' }]}>
              <Ionicons name="people" size={15} color="#FBBF24" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.roleMiniTitle}>Clients & Businesses</Text>
              <Text style={styles.roleMiniDesc}>Post local jobs, review proposals, and approve work safely.</Text>
            </View>
          </View>
        </View>
      </Animated.View>
    </View>
  );

  const actions = (
    <Animated.View style={[styles.actions, wide && styles.actionsWide, eActions]}>
      {authNotice ? (
        <Pressable onPress={clearAuthNotice} accessibilityRole="alert" style={styles.noticeBox}>
          <Ionicons name="information-circle" size={18} color="#9FB2FF" />
          <Text style={styles.noticeText}>{authNotice}</Text>
          <Ionicons name="close" size={16} color="#9FB2FF" />
        </Pressable>
      ) : null}

      <View style={wide ? styles.ctaRowWide : styles.ctaCol}>
        <Pressable
          onPress={goSignup}
          accessibilityRole="button"
          accessibilityLabel="Get Started"
          style={({ pressed, hovered }: any) => [
            styles.ctaPrimary,
            { backgroundColor: '#2563EB', borderRadius: 14 },
            Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
            hovered && { opacity: 0.94 },
            pressed && { opacity: 0.88, transform: [{ scale: 0.985 }] },
            wide && { flex: 1 },
          ]}
        >
          <Ionicons name="rocket-outline" size={18} color="#FFFFFF" />
          <Text style={styles.ctaPrimaryText}>Get Started</Text>
          <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
        </Pressable>

        <Pressable
          onPress={goLogin}
          accessibilityRole="button"
          accessibilityLabel="Log In"
          style={({ pressed, hovered }: any) => [
            styles.ctaSecondary,
            { borderRadius: 14 },
            Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
            hovered && { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.36)' },
            pressed && { backgroundColor: 'rgba(255,255,255,0.18)' },
            wide && { flex: 1 },
          ]}
        >
          <Ionicons name="log-in-outline" size={18} color="#FFFFFF" />
          <Text style={styles.ctaSecondaryText}>Log In</Text>
        </Pressable>
      </View>

      <View style={styles.trustFooterGrid}>
        {trustFeatures.map((t) => (
          <View key={t.title} style={styles.trustItem}>
            <Ionicons name={t.icon} size={16} color="#34D399" style={{ marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.trustItemTitle}>{t.title}</Text>
              <Text style={styles.trustItemDesc}>{t.desc}</Text>
            </View>
          </View>
        ))}
      </View>
    </Animated.View>
  );

  return (
    <View style={[styles.root, { backgroundColor: '#070B26' }]}>
      {/* Ambient Depth Orbs */}
      <View style={styles.ambientGlowTopRight} pointerEvents="none" />
      <View style={styles.ambientGlowCenterLeft} pointerEvents="none" />
      <View style={styles.ambientGlowBottom} pointerEvents="none" />

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: wide ? 48 : topSpace + 12, paddingBottom: wide ? 48 : bottomSpace + 16 },
          wide && styles.scrollWide,
        ]}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {wide ? (
          <View style={styles.wideGrid}>
            <View style={styles.wideLeft}>
              {copy}
              {actions}
            </View>
            <View style={styles.wideRight}>
              <Showcase wide />
            </View>
          </View>
        ) : (
          <View style={styles.mobileCol}>
            {copy}
            <View style={{ marginVertical: 24 }}>
              <Showcase wide={false} />
            </View>
            {actions}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, position: 'relative', overflow: 'hidden' },
  ambientGlowTopRight: {
    position: 'absolute',
    top: -120,
    right: -100,
    width: 520,
    height: 520,
    borderRadius: 260,
    backgroundColor: 'rgba(37, 99, 235, 0.18)',
    ...(Platform.OS === 'web' ? ({ filter: 'blur(90px)' } as any) : null),
  },
  ambientGlowCenterLeft: {
    position: 'absolute',
    top: '35%',
    left: -150,
    width: 440,
    height: 440,
    borderRadius: 220,
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    ...(Platform.OS === 'web' ? ({ filter: 'blur(80px)' } as any) : null),
  },
  ambientGlowBottom: {
    position: 'absolute',
    bottom: -100,
    right: '25%',
    width: 400,
    height: 400,
    borderRadius: 200,
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    ...(Platform.OS === 'web' ? ({ filter: 'blur(80px)' } as any) : null),
  },
  scroll: { flexGrow: 1, paddingHorizontal: 20, justifyContent: 'center' },
  scrollWide: { paddingHorizontal: 56 },
  mobileCol: { width: '100%', maxWidth: 480, alignSelf: 'center', flexGrow: 1, justifyContent: 'space-between' },
  wideGrid: { flexDirection: 'row', alignItems: 'center', gap: 56, width: '100%', maxWidth: 1120, alignSelf: 'center' },
  wideLeft: { flex: 1.1 },
  wideRight: { flex: 0.9 },
  copyWide: { marginBottom: 8 },

  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 24 },
  logoMark: { width: 46, height: 46, borderRadius: 12 },
  brandTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  brandSubtitle: { color: '#9FB2FF', fontSize: 13, fontWeight: '600' },

  locationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'flex-start',
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 9999,
    backgroundColor: 'rgba(255, 181, 36, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255, 181, 36, 0.32)',
    marginBottom: 16,
  },
  locationPulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#34D399',
  },
  locationBadgeText: { color: '#FCD34D', fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  headline: { color: '#FFFFFF', fontSize: 38, lineHeight: 46, fontWeight: '800', letterSpacing: -1.2 },
  headlineWide: { fontSize: 52, lineHeight: 60, letterSpacing: -1.8 },
  sub: { color: '#CBD5E1', fontSize: 15, lineHeight: 24, fontWeight: '400', marginTop: 14, maxWidth: 480 },

  roleComparisonRow: {
    gap: 12,
    marginTop: 22,
    maxWidth: 480,
  },
  roleMiniBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  roleMiniIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleMiniTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  roleMiniDesc: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 18,
  },

  actions: { marginTop: 24, gap: 14 },
  actionsWide: { marginTop: 28, maxWidth: 480 },
  ctaCol: { gap: 12 },
  ctaRowWide: { flexDirection: 'row', gap: 12 },
  ctaPrimary: {
    minHeight: 54,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.40,
    shadowRadius: 18,
    elevation: 8,
  },
  ctaPrimaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  ctaSecondary: {
    minHeight: 54,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  ctaSecondaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', letterSpacing: -0.1 },

  noticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(159,178,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(159,178,255,0.3)',
  },
  noticeText: { flex: 1, color: '#E3E9FF', fontSize: 13, fontWeight: '500' },

  trustFooterGrid: {
    gap: 12,
    marginTop: 12,
  },
  trustItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  trustItemTitle: {
    color: '#F1F5F9',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  trustItemDesc: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 16,
  },

  // Preview cards styling - Modern Glass Showcase
  previewCard: {
    padding: 18,
    borderWidth: 1,
    borderTopWidth: 3,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.45,
    shadowRadius: 28,
    elevation: 10,
  },
  glassCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.82)',
    borderColor: 'rgba(255, 255, 255, 0.12)',
    ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(16px)' } as any) : null),
  },
  smallCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  categoryTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 9999,
    backgroundColor: 'rgba(59, 130, 246, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.35)',
  },
  categoryTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#93C5FD',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 9999,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#34D399',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#34D399',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: '#F8FAFC',
  },
  cardPrice: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginVertical: 4,
    color: '#38BDF8',
    fontVariant: ['tabular-nums'],
  },
  metaRow: {
    flexDirection: 'row',
    gap: 16,
    flexWrap: 'wrap',
    marginTop: 4,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94A3B8',
  },
  avatarCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontWeight: '700',
    fontSize: 13,
  },
  smallTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
    color: '#F8FAFC',
  },
});
