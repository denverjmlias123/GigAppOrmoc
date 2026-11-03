-- Migration: 20261011000008_reports_and_messages.sql
-- Milestone 8: Reports and Messages
-- Strictly adheres to docs/GIGORMOC_SPEC.md sections 5, 8, 9, 10 and AGENTS.md

-- 1. Create conversations table
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE UNIQUE,
    client_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    freelancer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_client_id ON public.conversations(client_id);
CREATE INDEX IF NOT EXISTS idx_conversations_freelancer_id ON public.conversations(freelancer_id);

-- 2. Create messages table
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    content TEXT NOT NULL CHECK (char_length(trim(content)) BETWEEN 1 AND 2000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON public.messages(created_at);

-- 3. Create reports table
CREATE TABLE IF NOT EXISTS public.reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('profile', 'gig', 'agreement', 'message')),
    target_id UUID NOT NULL,
    reason_category TEXT NOT NULL CHECK (reason_category IN ('spam_scam', 'harassment', 'unresponsive', 'payment_issue', 'work_quality', 'cancellation_request', 'other')),
    details TEXT NOT NULL CHECK (char_length(trim(details)) BETWEEN 10 AND 2000),
    evidence_path TEXT DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'dismissed', 'action_taken')),
    resolution_notes TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_reporter_id ON public.reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON public.reports(status);

-- 4. Enable Supabase Realtime for messages table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
    END IF;
EXCEPTION
    WHEN undefined_object THEN
        NULL; -- publication doesn't exist if realtime is not initialized
END $$;

-- 5. Set up private reports storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'reports',
    'reports',
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

-- 6. Enable RLS on conversations, messages, and reports
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Revoke direct writes from public and authenticated (mutations go through RPC functions)
REVOKE INSERT, UPDATE, DELETE ON public.conversations FROM public, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.messages FROM public, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.reports FROM public, authenticated;

-- RLS: conversations
DROP POLICY IF EXISTS "Participants read conversations" ON public.conversations;
CREATE POLICY "Participants read conversations"
ON public.conversations FOR SELECT
TO authenticated
USING (
    client_id = auth.uid()
    OR freelancer_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
);

-- RLS: messages
DROP POLICY IF EXISTS "Participants read messages" ON public.messages;
CREATE POLICY "Participants read messages"
ON public.messages FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.conversations c
        WHERE c.id = messages.conversation_id
        AND (
            c.client_id = auth.uid()
            OR c.freelancer_id = auth.uid()
            OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
        )
    )
);

-- RLS: reports
DROP POLICY IF EXISTS "Reporter reads own reports" ON public.reports;
CREATE POLICY "Reporter reads own reports"
ON public.reports FOR SELECT
TO authenticated
USING (
    reporter_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
);

-- RLS: reports storage bucket
DROP POLICY IF EXISTS "User upload report evidence" ON storage.objects;
CREATE POLICY "User upload report evidence"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'reports'
    AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Admins and reporter read report evidence" ON storage.objects;
CREATE POLICY "Admins and reporter read report evidence"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'reports'
    AND (
        (storage.foldername(name))[1] = auth.uid()::text
        OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
    )
);

