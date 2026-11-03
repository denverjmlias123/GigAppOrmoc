import { supabase } from '../lib/supabase';
import { runOnce } from '../lib/singleFlight';

export interface ReviewItem {
  id: string;
  agreement_id: string;
  reviewer_id: string;
  reviewee_id: string;
  role: 'client' | 'freelancer';
  reviewee_role?: 'client' | 'freelancer';
  rating: number;
  comment: string;
  hidden?: boolean;
  created_at: string;
  reviewer?: {
    id: string;
    display_name: string;
    avatar_path: string | null;
  };
}

interface SubmitReviewParams {
  agreementId: string;
  rating: number; // 1 to 5
  comment: string;
  requestId?: string;
}

export const reviewsService = {
  async getUserReviews(userId: string): Promise<ReviewItem[]> {
    const { data, error } = await supabase
      .from('reviews')
      .select(`
        id,
        agreement_id,
        reviewer_id,
        reviewee_id,
        role,
        rating,
        comment,
        created_at,
        reviewer:profiles!reviews_reviewer_id_fkey(
          id,
          display_name,
          avatar_path
        )
      `)
      .eq('reviewee_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []) as any[];
  },

  async getAgreementReviews(agreementId: string): Promise<ReviewItem[]> {
    const { data, error } = await supabase
      .from('reviews')
      .select(`
        id,
        agreement_id,
        reviewer_id,
        reviewee_id,
        role,
        rating,
        comment,
        created_at,
        reviewer:profiles!reviews_reviewer_id_fkey(
          id,
          display_name,
          avatar_path
        )
      `)
      .eq('agreement_id', agreementId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data || []) as any[];
  },

  async submitReview(params: SubmitReviewParams): Promise<string> {
    return runOnce(
      `submit_review:${params.agreementId}`,
      async (reqId) => {
        const baseArgs = {
          p_agreement_id: params.agreementId,
          p_rating: params.rating,
          p_comment: params.comment,
        };
        let { data, error } = await supabase.rpc('submit_review', {
          ...baseArgs,
          p_request_id: reqId,
        });
        if (error && error.code === 'PGRST202') {
          ({ data, error } = await supabase.rpc('submit_review', baseArgs));
        }

        if (error) throw error;
        return data as string;
      },
      { requestId: params.requestId }
    );
  },

  async adminHideReview(reviewId: string, reason: string): Promise<void> {
    return runOnce(`admin_hide_review:${reviewId}`, async () => {
      const { error } = await supabase.rpc('admin_hide_review', {
        p_review_id: reviewId,
        p_reason: reason,
      });

      if (error) throw error;
    });
  },
};
