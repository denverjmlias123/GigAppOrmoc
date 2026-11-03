import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAppTheme, useResponsiveLayout } from '../../theme';
import { reviewsService } from '../../../services/reviews';
import { applicationsService } from '../../../services/applications';
import { useAuth } from '../../../hooks/useAuth';
import { Button } from '../../../components/ui/Button';
import { Card, AlertBox, PageHeaderBox } from '../../../components/ui/Card';
import { TextInput } from '../../../components/ui/TextInput';
import { Avatar } from '../../../components/ui/Avatar';
import { showToast } from '../../../components/ui/Toast';
import { mapSqlErrorToFriendlyMessage, strings } from '../../../constants/strings';

export default function SubmitReviewScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { user } = useAuth();
  const { isWide, insets } = useResponsiveLayout();
  const { id, targetName, targetRole } = useLocalSearchParams<{
    id: string;
    targetName: string;
    targetRole: string;
  }>();

  const [rating, setRating] = useState<number>(5);
  const [comment, setComment] = useState('');
  const [ineligibleReason, setIneligibleReason] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = React.useRef(false);

  useEffect(() => {
    if (!id) return;
    let active = true;
    Promise.all([
      applicationsService.getAgreementDetail(id),
      reviewsService.getAgreementReviews(id),
    ])
      .then(([agr, existingReviews]) => {
        if (!active) return;
        if (!agr) {
          setIneligibleReason('Agreement not found.');
          return;
        }
        if (agr.status !== 'completed') {
          setIneligibleReason('Reviews can only be submitted after the contract has been completed.');
          return;
        }
        if (user && existingReviews.some((r) => r.reviewer_id === user.id)) {
          setIneligibleReason('You have already submitted your review for this agreement.');
          return;
        }
        if (agr.updated_at) {
          const completedAtDate = new Date(agr.updated_at);
          const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
          if (Date.now() - completedAtDate.getTime() > fourteenDaysMs) {
            setIneligibleReason('The 14-day review window for this agreement has expired.');
            return;
          }
        }
      })
      .catch(() => {
        // non-blocking fallback
      });

    return () => {
      active = false;
    };
  }, [id, user]);

  const safeNavigateBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else if (id) {
      router.replace({ pathname: '/agreements/[id]', params: { id } });
    } else {
      router.replace('/(tabs)/activity');
    }
  };

  const navigateAfterSuccess = () => {
    if (id) {
      router.replace({ pathname: '/agreements/[id]', params: { id } });
    } else {
      router.replace('/(tabs)/activity');
    }
  };

  const handleSubmit = async () => {
    if (!id || inFlightRef.current || submitting || submitted || ineligibleReason) return;
    if (comment.trim().length < 10) {
      setError('Please write at least 10 characters of honest feedback about your working experience.');
      showToast('Please write at least 10 characters of honest feedback.', 'error');
      return;
    }

    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await reviewsService.submitReview({
        agreementId: id,
        rating,
        comment: comment.trim(),
      });
      setSubmitted(true);
      showToast(strings.toasts.reviewPosted);
      navigateAfterSuccess();
    } catch (err: any) {
      const friendlyMsg = mapSqlErrorToFriendlyMessage(err, 'Failed to submit review.');
      setError(friendlyMsg);
      showToast(friendlyMsg, 'error');
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <PageHeaderBox
        title="Leave a Review"
        subtitle={`Share your experience working with ${targetName || 'Participant'}`}
        onBack={safeNavigateBack}
        maxWidth={680}
      />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: !isWide ? Math.max(insets.bottom + 80, 96) : Math.max(insets.bottom + 32, 40) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.centeredBlock, { gap: 16 }]}>
          {/* Reviewee Header */}
          <Card tone="raised" padding="md" style={styles.cardGap}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar name={targetName || 'Participant'} size={44} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: theme.colors.muted }]}>Reviewing</Text>
                <Text style={[styles.title, { color: theme.colors.text }]}>
                  {targetName || 'Participant'}
                </Text>
                <Text style={[styles.subLabel, { color: theme.colors.muted }]}>
                  Role: {targetRole || 'Partner'}
                </Text>
              </View>
            </View>
          </Card>

          {/* Notice */}
          {ineligibleReason ? (
            <AlertBox
              tone="warning"
              title="Review Unavailable"
              message={ineligibleReason}
            />
          ) : (
            <AlertBox
              tone="success"
              title="Honest & Immutable Feedback"
              message="Reviews can only be submitted once per agreement and cannot be edited after publication. Reviews must be submitted within 14 days of project completion."
            />
          )}

          {error && <AlertBox tone="danger" message={error} />}

          {/* Star Rating Selector */}
          <Card tone="raised" padding="md" style={styles.cardGap}>
            <Text style={[styles.label, { color: theme.colors.text }]}>Rating *</Text>
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity
                  key={star}
                  onPress={() => !ineligibleReason && setRating(star)}
                  style={styles.starTouch}
                  activeOpacity={0.7}
                  disabled={Boolean(ineligibleReason)}
                >
                  <Text
                    style={[
                      styles.starIcon,
                      {
                        color:
                          star <= rating ? theme.colors.warning : theme.colors.borderStrong,
                      },
                    ]}
                  >
                    ★
                  </Text>
                </TouchableOpacity>
              ))}
              <Text style={[styles.ratingCountText, { color: theme.colors.text }]}>
                {rating} of 5 Stars
              </Text>
            </View>
          </Card>

          {/* Review Comment */}
          <Card tone="raised" padding="md" style={styles.cardGap}>
            <TextInput
              label="Feedback Comment *"
              placeholder="Share details of your experience: communication, quality of work, punctuality, and professionalism..."
              multiline
              numberOfLines={5}
              value={comment}
              onChangeText={setComment}
              maxLength={1000}
              helperText={`${comment.length}/1000 characters (min 10)`}
              containerStyle={{ marginBottom: 0 }}
              editable={!ineligibleReason}
            />
          </Card>

          {/* Submit on Desktop */}
          {isWide && (
            <View style={styles.submitContainer}>
              <Button
                title={submitting ? 'Submitting Review...' : ineligibleReason ? 'Review Unavailable' : 'Publish Review'}
                variant="primary"
                icon="star-outline"
                onPress={handleSubmit}
                disabled={comment.trim().length < 10 || submitting || Boolean(ineligibleReason)}
                loading={submitting}
              />
            </View>
          )}
        </View>
      </ScrollView>

      {/* Sticky Bottom Dock on Mobile */}
      {!isWide && (
        <View
          style={[
            styles.stickyDock,
            {
              backgroundColor: theme.colors.surface,
              borderTopColor: theme.colors.border,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
        >
          <Button
            title={submitting ? 'Submitting Review...' : ineligibleReason ? 'Review Unavailable' : 'Publish Review'}
            variant="primary"
            icon="star-outline"
            onPress={handleSubmit}
            disabled={comment.trim().length < 10 || submitting || Boolean(ineligibleReason)}
            loading={submitting}
            fullWidth
          />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centeredBlock: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
  },
  scrollContent: {
    padding: 16,
  },
  stickyDock: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    width: '100%',
  },
  cardGap: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  subLabel: {
    fontSize: 13,
    textTransform: 'capitalize',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  starsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  starTouch: {
    padding: 6,
  },
  starIcon: {
    fontSize: 34,
  },
  ratingCountText: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 12,
  },
  submitContainer: {
    marginTop: 8,
  },
});
