import { supabase } from '../lib/supabase';
import { runOnce } from '../lib/singleFlight';

export type ReportTargetType = 'profile' | 'gig' | 'agreement' | 'message';
export type ReportReasonCategory =
  | 'spam_scam'
  | 'harassment'
  | 'unresponsive'
  | 'payment_issue'
  | 'work_quality'
  | 'cancellation_request'
  | 'other';

interface ReportItem {
  id: string;
  reporter_id: string;
  target_type: ReportTargetType;
  target_id: string;
  reason_category: ReportReasonCategory;
  details: string;
  evidence_path: string | null;
  status: 'pending' | 'reviewed' | 'dismissed' | 'action_taken';
  resolution_notes: string | null;
  created_at: string;
  resolved_at: string | null;
}

interface SubmitReportParams {
  targetType: ReportTargetType;
  targetId: string;
  reasonCategory: ReportReasonCategory;
  details: string;
  evidencePath?: string;
  requestId?: string;
}

export const reportsService = {
  async submitReport(params: SubmitReportParams): Promise<string> {
    return runOnce(
      `submit_report:${params.targetType}:${params.targetId}`,
      async () => {
        const { data, error } = await supabase.rpc('submit_report', {
          p_target_type: params.targetType,
          p_target_id: params.targetId,
          p_reason_category: params.reasonCategory,
          p_details: params.details,
          p_evidence_path: params.evidencePath || null,
        });

        if (error) throw error;
        return data as string;
      },
      { requestId: params.requestId }
    );
  },

  async getMyReports(): Promise<ReportItem[]> {
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []) as ReportItem[];
  },

  async cancelAgreement(agreementId: string, reason: string, requestId?: string): Promise<string> {
    return runOnce(
      `cancel_agreement:${agreementId}`,
      async (reqId) => {
        const baseArgs = {
          p_agreement_id: agreementId,
          p_reason: reason,
        };
        let { data, error } = await supabase.rpc('cancel_agreement', {
          ...baseArgs,
          p_request_id: reqId,
        });
        if (error && error.code === 'PGRST202') {
          ({ data, error } = await supabase.rpc('cancel_agreement', baseArgs));
        }

        if (error) throw error;
        return data as string; // 'cancelled' or 'disputed'
      },
      { requestId }
    );
  },

  async uploadReportEvidence(
    userId: string,
    fileName: string,
    fileBlob: Blob | ArrayBuffer,
    requestId?: string
  ): Promise<string> {
    const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    return runOnce(
      `upload_report_evidence:${userId}:${safeName}`,
      async (reqId) => {
        const deterministicToken = requestId || reqId || String(Date.now());
        const path = `${userId}/evidence_${deterministicToken}_${safeName}`;

        const { error } = await supabase.storage
          .from('reports')
          .upload(path, fileBlob, { upsert: false });

        if (error) throw error;
        return path;
      },
      { requestId }
    );
  },
};
