import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAppTheme } from '../../app/theme';
import { AgreementItem } from '../../services/applications';
import { ReviewItem } from '../../services/reviews';
import { Button } from '../ui/Button';
import { Avatar } from '../ui/Avatar';
import { Card, AlertBox } from '../ui/Card';

interface AgreementReviewsCardProps {
  agreement: AgreementItem;
  reviews: ReviewItem[];
  currentUserId?: string;
  isClient: boolean;
  isFreelancer: boolean;
  onViewClientProfile: () => void;
  onViewFreelancerProfile: () => void;
  onLeaveReview: () => void;
}

export const AgreementReviewsCard: React.FC<AgreementReviewsCardProps> = ({
  agreement,
  reviews,
  currentUserId,
  isClient,
  isFreelancer,
  onViewClientProfile,
  onViewFreelancerProfile,
  onLeaveReview,
}) => {
  const theme = useAppTheme();

  return (
    <View style={{ gap: 14 }}>
      {/* Counterparty Information */}
      <Card headerTitle="Participants" headerIcon="people-outline">
        {/* Client */}
        <View style={styles.partyRow}>
          <View style={styles.partyIdentity}>
            <Avatar
              name={agreement.client?.display_name || 'Client'}
              uri={(agreement.client as any)?.avatar_url}
              size={40}
            />
            <View>
              <Text style={[styles.partyRole, { color: theme.colors.muted }]}>Client</Text>
              <Text style={[styles.partyName, { color: theme.colors.text }]}>
                {agreement.client?.display_name || 'Client'}
                {isClient ? ' (You)' : ''}
              </Text>
            </View>
          </View>
          <Button
            title="Profile"
            variant="soft"
            size="xs"
            rightIcon="chevron-forward"
            onPress={onViewClientProfile}
          />
        </View>

        <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />

        {/* Freelancer */}
        <View style={styles.partyRow}>
          <View style={styles.partyIdentity}>
            <Avatar
              name={agreement.freelancer?.display_name || 'Freelancer'}
              uri={(agreement.freelancer as any)?.avatar_url}
              size={40}
            />
            <View>
              <Text style={[styles.partyRole, { color: theme.colors.muted }]}>Freelancer</Text>
              <Text style={[styles.partyName, { color: theme.colors.text }]}>
                {agreement.freelancer?.display_name || 'Freelancer'}
                {isFreelancer ? ' (You)' : ''}
              </Text>
            </View>
          </View>
          <Button
            title="Profile"
            variant="soft"
            size="xs"
            rightIcon="chevron-forward"
            onPress={onViewFreelancerProfile}
          />
        </View>
      </Card>

      {/* Reviews Section (Only for completed agreements) */}
      {agreement.status === 'completed' && (
        <Card
          headerTitle="Reviews & Feedback"
          headerSubtitle={
            reviews.length > 0
              ? `${reviews.length} review(s) published`
              : 'No reviews submitted yet'
          }
          headerIcon="star-outline"
          headerRight={
            !reviews.some((r) => r.reviewer_id === currentUserId) ? (
              <Button
                title="Leave Review"
                variant="primary"
                size="sm"
                icon="star-outline"
                onPress={onLeaveReview}
              />
            ) : undefined
          }
        >
          {reviews.length === 0 ? (
            <Card tone="inset" padding="sm" style={{ marginBottom: 0 }}>
              <Text style={[styles.emptyMilestonesText, { color: theme.colors.muted }]}>
                Both parties have 14 days following completion to leave honest, uneditable feedback.
              </Text>
            </Card>
          ) : (
            <View style={styles.milestonesList}>
              {reviews.map((r) => (
                <Card key={r.id} tone="inset" padding="sm" style={styles.reviewItemCard}>
                  <View style={styles.reviewHeader}>
                    <View style={styles.reviewerIdentity}>
                      <Avatar
                        name={r.reviewer?.display_name || 'Participant'}
                        uri={(r.reviewer as any)?.avatar_url}
                        size={30}
                      />
                      <Text style={[styles.reviewerName, { color: theme.colors.text }]}>
                        {r.reviewer?.display_name || 'Participant'} ({r.role})
                      </Text>
                    </View>
                    <Text style={[styles.reviewStars, { color: theme.colors.spark }]}>
                      {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                    </Text>
                  </View>
                  <Text style={[styles.reviewComment, { color: theme.colors.text }]}>
                    {r.comment}
                  </Text>
                  <Text style={[styles.reviewDate, { color: theme.colors.muted }]}>
                    {new Date(r.created_at).toLocaleDateString()}
                  </Text>
                </Card>
              ))}
            </View>
          )}
        </Card>
      )}

      {/* Safety Notice */}
      <AlertBox
        tone="success"
        icon="shield-checkmark-outline"
        title="Direct Payment & Record Integrity"
        message="Payments are made directly outside the platform. Statuses indicate external reports and confirmations between parties."
      />
    </View>
  );
};

const styles = StyleSheet.create({
  partyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  partyIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 8,
  },
  partyRole: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  partyName: {
    fontSize: 15,
    fontWeight: '700',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 6,
  },
  emptyMilestonesText: {
    fontSize: 14,
    lineHeight: 20,
  },
  milestonesList: {
    gap: 10,
  },
  reviewItemCard: {
    marginBottom: 0,
    gap: 6,
  },
  reviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reviewerIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  reviewerName: {
    fontSize: 14,
    fontWeight: '700',
  },
  reviewStars: {
    fontSize: 14,
  },
  reviewComment: {
    fontSize: 14,
    lineHeight: 20,
  },
  reviewDate: {
    fontSize: 12,
  },
});
