-- Migration: 20261011000006_payments.sql
-- Milestone 6: Payments (External Evidence Only)
-- Strictly adheres to docs/GIGORMOC_SPEC.md sections 5, 8, 9, 10 and AGENTS.md

-- 1. Create payments table
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agreement_id UUID NOT NULL REFERENCES public.agreements(id) ON DELETE CASCADE,
    milestone_id UUID REFERENCES public.milestones(id) ON DELETE SET NULL,
    payer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    payee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL CHECK (amount > 0), -- in integer centavos
    payment_method TEXT NOT NULL CHECK (payment_method IN ('gcash', 'maya', 'bank_transfer', 'cash', 'other')),
    reference_number TEXT NOT NULL DEFAULT '' CHECK (char_length(reference_number) <= 100),
    receipt_path TEXT DEFAULT NULL,
    notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1000),
    status TEXT NOT NULL DEFAULT 'reported_sent' CHECK (status IN ('reported_sent', 'confirmed_received', 'disputed')),
    dispute_reason TEXT DEFAULT NULL CHECK (dispute_reason IS NULL OR char_length(dispute_reason) BETWEEN 5 AND 1000),
    reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at TIMESTAMPTZ DEFAULT NULL,
    disputed_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_agreement_id ON public.payments(agreement_id);
CREATE INDEX IF NOT EXISTS idx_payments_payer_id ON public.payments(payer_id);
CREATE INDEX IF NOT EXISTS idx_payments_payee_id ON public.payments(payee_id);

-- 2. Set up receipts private storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'receipts',
    'receipts',
    false,
    10485760, -- 10MB limit
    ARRAY[
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf'
    ]
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY[
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf'
    ];

-- 3. Enable RLS on payments
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Revoke direct writes from public and authenticated (mutations go through RPC functions)
REVOKE INSERT, UPDATE, DELETE ON public.payments FROM public, authenticated;

-- RLS Policies: payments
DROP POLICY IF EXISTS "Participants read agreement payments" ON public.payments;
CREATE POLICY "Participants read agreement payments"
ON public.payments FOR SELECT
TO authenticated
USING (
    payer_id = auth.uid()
    OR payee_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
);

-- 4. Storage RLS Policies for receipts bucket
-- Files are organized as: {agreement_id}/{payment_id}/{filename}
DROP POLICY IF EXISTS "Client upload receipt files" ON storage.objects;
CREATE POLICY "Client upload receipt files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'receipts'
    AND EXISTS (
        SELECT 1 FROM public.agreements a
        WHERE a.id::text = (storage.foldername(name))[1]
        AND a.client_id = auth.uid()
        AND a.status = 'active'
    )
);

DROP POLICY IF EXISTS "Participants read receipt files" ON storage.objects;
CREATE POLICY "Participants read receipt files"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'receipts'
    AND EXISTS (
        SELECT 1 FROM public.agreements a
        WHERE a.id::text = (storage.foldername(name))[1]
        AND (
            a.client_id = auth.uid()
            OR a.freelancer_id = auth.uid()
            OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
        )
    )
);

