import { supabase } from '../lib/supabase';
import { runOnce } from '../lib/singleFlight';
import { pickImagesUniversal } from '../utils/imageUpload';

let receiptUploadSeq = 0;

export type PaymentMethod = 'gcash' | 'maya' | 'bank_transfer' | 'cash' | 'other';
type PaymentStatus = 'reported_sent' | 'confirmed_received' | 'disputed';

function normalizePaymentMethod(method: string): 'GCash' | 'Maya' | 'PayPal' | 'Cash' {
  const m = (method || '').toLowerCase();
  if (m === 'gcash') return 'GCash';
  if (m === 'maya' || m === 'paymaya') return 'Maya';
  if (m === 'paypal') return 'PayPal';
  return 'Cash';
}

export interface PaymentItem {
  id: string;
  agreement_id: string;
  milestone_id: string | null;
  payer_id: string;
  payee_id: string;
  amount: number; // in centavos
  amount_centavos?: number;
  payment_method: PaymentMethod;
  reference_number: string;
  receipt_path: string | null;
  proof_url?: string | null;
  notes: string;
  status: PaymentStatus;
  dispute_reason: string | null;
  reported_at: string;
  confirmed_at: string | null;
  disputed_at: string | null;
  created_at: string;
  updated_at: string;
  payer?: {
    display_name: string;
    avatar_path: string | null;
  };
  payee?: {
    display_name: string;
    avatar_path: string | null;
  };
}

interface ReportPaymentParams {
  agreementId: string;
  milestoneId?: string;
  amount: number; // in centavos
  paymentMethod: PaymentMethod;
  referenceNumber: string;
  receiptPath?: string;
  notes?: string;
  requestId?: string;
}

