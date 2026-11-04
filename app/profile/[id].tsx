import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Platform,
  Modal,
  Share,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme, useResponsiveLayout } from '../theme';
import { useAuth } from '../../hooks/useAuth';
import { Avatar } from '../../components/ui/Avatar';
import { Button, IconButton } from '../../components/ui/Button';
import { Card, StickyFooterBox } from '../../components/ui/Card';
import { ScreenBackground } from '../../components/ui/ScreenBackground';
import { ProfileCompleteBadge } from '../../components/ui/ProfileCompleteness';
import { showToast } from '../../components/ui/Toast';
import { profileService, PublicProfileData } from '../../services/profile';
import { reviewsService, ReviewItem } from '../../services/reviews';
import { chatService, ConversationSummary } from '../../services/chat';
import { strings, mapSqlErrorToFriendlyMessage } from '../../constants/strings';

export default function PublicProfileScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { isDesktop, topPad } = useResponsiveLayout();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();

  const [data, setData] = useState<PublicProfileData | null>(null);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [activePhotoModal, setActivePhotoModal] = useState<string | null>(null);
  const [messagingBusy, setMessagingBusy] = useState(false);

  const isOwner = user?.id === id;

  useEffect(() => {
    let mounted = true;
    const fetchProfile = async () => {
      if (!id) return;
      setLoading(true);
      setError(null);
      try {
        const [res, revList] = await Promise.all([
          profileService.getPublicProfile(id),
          reviewsService.getUserReviews(id),
        ]);
        if (mounted) {
          if (!res) {
            setError('Profile not found.');
          } else {
            setData(res);
            setReviews(revList || []);
          }
        }
      } catch (err: any) {
        if (mounted) setError(mapSqlErrorToFriendlyMessage(err, 'Could not load profile.'));
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchProfile();
    return () => {
      mounted = false;
    };
  }, [id, loadAttempt, user?.id]);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/profile');
    }
  };

  const handleShare = async () => {
    if (!data?.profile) return;
    const shareUrl = typeof window !== 'undefined' ? window.location.href : `https://gigormoc.ph/profile/${id}`;
    const title = `${data.profile.display_name || 'User'} on GigOrmoc`;
    try {
      if (Platform.OS === 'web' && navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
        showToast('Profile link copied to clipboard!', 'info');
      } else {
        await Share.share({
          message: `Check out ${data.profile.display_name}'s profile on GigOrmoc: ${shareUrl}`,
          url: shareUrl,
          title,
        });
      }
    } catch {
      showToast('Could not share profile link.', 'error');
    }
  };

  const handleMessagePress = async () => {
    if (isOwner) {
      router.push('/profile/edit');
      return;
    }
    if (!user) {
      showToast('Please sign in to send a message.', 'info');
      router.push('/(auth)/login');
      return;
    }

    setMessagingBusy(true);
    try {
      let existingConv: ConversationSummary | undefined;
      try {
        const convList = await chatService.getUserConversations();
        existingConv = convList.find((c) => c.partner_id === id);
      } catch {
        // If conversations fail to load, fallback to standard flow
      }

      if (existingConv) {
        router.push({
          pathname: '/chat/[conversationId]',
          params: {
            conversationId: existingConv.id,
            partnerName: data?.profile.display_name || 'User',
          },
        });
      } else {
        // If viewing a client's profile, route to their active gigs to apply/inquire
        if (data?.profile.active_mode === 'hire') {
          showToast('Browse gigs posted by this client to apply and start chatting!', 'info');
          router.push('/(tabs)/gigs');
        } else {
          // If viewing a freelancer's profile, prompt to hire/post gig or invite
          showToast('To message this freelancer, post a gig or accept an application.', 'info');
          router.push('/(tabs)/gigs');
        }
      }
    } catch (err: any) {
      showToast(err?.message || 'Could not open message channel.', 'error');
    } finally {
      setMessagingBusy(false);
    }
  };

  if (loading) {
    return (
      <ScreenBackground>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={[styles.loadingText, { color: theme.colors.muted }]}>Loading profile...</Text>
        </View>
      </ScreenBackground>
    );
  }

  if (error || !data) {
    return (
      <ScreenBackground>
        <View style={styles.centerContainer}>
          <Card tone="raised" padding="lg" style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={48} color={theme.colors.danger} />
            <Text style={[styles.errorTitle, { color: theme.colors.text }]}>Unable to load profile</Text>
            <Text style={[styles.errorDesc, { color: theme.colors.muted }]}>{error || 'Profile not found.'}</Text>
            <View style={styles.errorBtnRow}>
              {error ? (
                <Button
                  title={strings.common.retry}
                  variant="primary"
                  fullWidth={false}
                  onPress={() => setLoadAttempt((attempt) => attempt + 1)}
                />
              ) : null}
              <Button title="← Go back" variant="secondary" fullWidth={false} onPress={handleBack} />
            </View>
          </Card>
        </View>
      </ScreenBackground>
    );
  }

  const { profile, skills, portfolioItems, hiringInterests, gigsPostedCount, completeness } = data;
  const isHire = profile.active_mode === 'hire';

  const availabilityLabel = strings.profile.availabilityOptions.find(
    (o) => o.value === profile.availability
  )?.label;
  const experienceLabel = strings.profile.experienceOptions.find(
    (o) => o.value === profile.experience_years
  )?.label;
  const clientTypeLabel = strings.profile.clientTypeOptions.find(
    (o) => o.value === profile.client_type
  )?.label;

  const roleAccentColor = isHire ? theme.colors.primary : theme.colors.success;
  const roleBadgeText = isHire ? 'Client / Hiring' : 'Freelancer / Talent';
  const roleBadgeIcon = isHire ? 'briefcase' : 'person-circle-outline';

  // Left Identity Column Content (Desktop Sidebar or Mobile Hero)
  const renderIdentityCard = () => (
    <Card tone="raised" padding="lg" style={styles.identityCard}>
      {/* Top Banner / Role Status Header */}
      <View style={styles.identityHeader}>
        <View
          style={[
            styles.roleBadgePill,
            {
              backgroundColor: isHire ? theme.colors.primarySoft : theme.colors.successSoft,
              borderColor: isHire ? theme.colors.primary : theme.colors.success,
            },
          ]}
        >
          <Ionicons name={roleBadgeIcon as any} size={14} color={roleAccentColor} />
          <Text style={[styles.roleBadgeText, { color: roleAccentColor }]}>{roleBadgeText}</Text>
        </View>

        {!isHire && availabilityLabel ? (
          <View style={styles.statusDotRow}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor:
                    profile.availability === 'available_now'
                      ? theme.colors.success
                      : theme.colors.warning,
                },
              ]}
            />
            <Text style={[styles.statusDotText, { color: theme.colors.muted }]}>
              {availabilityLabel}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Avatar & Display Name */}
      <View style={styles.avatarCenteredBlock}>
        <Avatar
          name={profile.display_name || 'User'}
          imageUri={profile.avatar_path}
          size={isDesktop ? 88 : 76}
        />

        <View style={styles.nameBlock}>
          <View style={styles.nameRow}>
            <Text style={[styles.displayName, { color: theme.colors.text }]}>
              {profile.display_name || 'Anonymous User'}
            </Text>
            {completeness?.complete ? <ProfileCompleteBadge /> : null}
          </View>

          {isHire && profile.business_name ? (
            <View style={styles.businessRow}>
              <Ionicons name="business-outline" size={15} color={theme.colors.muted} />
              <Text style={[styles.businessName, { color: theme.colors.primary }]}>
                {profile.business_name}
              </Text>
            </View>
          ) : null}

          {!isHire && profile.headline ? (
            <Text style={[styles.headlineText, { color: theme.colors.muted }]}>
              {profile.headline}
            </Text>
          ) : null}

          <View style={styles.locationRow}>
            <Ionicons name="location-sharp" size={14} color={theme.colors.muted} />
            <Text style={[styles.locationText, { color: theme.colors.muted }]}>
              {profile.area ? `${profile.area}, Ormoc City` : 'Ormoc City, Leyte'}
            </Text>
          </View>
        </View>
      </View>

      {/* Key Stats Grid */}
      <View
        style={[
          styles.statsGrid,
          { borderTopColor: theme.colors.border, borderBottomColor: theme.colors.border },
        ]}
      >
        {isHire ? (
          <>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: theme.colors.text }]}>
                ★ {Number(profile.client_rating_avg || 0).toFixed(1)}
              </Text>
              <Text style={[styles.statLabel, { color: theme.colors.muted }]}>
                {profile.client_rating_count || 0} reviews
              </Text>
            </View>

            <View style={[styles.statBoxDivider, { backgroundColor: theme.colors.border }]} />

            {/* gigs posted */}
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: theme.colors.text }]}>
                {gigsPostedCount || 0}
              </Text>
              <Text style={[styles.statLabel, { color: theme.colors.muted }]}>gigs posted</Text>
            </View>

            <View style={[styles.statBoxDivider, { backgroundColor: theme.colors.border }]} />

            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: theme.colors.text }]}>
                {profile.client_completed_gigs || 0}
              </Text>
              <Text style={[styles.statLabel, { color: theme.colors.muted }]}>Completed</Text>
            </View>
          </>
        ) : (
          <>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: theme.colors.text }]}>
                ★ {Number(profile.freelancer_rating_avg || 0).toFixed(1)}
              </Text>
              <Text style={[styles.statLabel, { color: theme.colors.muted }]}>
                {profile.freelancer_rating_count || 0} reviews
              </Text>
            </View>

            <View style={[styles.statBoxDivider, { backgroundColor: theme.colors.border }]} />

            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: theme.colors.text }]}>
                {profile.freelancer_completed_gigs || 0}
              </Text>
              <Text style={[styles.statLabel, { color: theme.colors.muted }]}>Gigs Done</Text>
            </View>

            <View style={[styles.statBoxDivider, { backgroundColor: theme.colors.border }]} />

            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: theme.colors.text }]}>
                {experienceLabel || '—'}
              </Text>
              <Text style={[styles.statLabel, { color: theme.colors.muted }]}>Experience</Text>
            </View>
          </>
        )}
      </View>

      {/* Action Buttons */}
      <View style={styles.actionButtonGroup}>
        <Button
          title={isOwner ? 'Edit My Profile' : isHire ? 'Browse Client Gigs' : 'Send Message / Hire'}
          variant="primary"
          icon={isOwner ? 'create-outline' : 'chatbubble-ellipses-outline'}
          onPress={handleMessagePress}
          loading={messagingBusy}
        />
        <Button
          title="Share Profile"
          variant="secondary"
          icon="share-social-outline"
          onPress={handleShare}
        />
      </View>

      {/* Quick Details List */}
      <View style={styles.quickDetailsList}>
        <Text style={[styles.quickDetailsHeading, { color: theme.colors.muted }]}>
          Profile Details
        </Text>

        {isHire && clientTypeLabel ? (
          <View style={styles.detailRow}>
            <Ionicons name="briefcase-outline" size={15} color={theme.colors.muted} />
            <Text style={[styles.detailKey, { color: theme.colors.muted }]}>Client type:</Text>
            <Text style={[styles.detailVal, { color: theme.colors.text }]}>{clientTypeLabel}</Text>
          </View>
        ) : null}

        {!isHire && profile.work_types && profile.work_types.length > 0 ? (
          <View style={styles.detailRow}>
            <Ionicons name="laptop-outline" size={15} color={theme.colors.muted} />
            <Text style={[styles.detailKey, { color: theme.colors.muted }]}>Work Mode:</Text>
            <Text style={[styles.detailVal, { color: theme.colors.text }]}>
              {profile.work_types
                .map((wt) => strings.profile.workTypeOptions.find((o) => o.value === wt)?.label || wt)
                .join(', ')}
            </Text>
          </View>
        ) : null}

        {profile.languages && profile.languages.length > 0 ? (
          <View style={styles.detailRow}>
            <Ionicons name="chatbubbles-outline" size={15} color={theme.colors.muted} />
            <Text style={[styles.detailKey, { color: theme.colors.muted }]}>Languages:</Text>
            <Text style={[styles.detailVal, { color: theme.colors.text }]}>
              {profile.languages.join(', ')}
            </Text>
          </View>
        ) : null}

        {profile.preferred_contact ? (
          <View style={styles.detailRow}>
            <Ionicons name="mail-outline" size={15} color={theme.colors.muted} />
            <Text style={[styles.detailKey, { color: theme.colors.muted }]}>Contact:</Text>
            <Text style={[styles.detailVal, { color: theme.colors.text }]}>
              {profile.preferred_contact}
            </Text>
          </View>
        ) : null}

        {!isHire && profile.starting_rate_note ? (
          <View style={styles.detailRow}>
            <Ionicons name="cash-outline" size={15} color={theme.colors.muted} />
            <Text style={[styles.detailKey, { color: theme.colors.muted }]}>Rates:</Text>
            <Text style={[styles.detailVal, { color: theme.colors.text }]}>
              {profile.starting_rate_note}
            </Text>
          </View>
        ) : null}

        {/* Dual Role Badging if user participated in both modes */}
        {isHire && profile.freelancer_completed_gigs ? (
          <View style={[styles.dualRoleNotice, { backgroundColor: theme.colors.surfaceAlt }]}>
            <Text style={[styles.dualRoleText, { color: theme.colors.muted }]}>
              Also freelanced: ★ {Number(profile.freelancer_rating_avg || 0).toFixed(1)} ({profile.freelancer_completed_gigs} gigs)
            </Text>
          </View>
        ) : null}

        {!isHire && profile.client_completed_gigs ? (
          <View style={[styles.dualRoleNotice, { backgroundColor: theme.colors.surfaceAlt }]}>
            <Text style={[styles.dualRoleText, { color: theme.colors.muted }]}>
              Also hired: ★ {Number(profile.client_rating_avg || 0).toFixed(1)} ({profile.client_completed_gigs} gigs)
            </Text>
          </View>
        ) : null}
      </View>
    </Card>
  );

  // Right Column Content (Main Information & Feed)
  const renderMainPanels = () => (
    <View style={styles.mainPanelsContainer}>
      {/* 1. About / Overview Card */}
      <Card tone="raised" padding="lg">
        <View style={styles.cardHeaderRow}>
          <Ionicons
            name={isHire ? 'business-outline' : 'person-outline'}
            size={20}
            color={roleAccentColor}
          />
          <Text style={[styles.cardTitle, { color: theme.colors.text }]}>
            {isHire ? 'About the Client' : 'About Me'}
          </Text>
        </View>

        {profile.bio ? (
          <Text style={[styles.bioText, { color: theme.colors.text }]}>{profile.bio}</Text>
        ) : (
          <Text style={[styles.emptyNote, { color: theme.colors.muted }]}>
            {isHire
              ? 'This client has not added an overview yet.'
              : 'This freelancer has not added a bio yet.'}
          </Text>
        )}

        {/* Highlight Callout for Clients: What We Usually Hire For */}
        {isHire && profile.about_hiring ? (
          <View
            style={[
              styles.hiringCallout,
              { borderColor: theme.colors.primary, backgroundColor: theme.colors.primarySoft },
            ]}
          >
            <View style={styles.calloutHeader}>
              <Ionicons name="sparkles" size={16} color={theme.colors.primary} />
              <Text style={[styles.calloutTitle, { color: theme.colors.primaryDark }]}>
                What We Look For In Freelancers
              </Text>
            </View>
            <Text style={[styles.calloutBody, { color: theme.colors.text }]}>
              {profile.about_hiring}
            </Text>
          </View>
        ) : null}
      </Card>

      {/* 2. Skills or Hiring Interests Card */}
      {isHire ? (
        <Card tone="raised" padding="lg">
          <View style={styles.cardHeaderRow}>
            <Ionicons name="compass-outline" size={20} color={theme.colors.primary} />
            <Text style={[styles.cardTitle, { color: theme.colors.text }]}>
              Hiring Interests ({hiringInterests?.length || 0})
            </Text>
          </View>

          {!hiringInterests || hiringInterests.length === 0 ? (
            <Text style={[styles.emptyNote, { color: theme.colors.muted }]}>
              No specific hiring categories specified yet.
            </Text>
          ) : (
            <View style={styles.chipsWrap}>
              {hiringInterests.map((cat) => (
                <View
                  key={cat.id}
                  style={[
                    styles.interestChip,
                    {
                      borderColor: theme.colors.primary,
                      backgroundColor: theme.colors.primarySoft,
                    },
                  ]}
                >
                  <Ionicons name="checkmark-circle-outline" size={14} color={theme.colors.primary} />
                  <Text style={[styles.interestChipText, { color: theme.colors.primaryDark }]}>
                    {cat.name}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Card>
      ) : (
        <Card tone="raised" padding="lg">
          <View style={styles.cardHeaderRow}>
            <Ionicons name="construct-outline" size={20} color={theme.colors.success} />
            <Text style={[styles.cardTitle, { color: theme.colors.text }]}>
              Skills & Expertise ({skills.length})
            </Text>
          </View>

          {skills.length === 0 ? (
            <Text style={[styles.emptyNote, { color: theme.colors.muted }]}>
              No skills added to this profile yet.
            </Text>
          ) : (
            <View style={styles.chipsWrap}>
              {skills.map((skill) => (
                <View
                  key={skill.id}
                  style={[
                    styles.skillChip,
                    {
                      borderColor: theme.colors.success,
                      backgroundColor: theme.colors.successSoft,
                    },
                  ]}
                >
                  <Ionicons name="star" size={12} color={theme.colors.success} />
                  <Text style={[styles.skillChipText, { color: theme.colors.successText }]}>
                    {skill.name}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Card>
      )}

      {/* 3. Portfolio Showcase (Freelancers) */}
      {!isHire ? (
        <Card tone="raised" padding="lg">
          <View style={styles.cardHeaderRow}>
            <Ionicons name="images-outline" size={20} color={theme.colors.success} />
            <Text style={[styles.cardTitle, { color: theme.colors.text }]}>
              Portfolio Showcase ({portfolioItems.length})
            </Text>
          </View>

          {portfolioItems.length === 0 ? (
            <Text style={[styles.emptyNote, { color: theme.colors.muted }]}>
              No portfolio projects published yet.
            </Text>
          ) : (
            <View style={[styles.portfolioGrid, isDesktop && styles.portfolioGridDesktop]}>
              {portfolioItems.map((item) => (
                <Card
                  key={item.id}
                  tone="outline"
                  padding="none"
                  style={[
                    styles.portfolioItemCard,
                    isDesktop && styles.portfolioItemCardDesktop,
                  ]}
                >
                  {item.file_paths && item.file_paths.length > 0 ? (
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={() => setActivePhotoModal(item.file_paths[0])}
                    >
                      <Image
                        source={{ uri: item.file_paths[0] }}
                        style={styles.portfolioCover}
                        resizeMode="cover"
                      />
                    </TouchableOpacity>
                  ) : (
                    <View
                      style={[
                        styles.portfolioPlaceholder,
                        { backgroundColor: theme.colors.surfaceAlt },
                      ]}
                    >
                      <Ionicons name="document-text-outline" size={32} color={theme.colors.muted} />
                    </View>
                  )}

                  <View style={styles.portfolioItemBody}>
                    <Text style={[styles.portfolioTitle, { color: theme.colors.text }]}>
                      {item.title}
                    </Text>
                    {item.description ? (
                      <Text
                        style={[styles.portfolioDesc, { color: theme.colors.muted }]}
                        numberOfLines={3}
                      >
                        {item.description}
                      </Text>
                    ) : null}

                    {item.file_paths && item.file_paths.length > 1 ? (
                      <View style={styles.portfolioThumbRow}>
                        {item.file_paths.slice(1, 4).map((f, idx) => (
                          <TouchableOpacity
                            key={idx}
                            onPress={() => setActivePhotoModal(f)}
                            style={styles.thumbWrapper}
                          >
                            <Image source={{ uri: f }} style={styles.portfolioSmallThumb} />
                          </TouchableOpacity>
                        ))}
                        {item.file_paths.length > 4 ? (
                          <View
                            style={[
                              styles.moreThumbsChip,
                              { backgroundColor: theme.colors.surfaceAlt },
                            ]}
                          >
                            <Text style={[styles.moreThumbsText, { color: theme.colors.text }]}>
                              +{item.file_paths.length - 4}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                </Card>
              ))}
            </View>
          )}
        </Card>
      ) : null}

      {/* 4. Reviews & Testimonials Card */}
      <Card tone="raised" padding="lg">
        <View style={styles.cardHeaderBetween}>
          <View style={styles.cardHeaderRow}>
            <Ionicons name="star" size={20} color={theme.colors.warning} />
            <Text style={[styles.cardTitle, { color: theme.colors.text }]}>
              Reviews ({reviews.length})
            </Text>
          </View>
          <Text style={[styles.overallScoreText, { color: theme.colors.primary }]}>
            ★ {Number(isHire ? profile.client_rating_avg : profile.freelancer_rating_avg || 0).toFixed(1)}
          </Text>
        </View>

        {reviews.length === 0 ? (
          <Text style={[styles.emptyNote, { color: theme.colors.muted }]}>
            No reviews received yet on completed gigs.
          </Text>
        ) : (
          <View style={styles.reviewsList}>
            {reviews.map((rev) => (
              <Card key={rev.id} tone="muted" padding="md" style={styles.reviewItemCard}>
                <View style={styles.reviewerHeader}>
                  <View style={styles.reviewerIdentity}>
                    <Avatar
                      name={rev.reviewer?.display_name || 'Anonymous User'}
                      imageUri={rev.reviewer?.avatar_path}
                      size={36}
                    />
                    <View>
                      <Text style={[styles.reviewerName, { color: theme.colors.text }]}>
                        {rev.reviewer?.display_name || 'Anonymous User'}
                      </Text>
                      <Text style={[styles.reviewerRoleSubtitle, { color: theme.colors.muted }]}>
                        {rev.created_at
                          ? (() => {
                              const d = new Date(rev.created_at);
                              return isNaN(d.getTime()) ? '' : `${d.toLocaleDateString()} • `;
                            })()
                          : ''}As {rev.role}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.starsPill}>
                    {(() => {
                      const safeStars = Math.max(0, Math.min(5, Math.round(Number(rev.rating) || 0)));
                      return (
                        <>
                          <Text style={[styles.starsGold, { color: theme.colors.warning }]}>
                            {'★'.repeat(safeStars)}
                          </Text>
                          <Text style={[styles.starsEmpty, { color: theme.colors.borderStrong }]}>
                            {'☆'.repeat(5 - safeStars)}
                          </Text>
                        </>
                      );
                    })()}
                  </View>
                </View>

                {rev.comment ? (
                  <Text style={[styles.reviewComment, { color: theme.colors.text }]}>
                    “{rev.comment}”
                  </Text>
                ) : null}
              </Card>
            ))}
          </View>
        )}
      </Card>
    </View>
  );

  return (
    <ScreenBackground>
      <View style={styles.screenWrapper}>
        {/* Web Desktop Header & Breadcrumbs / Mobile Navigation Bar */}
        <View
          style={[
            styles.topNavBar,
            {
              backgroundColor: theme.glass.surface,
              borderBottomColor: theme.colors.border,
              paddingTop: topPad,
            },
          ]}
        >
          <View style={[styles.navInner, isDesktop && styles.navInnerDesktop]}>
            <Button
              title={isDesktop ? 'Back to Directory' : 'Back'}
              icon="arrow-back"
              variant="ghost"
              size="sm"
              fullWidth={false}
              onPress={handleBack}
            />

            {isDesktop ? (
              <View style={styles.desktopBreadcrumbs}>
                <Text style={[styles.breadcrumbMuted, { color: theme.colors.muted }]}>
                  Directory
                </Text>
                <Text style={[styles.breadcrumbDivider, { color: theme.colors.muted }]}>/</Text>
                <Text style={[styles.breadcrumbMuted, { color: theme.colors.muted }]}>
                  {isHire ? 'Clients' : 'Freelancers'}
                </Text>
                <Text style={[styles.breadcrumbDivider, { color: theme.colors.muted }]}>/</Text>
                <Text style={[styles.breadcrumbActive, { color: theme.colors.text }]}>
                  {profile.display_name || 'Profile'}
                </Text>
              </View>
            ) : null}

            <IconButton
              icon="share-outline"
              variant="ghost"
              size="sm"
              onPress={handleShare}
              accessibilityLabel="Share Profile"
            />
          </View>
        </View>

        {/* Responsive Content Area */}
        <ScrollView
          contentContainerStyle={[
            styles.scrollContainer,
            isDesktop ? styles.scrollContainerDesktop : { paddingBottom: 110 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {isDesktop ? (
            /* 2-Column Desktop Web Layout */
            <View style={styles.desktopRowGrid}>
              <View style={styles.desktopLeftColumn}>{renderIdentityCard()}</View>
              <View style={styles.desktopRightColumn}>{renderMainPanels()}</View>
            </View>
          ) : (
            /* 1-Column Mobile App Layout */
            <View style={styles.mobileColStack}>
              {renderIdentityCard()}
              {renderMainPanels()}
            </View>
          )}
        </ScrollView>

        {/* Sticky Mobile Bottom CTA Bar */}
        {!isDesktop ? (
          <StickyFooterBox>
            <Button
              title={
                isOwner
                  ? 'Edit My Profile'
                  : isHire
                  ? 'Browse Client Gigs'
                  : 'Send Message / Hire'
              }
              variant="primary"
              onPress={handleMessagePress}
              loading={messagingBusy}
              style={{ flex: 1 }}
            />
          </StickyFooterBox>
        ) : null}
      </View>

      {/* Portfolio High-Res Image Lightbox Modal */}
      {activePhotoModal ? (
        <Modal
          visible={Boolean(activePhotoModal)}
          transparent
          animationType="fade"
          onRequestClose={() => setActivePhotoModal(null)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCloseBtn}>
              <IconButton
                icon="close"
                variant="secondary"
                size="md"
                onPress={() => setActivePhotoModal(null)}
                accessibilityLabel="Close"
              />
            </View>
            <Image
              source={{ uri: activePhotoModal }}
              style={styles.modalFullImage}
              resizeMode="contain"
            />
          </View>
        </Modal>
      ) : null}
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  screenWrapper: {
    flex: 1,
  },
  topNavBar: {
    paddingBottom: 12,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  navInnerDesktop: {
    maxWidth: 1120,
    alignSelf: 'center',
  },
  desktopBreadcrumbs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  breadcrumbMuted: {
    fontSize: 14,
  },
  breadcrumbDivider: {
    fontSize: 14,
  },
  breadcrumbActive: {
    fontSize: 14,
    fontWeight: '700',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
  },
  errorCard: {
    alignItems: 'center',
    maxWidth: 460,
    width: '100%',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 6,
  },
  errorDesc: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
  errorBtnRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    justifyContent: 'center',
  },
  scrollContainer: {
    padding: 16,
    paddingBottom: 48,
  },
  scrollContainerDesktop: {
    paddingHorizontal: 24,
    paddingVertical: 28,
    maxWidth: 1120,
    width: '100%',
    alignSelf: 'center',
  },
  desktopRowGrid: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 24,
    width: '100%',
  },
  desktopLeftColumn: {
    width: 340,
  },
  desktopRightColumn: {
    flex: 1,
    minWidth: 0,
  },
  mobileColStack: {
    gap: 16,
  },
  mainPanelsContainer: {
    gap: 16,
  },
  identityCard: {
    gap: 16,
  },
  identityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  roleBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  roleBadgeText: {
    fontSize: 13, lineHeight: 18,
    fontWeight: '700',
  },
  statusDotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusDotText: {
    fontSize: 12,
    fontWeight: '600',
  },
  avatarCenteredBlock: {
    alignItems: 'center',
    paddingVertical: 4,
    gap: 12,
  },
  nameBlock: {
    alignItems: 'center',
    gap: 4,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  displayName: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  businessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  businessName: {
    fontSize: 14, lineHeight: 20,
    fontWeight: '700',
  },
  headlineText: {
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  locationText: {
    fontSize: 13,
    fontWeight: '500',
  },
  statsGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 14,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  statBox: {
    alignItems: 'center',
    flex: 1,
  },
  statBoxDivider: {
    width: 1,
    height: 28,
  },
  statValue: {
    fontSize: 17, lineHeight: 24,
    fontWeight: '800',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontSize: 12, lineHeight: 16,
    fontWeight: '500',
    marginTop: 2,
  },
  actionButtonGroup: {
    gap: 10,
    width: '100%',
  },
  quickDetailsList: {
    paddingTop: 8,
    gap: 10,
  },
  quickDetailsHeading: {
    fontSize: 12, lineHeight: 16,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailKey: {
    fontSize: 13,
    fontWeight: '500',
  },
  detailVal: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  dualRoleNotice: {
    marginTop: 4,
    padding: 8,
    borderRadius: 8,
  },
  dualRoleText: {
    fontSize: 12,
    fontWeight: '500',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  cardHeaderBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  overallScoreText: {
    fontSize: 16,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  bioText: {
    fontSize: 14,
    lineHeight: 22,
  },
  emptyNote: {
    fontSize: 14,
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  hiringCallout: {
    marginTop: 16,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
  },
  calloutHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  calloutTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  calloutBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  skillChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  skillChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  interestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  interestChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  portfolioGrid: {
    gap: 16,
  },
  portfolioGridDesktop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  portfolioItemCard: {
    overflow: 'hidden',
  },
  portfolioItemCardDesktop: {
    width: '48.2%',
  },
  portfolioCover: {
    width: '100%',
    height: 190,
  },
  portfolioPlaceholder: {
    width: '100%',
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  portfolioItemBody: {
    padding: 16,
    gap: 6,
  },
  portfolioTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  portfolioDesc: {
    fontSize: 14,
    lineHeight: 20,
  },
  portfolioThumbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  thumbWrapper: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  portfolioSmallThumb: {
    width: 52,
    height: 52,
    borderRadius: 8,
  },
  moreThumbsChip: {
    width: 52,
    height: 52,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreThumbsText: {
    fontSize: 13,
    fontWeight: '700',
  },
  reviewsList: {
    gap: 12,
  },
  reviewItemCard: {
    gap: 10,
  },
  reviewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reviewerIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  reviewerName: {
    fontSize: 14,
    fontWeight: '700',
  },
  reviewerRoleSubtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  starsPill: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  starsGold: {
    fontSize: 14,
  },
  starsEmpty: {
    fontSize: 14,
  },
  reviewComment: {
    fontSize: 14,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.90)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCloseBtn: {
    position: 'absolute',
    top: 40,
    right: 24,
    zIndex: 10,
  },
  modalFullImage: {
    width: '100%',
    height: '80%',
  },
});
