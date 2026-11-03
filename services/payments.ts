import { supabase } from '../lib/supabase';
import { runOnce } from '../lib/singleFlight';
import { pickImagesUniversal } from '../utils/imageUpload';

let receiptUploadSeq = 0;

export type PaymentMethod = 'gcash' | 'maya' | 'bank_transfer' | 'cash' | 'other';
type PaymentStatus = 'reported_sent' | 'confirmed_received' | 'disputed';

export interface PaymentItem {
  id: string;
  agreement_id: string;
  milestone_id: string | null;
  payer_id: string;
  payee_id: string;
  amount: number; // in centavos
  payment_method: PaymentMethod;
  reference_number: string;
  receipt_path: string | null;
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

    if (error) throw error;
    return (data || []) as any[];
  },

  async reportPayment(params: ReportPaymentParams): Promise<string> {
    return runOnce(
      `report_payment:${params.agreementId}:${params.milestoneId || 'all'}`,
      async (reqId) => {
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