-- 5. RPC Function: report_payment
-- Client reports an external payment made to freelancer.
CREATE OR REPLACE FUNCTION public.report_payment(
    p_agreement_id UUID,
    p_milestone_id UUID DEFAULT NULL,
    p_amount INTEGER DEFAULT 0,
    p_payment_method TEXT DEFAULT 'gcash',
    p_reference_number TEXT DEFAULT '',
    p_receipt_path TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT ''
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id UUID;
    v_agreement RECORD;
    v_payment_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    -- Lock agreement
    SELECT * INTO v_agreement
    FROM public.agreements
    WHERE id = p_agreement_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agreement not found.';
    END IF;

    IF v_agreement.client_id <> v_caller_id THEN
        RAISE EXCEPTION 'Only the client can report payments for this agreement.';
    END IF;

    IF v_agreement.status <> 'active' THEN
        RAISE EXCEPTION 'Payments can only be reported for active agreements.';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Payment amount must be greater than 0 centavos.';
    END IF;

    IF p_payment_method NOT IN ('gcash', 'maya', 'bank_transfer', 'cash', 'other') THEN
        RAISE EXCEPTION 'Invalid payment method.';
    END IF;

    -- Validate milestone if provided
    IF p_milestone_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.milestones
            WHERE id = p_milestone_id AND agreement_id = p_agreement_id
        ) THEN
            RAISE EXCEPTION 'Milestone does not belong to this agreement.';
        END IF;
    END IF;

    -- Insert payment record
    INSERT INTO public.payments (
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
        reported_at
    ) VALUES (
        p_agreement_id,
        p_milestone_id,
        v_caller_id,
        v_agreement.freelancer_id,
        p_amount,
        p_payment_method,
        coalesce(trim(p_reference_number), ''),
        p_receipt_path,
        coalesce(trim(p_notes), ''),
        'reported_sent',
        now()
    )
    RETURNING id INTO v_payment_id;

    -- Audit event
    INSERT INTO public.audit_events (
        event_type,
        actor_id,
        target_id,
        target_table,
        metadata
    ) VALUES (
        'payment_reported',
        v_caller_id,
        v_payment_id,
        'payments',
        jsonb_build_object(
            'agreement_id', p_agreement_id,
            'amount', p_amount,
            'payment_method', p_payment_method,
            'reference_number', p_reference_number
        )
    );

    RETURN v_payment_id;
END;
$$;