export const paymentsService = {
  async getAgreementPayments(agreementId: string): Promise<PaymentItem[]> {
    // 1. Primary: query external_payments
    try {
      const { data, error } = await supabase
        .from('external_payments')
        .select(`
          id,
          agreement_id,
          milestone_id,
          reported_by_client_id,
          amount_centavos,
          payment_method,
          reference_number,
          proof_url,
          status,
          confirmed_at,
          created_at,
          agreement:agreements(
            client_id,
            freelancer_id,
            client:profiles!agreements_client_id_fkey(display_name, avatar_path),
            freelancer:profiles!agreements_freelancer_id_fkey(display_name, avatar_path)
          )
        `)
        .eq('agreement_id', agreementId)
        .order('created_at', { ascending: false });

      if (!error && data) {
        return (data || []).map((row: any) => ({
          id: row.id,
          agreement_id: row.agreement_id,
          milestone_id: row.milestone_id,
          payer_id: row.reported_by_client_id || row.agreement?.client_id || '',
          payee_id: row.agreement?.freelancer_id || '',
          amount: Number(row.amount_centavos || 0),
          amount_centavos: Number(row.amount_centavos || 0),
          payment_method: (row.payment_method || 'gcash').toLowerCase() as PaymentMethod,
          reference_number: row.reference_number || '',
          receipt_path: row.proof_url || null,
          proof_url: row.proof_url || null,
          notes: '',
          status: row.status,
          dispute_reason: null,
          reported_at: row.created_at,
          confirmed_at: row.confirmed_at || null,
          disputed_at: null,
          created_at: row.created_at,
          updated_at: row.created_at,
          payer: row.agreement?.client
            ? {
                display_name: row.agreement.client.display_name,
                avatar_path: row.agreement.client.avatar_path,
              }
            : undefined,
          payee: row.agreement?.freelancer
            ? {
                display_name: row.agreement.freelancer.display_name,
                avatar_path: row.agreement.freelancer.avatar_path,
              }
            : undefined,
        }));
      }
    } catch (epErr) {
      console.warn('Query external_payments error:', epErr);
    }

    // 2. Fallback: query legacy payments table if it exists
    try {
      const { data, error } = await supabase
        .from('payments')
        .select(`
          id,
          agreement_id,
          milestone_id,
          payer_id,
          payee_id,
          amount,
          payment_method,
          reference_number,
          receipt_path,
          notes,
          status,
          dispute_reason,
          reported_at,
          confirmed_at,
          disputed_at,
          created_at,
          updated_at,
          payer:profiles!payments_payer_id_fkey(display_name, avatar_path),
          payee:profiles!payments_payee_id_fkey(display_name, avatar_path)
        `)
        .eq('agreement_id', agreementId)
        .order('created_at', { ascending: false });

      if (!error && data) {
        return (data || []) as any[];
      }
    } catch {}

    return [];
  },

  async reportPayment(params: ReportPaymentParams): Promise<string> {
    return runOnce(
      `report_payment:${params.agreementId}:${params.milestoneId || 'all'}`,
      async (reqId) => {
        const method = normalizePaymentMethod(params.paymentMethod);

        // 1. Try rpc_report_external_payment first
        try {
          const { data, error } = await supabase.rpc('rpc_report_external_payment', {
            p_agreement_id: params.agreementId,
            p_milestone_id: params.milestoneId || null,
            p_payment_method: method,
            p_amount_centavos: params.amount,
            p_reference_number: params.referenceNumber,
            p_proof_url: params.receiptPath || null,
          });

          if (!error) {
            if (data && typeof data === 'object' && (data as any).ok === false) {
              const err: any = new Error((data as any).message || 'Payment reporting rejected.');
              err.code = (data as any).code;
              throw err;
            }
            return String((data as any)?.payment_id || 'reported');
          }
          if (error.code !== 'PGRST202' && !error.message?.includes('not find')) {
            throw error;
          }
        } catch (err: any) {
          if (err?.code && err?.code !== 'PGRST202') throw err;
        }

        // 2. Fallback to report_payment
        const baseArgs = {
          p_agreement_id: params.agreementId,
          p_milestone_id: params.milestoneId || null,
          p_amount: params.amount,
          p_payment_method: params.paymentMethod,
          p_reference_number: params.referenceNumber,
          p_receipt_path: params.receiptPath || null,
          p_notes: params.notes || '',
        };
        let { data, error } = await supabase.rpc('report_payment', {
          ...baseArgs,
          p_request_id: reqId,
        });
        if (error && error.code === 'PGRST202') {
          ({ data, error } = await supabase.rpc('report_payment', baseArgs));
        }

        if (error) throw error;
        return data as string;
      },
      { requestId: params.requestId }
    );
  },

  async confirmPayment(paymentId: string, requestId?: string): Promise<void> {
    return runOnce(
      `confirm_payment:${paymentId}`,
      async (reqId) => {
        // 1. Try rpc_confirm_external_payment first
        try {
          const { data, error } = await supabase.rpc('rpc_confirm_external_payment', {
            p_payment_id: paymentId,
          });
          if (!error) {
            if (data && typeof data === 'object' && (data as any).ok === false) {
              const err: any = new Error((data as any).message || 'Payment confirmation failed.');
              err.code = (data as any).code;
              throw err;
            }
            return;
          }
          if (error.code !== 'PGRST202' && !error.message?.includes('not find')) {
            throw error;
          }
        } catch (err: any) {
          if (err?.code && err?.code !== 'PGRST202') throw err;
        }

        // 2. Fallback to confirm_payment
        const baseArgs = { p_payment_id: paymentId };
        let { error } = await supabase.rpc('confirm_payment', {
          ...baseArgs,
          p_request_id: reqId,
        });
        if (error && error.code === 'PGRST202') {
          ({ error } = await supabase.rpc('confirm_payment', baseArgs));
        }

        if (error) throw error;
      },
      { requestId }
    );
  },

  async disputePayment(paymentId: string, reason: string, requestId?: string): Promise<void> {
    return runOnce(
      `dispute_payment:${paymentId}`,
      async (reqId) => {
        // 1. Try rpc_dispute_external_payment first
        try {
          const { data, error } = await supabase.rpc('rpc_dispute_external_payment', {
            p_payment_id: paymentId,
            p_reason: reason,
          });
          if (!error) {
            if (data && typeof data === 'object' && (data as any).ok === false) {
              const err: any = new Error((data as any).message || 'Payment dispute failed.');
              err.code = (data as any).code;
              throw err;
            }
            return;
          }
          if (error.code !== 'PGRST202' && !error.message?.includes('not find')) {
            throw error;
          }
        } catch (err: any) {
          if (err?.code && err?.code !== 'PGRST202') throw err;
        }

        // 2. Fallback to dispute_payment
        const baseArgs = {
          p_payment_id: paymentId,
          p_reason: reason,
        };
        let { error } = await supabase.rpc('dispute_payment', {
          ...baseArgs,
          p_request_id: reqId,
        });
        if (error && error.code === 'PGRST202') {
          ({ error } = await supabase.rpc('dispute_payment', baseArgs));
        }

        if (error) throw error;
      },
      { requestId }
    );
  },

  async completeAgreement(agreementId: string, requestId?: string): Promise<void> {
    return runOnce(
      `complete_agreement:${agreementId}`,
      async (reqId) => {
        const baseArgs = { p_agreement_id: agreementId };
        let { error } = await supabase.rpc('complete_agreement', {
          ...baseArgs,
          p_request_id: reqId,
        });
        if (error && error.code === 'PGRST202') {
          ({ error } = await supabase.rpc('complete_agreement', baseArgs));
        }

        if (error) throw error;
      },
      { requestId }
    );
  },

  async uploadReceiptFile(
    agreementId: string,
    fileName: string,
    fileBlob: Blob | ArrayBuffer | Uint8Array,
    contentType?: string,
    requestId?: string
  ): Promise<string> {
    const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    return runOnce(
      `upload_receipt:${agreementId}:${safeName}`,
      async (reqId) => {
        receiptUploadSeq += 1;
        const deterministicToken = requestId || reqId || `${Date.now()}_${receiptUploadSeq}`;
        const path = `${agreementId}/receipts/${deterministicToken}_${safeName}`;

        const { error } = await supabase.storage
          .from('receipts')
          .upload(path, fileBlob, {
            upsert: false,
            ...(contentType ? { contentType } : {}),
          });

        if (error) throw error;
        return path;
      },
      { requestId }
    );
  },

  async pickAndUploadReceiptImage(
    agreementId: string,
    source: 'library' | 'camera' = 'library'
  ): Promise<string | null> {
    return runOnce(`pick_upload_receipt:${agreementId}`, async (reqId) => {
      const picked = await pickImagesUniversal({
        source,
        allowsMultipleSelection: false,
        cropSquare: false,
        maxDimension: 1920,
        quality: 0.85,
      });

      if (!picked || picked.length === 0) {
        return null;
      }

      const file = picked[0];
      if (file.bytes.byteLength > 10 * 1024 * 1024) {
        throw new Error('Receipt image is too large. Maximum allowed file size is 10 MB.');
      }

      const fileName = file.fileName || `receipt_${reqId}.${file.ext}`;
      return await paymentsService.uploadReceiptFile(
        agreementId,
        fileName,
        file.bytes,
        file.mimeType,
        reqId
      );
    });
  },

  async createSignedReceiptUrl(filePath: string, expiresInSeconds: number = 3600): Promise<string | null> {
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      return filePath;
    }
    const { data, error } = await supabase.storage
      .from('receipts')
      .createSignedUrl(filePath, expiresInSeconds);

    if (error || !data) return null;
    return data.signedUrl;
  },
};
