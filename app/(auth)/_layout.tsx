import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Stack, useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useResponsiveLayout } from '../theme';
import { ScreenBackground } from '../../components/ui/ScreenBackground';

export default function AuthLayout() {
  const { isWide } = useResponsiveLayout();
  const segments = useSegments();
  const segList = segments as string[];
  const currentLeaf = segList[segList.length - 1] || 'welcome';
  const isWelcome = currentLeaf === 'welcome' || (segList.length === 1 && segList[0] === '(auth)');

  if (isWelcome) {
    return (
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          contentStyle: { backgroundColor: 'transparent' },
        }}
      />
    );
  }

  if (isWide) {
    return (
      <View style={styles.splitRoot}>
        {/* Left Brand Showcase Panel for Desktop/Tablet Web */}
        <View style={styles.brandPanel}>
          <View style={styles.brandGlowOrb} pointerEvents="none" />

          <View style={styles.brandTop}>
            <View style={styles.brandLogoRow}>
              <Image source={require('../../assets/logo.png')} style={styles.brandLogo} resizeMode="contain" />
              <Text style={styles.brandTitle}>Gigormoc</Text>
            </View>
            <View style={styles.locationPill}>
              <Ionicons name="location" size={13} color="#FFB524" />
              <Text style={styles.locationText}>Ormoc City · Eastern Visayas</Text>
            </View>
          </View>

          <View style={styles.brandMiddle}>
            <Text style={styles.showcaseHeading}>
              One trusted account for{'\n'}
              <Text style={{ color: '#60A5FA' }}>Freelancing</Text> &{' '}
              <Text style={{ color: '#FBBF24' }}>Hiring</Text>.
            </Text>
            <Text style={styles.showcaseSub}>
              Discover local gigs in Ormoc or hire skilled freelancers with clear milestones, direct payments, and role-specific reputation.
            </Text>

            <View style={styles.roleFeatureCards}>
              <View style={[styles.roleFeatureCard, { borderColor: 'rgba(59, 130, 246, 0.28)' }]}>
                <View style={[styles.roleIconBox, { backgroundColor: 'rgba(37, 99, 235, 0.28)' }]}>
                  <Ionicons name="sparkles" size={18} color="#60A5FA" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.roleFeatureTitle}>Freelancer Mode</Text>
                  <Text style={styles.roleFeatureDesc}>Browse open Ormoc gigs, send proposals, and submit milestone deliverables.</Text>
                </View>
              </View>
              <View style={[styles.roleFeatureCard, { borderColor: 'rgba(245, 158, 11, 0.28)' }]}>
                <View style={[styles.roleIconBox, { backgroundColor: 'rgba(245, 158, 11, 0.24)' }]}>
                  <Ionicons name="briefcase" size={18} color="#FBBF24" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.roleFeatureTitle}>Client Hiring Mode</Text>
                  <Text style={styles.roleFeatureDesc}>Post gigs, compare applicants, define milestones, and record direct payments.</Text>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.brandFooter}>
            <View style={styles.trustItem}>
              <Ionicons name="shield-checkmark" size={15} color="#34D399" />
              <Text style={styles.trustText}>Confirmed local accounts (18+)</Text>
            </View>
            <View style={styles.trustItem}>
              <Ionicons name="layers" size={15} color="#60A5FA" />
              <Text style={styles.trustText}>Milestone-tracked agreements</Text>
            </View>
          </View>
        </View>

        {/* Right Form Panel */}
        <ScreenBackground style={styles.formPanel}>
          <View style={styles.formFrame}>
            <Stack
              screenOptions={{
                headerShown: false,
                animation: 'slide_from_right',
                contentStyle: { backgroundColor: 'transparent' },
              }}
            />
          </View>
        </ScreenBackground>
      </View>
    );
  }

  return (
    <ScreenBackground style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: 'transparent' },
        }}
      />
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  splitRoot: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#070B26',
  },
  brandPanel: {
    width: '44%',
    maxWidth: 460,
    minWidth: 380,
    backgroundColor: '#070B26',
    padding: 40,
    justifyContent: 'space-between',
    overflow: 'hidden',
    position: 'relative',
    borderRightWidth: 1,
    borderRightColor: '#1E293B',
  },
  brandGlowOrb: {
    position: 'absolute',
    top: -80,
    left: -80,
    width: 340,
    height: 340,
    borderRadius: 170,
    backgroundColor: 'rgba(37, 99, 235, 0.16)',
  },
  brandTop: {
    gap: 16,
  },
  brandLogoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  brandLogo: {
    width: 42,
    height: 42,
    borderRadius: 11,
  },
  brandTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  locationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  locationText: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '700',
  },
  brandMiddle: {
    gap: 18,
  },
  showcaseHeading: {
    color: '#FFFFFF',
    fontSize: 34,
    lineHeight: 42,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  showcaseSub: {
    color: '#B8C4E6',
    fontSize: 15,
    lineHeight: 23,
  },
  roleFeatureCards: {
    gap: 12,
    marginTop: 8,
  },
  roleFeatureCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    padding: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  roleIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleFeatureTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  roleFeatureDesc: {
    color: '#B8C4E6',
    fontSize: 13,
    lineHeight: 18,
  },
  brandFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 20,
  },
  trustItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  trustText: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  formPanel: {
    flex: 1,
  },
  formFrame: {
    flex: 1,
  },
});