-- 7. RPC Function: get_or_create_conversation
CREATE OR REPLACE FUNCTION public.get_or_create_conversation(
    p_application_id UUID DEFAULT NULL,
    p_agreement_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id UUID;
    v_app RECORD;
    v_conv_id UUID;
    v_target_app_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    v_target_app_id := p_application_id;

    -- If agreement_id is provided, resolve the accepted application
    IF v_target_app_id IS NULL AND p_agreement_id IS NOT NULL THEN
        SELECT a.id INTO v_target_app_id
        FROM public.applications a
        JOIN public.agreements agr ON agr.gig_id = a.gig_id AND agr.freelancer_id = a.freelancer_id
        WHERE agr.id = p_agreement_id
        LIMIT 1;

        -- Fallback if not found: find by gig_id
        IF v_target_app_id IS NULL THEN
            SELECT a.id INTO v_target_app_id
            FROM public.applications a
            JOIN public.agreements agr ON agr.gig_id = a.gig_id
            WHERE agr.id = p_agreement_id
            LIMIT 1;
        END IF;
    END IF;

    IF v_target_app_id IS NULL THEN
        RAISE EXCEPTION 'Could not resolve application for conversation.';
    END IF;

    -- Fetch application and gig client
    SELECT a.*, g.client_id AS gig_client_id
    INTO v_app
    FROM public.applications a
    JOIN public.gigs g ON g.id = a.gig_id
    WHERE a.id = v_target_app_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Application not found.';
    END IF;

    -- Caller must be client or freelancer
    IF v_caller_id <> v_app.freelancer_id AND v_caller_id <> v_app.gig_client_id THEN
        RAISE EXCEPTION 'Only application participants can access this conversation.';
    END IF;

    -- Look up existing conversation
    SELECT id INTO v_conv_id
    FROM public.conversations
    WHERE application_id = v_target_app_id;

    IF v_conv_id IS NOT NULL THEN
        RETURN v_conv_id;
    END IF;

    -- Create new conversation atomically
    INSERT INTO public.conversations (
        application_id,
        client_id,
        freelancer_id
    ) VALUES (
        v_target_app_id,
        v_app.gig_client_id,
        v_app.freelancer_id
    )
    ON CONFLICT (application_id) DO NOTHING
    RETURNING id INTO v_conv_id;

    IF v_conv_id IS NULL THEN
        SELECT id INTO v_conv_id
        FROM public.conversations
        WHERE application_id = v_target_app_id;
    END IF;

    RETURN v_conv_id;
END;
$$;

-- 8. RPC Function: send_message
CREATE OR REPLACE FUNCTION public.send_message(
    p_conversation_id UUID,
    p_content TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id UUID;
    v_conv RECORD;
    v_recent_count INTEGER;
    v_msg_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    IF p_content IS NULL OR char_length(trim(p_content)) < 1 OR char_length(trim(p_content)) > 2000 THEN
        RAISE EXCEPTION 'Message must be between 1 and 2000 characters.';
    END IF;

    -- Verify conversation participation
    SELECT * INTO v_conv
    FROM public.conversations
    WHERE id = p_conversation_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Conversation not found.';
    END IF;

    IF v_conv.client_id <> v_caller_id AND v_conv.freelancer_id <> v_caller_id THEN
        RAISE EXCEPTION 'Only conversation participants can send messages.';
    END IF;

    -- Rate limit check: max 30 messages in 10 minutes
    SELECT count(*) INTO v_recent_count
    FROM public.messages
    WHERE sender_id = v_caller_id
      AND created_at > now() - INTERVAL '10 minutes';

    IF v_recent_count >= 30 THEN
        RAISE EXCEPTION 'Message rate limit exceeded. Please wait a few moments before sending more messages.';
    END IF;

    -- Insert message
    INSERT INTO public.messages (
        conversation_id,
        sender_id,
        content
    ) VALUES (
        p_conversation_id,
        v_caller_id,
        trim(p_content)
    )
    RETURNING id INTO v_msg_id;

    -- Update conversation updated_at
    UPDATE public.conversations
    SET updated_at = now()
    WHERE id = p_conversation_id;

    RETURN v_msg_id;
END;
$$;

-- 9. RPC Function: submit_report
CREATE OR REPLACE FUNCTION public.submit_report(
    p_target_type TEXT,
    p_target_id UUID,
    p_reason_category TEXT,
    p_details TEXT,
    p_evidence_path TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id UUID;
    v_recent_reports_count INTEGER;
    v_report_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    IF p_target_type NOT IN ('profile', 'gig', 'agreement', 'message') THEN
        RAISE EXCEPTION 'Invalid report target type.';
    END IF;

    IF p_reason_category NOT IN ('spam_scam', 'harassment', 'unresponsive', 'payment_issue', 'work_quality', 'cancellation_request', 'other') THEN
        RAISE EXCEPTION 'Invalid reason category.';
    END IF;

    IF p_details IS NULL OR char_length(trim(p_details)) < 10 OR char_length(trim(p_details)) > 2000 THEN
        RAISE EXCEPTION 'Report details must be between 10 and 2000 characters.';
    END IF;

    -- Rate limit check: max 5 reports per hour
    SELECT count(*) INTO v_recent_reports_count
    FROM public.reports
    WHERE reporter_id = v_caller_id
      AND created_at > now() - INTERVAL '1 hour';

    IF v_recent_reports_count >= 5 THEN
        RAISE EXCEPTION 'Report limit reached (maximum 5 reports per hour).';
    END IF;

    INSERT INTO public.reports (
        reporter_id,
        target_type,
        target_id,
        reason_category,
        details,
        evidence_path
    ) VALUES (
        v_caller_id,
        p_target_type,
        p_target_id,
        p_reason_category,
        trim(p_details),
        p_evidence_path
    )
    RETURNING id INTO v_report_id;

    -- Audit event
    INSERT INTO public.audit_events (
        event_type,
        actor_id,
        target_id,
        target_table,
        metadata
    ) VALUES (
        'report_submitted',
        v_caller_id,
        v_report_id,
        'reports',
        jsonb_build_object(
            'target_type', p_target_type,
            'target_id', p_target_id,
            'reason_category', p_reason_category
        )
    );

    RETURN v_report_id;
END;
$$;

-- 10. RPC Function: cancel_agreement
-- Before any milestone is submitted, either party may cancel freely.
-- After work starts, cancelling creates a report for manual review and sets status to 'disputed'.
CREATE OR REPLACE FUNCTION public.cancel_agreement(
    p_agreement_id UUID,
    p_reason TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id UUID;
    v_agreement RECORD;
    v_has_submitted_work BOOLEAN;
    v_result_status TEXT;
    v_report_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    IF p_reason IS NULL OR char_length(trim(p_reason)) < 5 THEN
        RAISE EXCEPTION 'Please provide a reason for cancelling this agreement.';
    END IF;

    -- Lock agreement
    SELECT * INTO v_agreement
    FROM public.agreements
    WHERE id = p_agreement_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agreement not found.';
    END IF;

    IF v_agreement.client_id <> v_caller_id AND v_agreement.freelancer_id <> v_caller_id THEN
        RAISE EXCEPTION 'Only agreement participants can initiate cancellation.';
    END IF;

    IF v_agreement.status <> 'active' THEN
        RAISE EXCEPTION 'Only active agreements can be cancelled or disputed.';
    END IF;

    -- Check if any milestone has been submitted or approved
    SELECT EXISTS (
        SELECT 1 FROM public.milestones
        WHERE agreement_id = p_agreement_id
          AND status IN ('submitted', 'approved', 'revision_requested')
    ) INTO v_has_submitted_work;

    IF NOT v_has_submitted_work THEN
        -- Work has not started yet -> Free cancellation
        UPDATE public.agreements
        SET status = 'cancelled',
            updated_at = now()
        WHERE id = p_agreement_id;

        -- Cancel gig
        UPDATE public.gigs
        SET status = 'cancelled',
            updated_at = now()
        WHERE id = v_agreement.gig_id;

        v_result_status := 'cancelled';

        -- Audit event
        INSERT INTO public.audit_events (
            event_type,
            actor_id,
            target_id,
            target_table,
            metadata
        ) VALUES (
            'agreement_cancelled_freely',
            v_caller_id,
            p_agreement_id,
            'agreements',
            jsonb_build_object('reason', trim(p_reason))
        );
    ELSE
        -- Work already started -> Flag as disputed and log a report for manual review
        UPDATE public.agreements
        SET status = 'disputed',
            updated_at = now()
        WHERE id = p_agreement_id;

        INSERT INTO public.reports (
            reporter_id,
            target_type,
            target_id,
            reason_category,
            details
        ) VALUES (
            v_caller_id,
            'agreement',
            p_agreement_id,
            'cancellation_request',
            'Agreement cancellation requested after deliverables started: ' || trim(p_reason)
        )
        RETURNING id INTO v_report_id;

        v_result_status := 'disputed';

        -- Audit event
        INSERT INTO public.audit_events (
            event_type,
            actor_id,
            target_id,
            target_table,
            metadata
        ) VALUES (
            'agreement_cancelled_disputed',
            v_caller_id,
            p_agreement_id,
            'agreements',
            jsonb_build_object(
                'reason', trim(p_reason),
                'report_id', v_report_id
            )
        );
    END IF;

    RETURN v_result_status;
END;
$$;