-- 6. RPC Function: confirm_payment
-- Freelancer confirms receiving external payment.
CREATE OR REPLACE FUNCTION public.confirm_payment(
    p_payment_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id UUID;
    v_payment RECORD;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    -- Lock payment row
    SELECT * INTO v_payment
    FROM public.payments
    WHERE id = p_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment record not found.';
    END IF;

    IF v_payment.payee_id <> v_caller_id THEN
        RAISE EXCEPTION 'Only the receiving freelancer can confirm payment receipt.';
    END IF;

    IF v_payment.status = 'confirmed_received' THEN
        RETURN; -- idempotent
    END IF;

    UPDATE public.payments
    SET status = 'confirmed_received',
        confirmed_at = now(),
        disputed_at = NULL,
        dispute_reason = NULL,
        updated_at = now()
    WHERE id = p_payment_id;

    -- Audit event
    INSERT INTO public.audit_events (
        event_type,
        actor_id,
        target_id,
        target_table,
        metadata
    ) VALUES (
        'payment_confirmed',
        v_caller_id,
        p_payment_id,
        'payments',
        jsonb_build_object(
            'agreement_id', v_payment.agreement_id,
            'amount', v_payment.amount
        )
    );
END;
$$;

-- 7. RPC Function: dispute_payment
-- Freelancer disputes a reported payment that was not received or incorrect amount.
CREATE OR REPLACE FUNCTION public.dispute_payment(
    p_payment_id UUID,
    p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id UUID;
    v_payment RECORD;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    IF p_reason IS NULL OR char_length(trim(p_reason)) < 5 THEN
        RAISE EXCEPTION 'Please provide a clear dispute reason explaining why the payment cannot be confirmed.';
    END IF;

    -- Lock payment row
    SELECT * INTO v_payment
    FROM public.payments
    WHERE id = p_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment record not found.';
    END IF;

    IF v_payment.payee_id <> v_caller_id THEN
        RAISE EXCEPTION 'Only the payee freelancer can dispute payment reports.';
    END IF;

    IF v_payment.status = 'confirmed_received' THEN
        RAISE EXCEPTION 'Cannot dispute a payment that was already confirmed.';
    END IF;

    UPDATE public.payments
    SET status = 'disputed',
        dispute_reason = trim(p_reason),
        disputed_at = now(),
        updated_at = now()
    WHERE id = p_payment_id;

    -- Audit event
    INSERT INTO public.audit_events (
        event_type,
        actor_id,
        target_id,
        target_table,
        metadata
    ) VALUES (
        'payment_disputed',
        v_caller_id,
        p_payment_id,
        'payments',
        jsonb_build_object(
            'agreement_id', v_payment.agreement_id,
            'amount', v_payment.amount,
            'reason', trim(p_reason)
        )
    );
END;
$$;

-- 8. RPC Function: complete_agreement
-- Agreement completes when:
-- 1. All milestones on the agreement are 'approved'
-- 2. Total of confirmed payments equals or exceeds agreed_price
-- 3. No unresolved payment disputes exist
CREATE OR REPLACE FUNCTION public.complete_agreement(
    p_agreement_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id UUID;
    v_agreement RECORD;
    v_unapproved_count INTEGER;
    v_total_confirmed BIGINT := 0;
    v_has_disputes BOOLEAN;
    v_has_pending_reports BOOLEAN;
    v_milestone_count INTEGER;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    -- Lock agreement
    SELECT * INTO v_agreement
    FROM public.agreements
    WHERE id = p_agreement_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agreement not found.';
    END IF;

    -- Caller must be participant or admin
    IF v_agreement.client_id <> v_caller_id
       AND v_agreement.freelancer_id <> v_caller_id
       AND NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = v_caller_id)
    THEN
        RAISE EXCEPTION 'Only agreement participants can complete the agreement.';
    END IF;

    IF v_agreement.status = 'completed' THEN
        RETURN; -- idempotent
    END IF;

    IF v_agreement.status <> 'active' THEN
        RAISE EXCEPTION 'Only active agreements can be completed.';
    END IF;

    -- Check milestones: must have at least 1 milestone, and all must be approved
    SELECT count(*), count(*) FILTER (WHERE status <> 'approved')
    INTO v_milestone_count, v_unapproved_count
    FROM public.milestones
    WHERE agreement_id = p_agreement_id;

    IF v_milestone_count = 0 THEN
        RAISE EXCEPTION 'Cannot complete agreement before milestones are defined and approved.';
    END IF;

    IF v_unapproved_count > 0 THEN
        RAISE EXCEPTION 'Cannot complete agreement: % milestone(s) are not yet approved.', v_unapproved_count;
    END IF;

    -- Check payment disputes
    SELECT EXISTS (
        SELECT 1 FROM public.payments
        WHERE agreement_id = p_agreement_id AND status = 'disputed'
    ) INTO v_has_disputes;

    IF v_has_disputes THEN
        RAISE EXCEPTION 'Cannot complete agreement while payment disputes are unresolved.';
    END IF;

    -- Check pending payment reports
    SELECT EXISTS (
        SELECT 1 FROM public.payments
        WHERE agreement_id = p_agreement_id AND status = 'reported_sent'
    ) INTO v_has_pending_reports;

    IF v_has_pending_reports THEN
        RAISE EXCEPTION 'Cannot complete agreement while payment reports are awaiting freelancer confirmation.';
    END IF;

    -- Check total confirmed payments vs agreed price
    SELECT coalesce(sum(amount), 0)
    INTO v_total_confirmed
    FROM public.payments
    WHERE agreement_id = p_agreement_id AND status = 'confirmed_received';

    IF v_total_confirmed < v_agreement.agreed_price THEN
        RAISE EXCEPTION 'Cannot complete agreement: Confirmed payments (%) is less than agreed price (%).',
            v_total_confirmed, v_agreement.agreed_price;
    END IF;

    -- Complete agreement
    UPDATE public.agreements
    SET status = 'completed',
        updated_at = now()
    WHERE id = p_agreement_id;

    -- Update gig status to completed
    UPDATE public.gigs
    SET status = 'completed',
        updated_at = now()
    WHERE id = v_agreement.gig_id;

    -- Increment participant stats
    UPDATE public.profiles
    SET freelancer_completed_gigs = freelancer_completed_gigs + 1,
        updated_at = now()
    WHERE id = v_agreement.freelancer_id;

    UPDATE public.profiles
    SET client_completed_gigs = client_completed_gigs + 1,
        updated_at = now()
    WHERE id = v_agreement.client_id;

    -- Audit event
    INSERT INTO public.audit_events (
        event_type,
        actor_id,
        target_id,
        target_table,
        metadata
    ) VALUES (
        'agreement_completed',
        v_caller_id,
        p_agreement_id,
        'agreements',
        jsonb_build_object(
            'gig_id', v_agreement.gig_id,
            'client_id', v_agreement.client_id,
            'freelancer_id', v_agreement.freelancer_id,
            'total_confirmed_payments', v_total_confirmed
        )
    );
END;
$$;
