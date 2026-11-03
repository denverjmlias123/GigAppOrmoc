-- Migration: 20261011000005_milestones_and_submissions.sql
-- Milestone 5: Milestones and Submissions
-- Strictly adheres to docs/GIGORMOC_SPEC.md sections 5, 8, 9, 10 and AGENTS.md

-- 1. Create milestones table
CREATE TABLE IF NOT EXISTS public.milestones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agreement_id UUID NOT NULL REFERENCES public.agreements(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL CHECK (seq >= 1 AND seq <= 5),
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
    description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
    amount INTEGER NOT NULL CHECK (amount > 0), -- in integer centavos
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'approved', 'revision_requested')),
    revision_count INTEGER NOT NULL DEFAULT 0 CHECK (revision_count >= 0 AND revision_count <= 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (agreement_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_milestones_agreement_id ON public.milestones(agreement_id);

-- 2. Create submissions table
CREATE TABLE IF NOT EXISTS public.submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    milestone_id UUID NOT NULL REFERENCES public.milestones(id) ON DELETE CASCADE,
    freelancer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    submission_number INTEGER NOT NULL CHECK (submission_number >= 1 AND submission_number <= 3),
    message TEXT NOT NULL CHECK (char_length(message) BETWEEN 10 AND 2000),
    file_paths TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_submissions_milestone_id ON public.submissions(milestone_id);

-- 3. Set up submissions private storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'submissions',
    'submissions',
    false,
    26214400, -- 25MB limit
    ARRAY[
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf',
        'application/zip',
        'text/plain',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 26214400,
    allowed_mime_types = ARRAY[
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf',
        'application/zip',
        'text/plain',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];

-- 4. Enable RLS on milestones and submissions
ALTER TABLE public.milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

-- Revoke direct writes from public and authenticated (mutations go through RPC functions)
REVOKE INSERT, UPDATE, DELETE ON public.milestones FROM public, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.submissions FROM public, authenticated;

-- RLS Policies: milestones
DROP POLICY IF EXISTS "Participants read agreement milestones" ON public.milestones;
CREATE POLICY "Participants read agreement milestones"
ON public.milestones FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.agreements a
        WHERE a.id = milestones.agreement_id
        AND (
            a.client_id = auth.uid()
            OR a.freelancer_id = auth.uid()
            OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
        )
    )
);

-- RLS Policies: submissions
DROP POLICY IF EXISTS "Participants read milestone submissions" ON public.submissions;
CREATE POLICY "Participants read milestone submissions"
ON public.submissions FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.milestones m
        JOIN public.agreements a ON a.id = m.agreement_id
        WHERE m.id = submissions.milestone_id
        AND (
            a.client_id = auth.uid()
            OR a.freelancer_id = auth.uid()
            OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
        )
    )
);

-- 5. Storage RLS Policies for submissions bucket
-- Files are organized as: {agreement_id}/{milestone_id}/{filename}
DROP POLICY IF EXISTS "Participants upload submission files" ON storage.objects;
CREATE POLICY "Participants upload submission files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'submissions'
    AND EXISTS (
        SELECT 1 FROM public.agreements a
        WHERE a.id::text = (storage.foldername(name))[1]
        AND a.freelancer_id = auth.uid()
        AND a.status = 'active'
    )
);

DROP POLICY IF EXISTS "Participants read submission files" ON storage.objects;
CREATE POLICY "Participants read submission files"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'submissions'
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

DROP POLICY IF EXISTS "Freelancer delete submission files" ON storage.objects;
CREATE POLICY "Freelancer delete submission files"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'submissions'
    AND EXISTS (
        SELECT 1 FROM public.agreements a
        WHERE a.id::text = (storage.foldername(name))[1]
        AND a.freelancer_id = auth.uid()
        AND a.status = 'active'
    )
);

-- 6. RPC Function: define_milestones
-- Client defines 1 to 5 milestones. Sum of amounts must equal agreed_price exactly.
CREATE OR REPLACE FUNCTION public.define_milestones(
    p_agreement_id UUID,
    p_milestones JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id UUID;
    v_agreement RECORD;
    v_milestone_elem JSONB;
    v_total_amount BIGINT := 0;
    v_count INTEGER;
    v_seq INTEGER := 1;
    v_title TEXT;
    v_desc TEXT;
    v_amount INTEGER;
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

    -- Only client can set up or adjust initial milestones
    IF v_agreement.client_id <> v_caller_id THEN
        RAISE EXCEPTION 'Only the client can define milestones for this agreement.';
    END IF;

    IF v_agreement.status <> 'active' THEN
        RAISE EXCEPTION 'Milestones can only be defined on active agreements.';
    END IF;

    -- Cannot redefine if work has already begun (any milestone is submitted or approved)
    IF EXISTS (
        SELECT 1 FROM public.milestones
        WHERE agreement_id = p_agreement_id
        AND status IN ('submitted', 'approved')
    ) THEN
        RAISE EXCEPTION 'Cannot modify milestones after work has been submitted or approved.';
    END IF;

    v_count := jsonb_array_length(p_milestones);
    IF v_count < 1 OR v_count > 5 THEN
        RAISE EXCEPTION 'Milestone count must be between 1 and 5.';
    END IF;

    -- Validate each milestone and check sum
    FOR v_milestone_elem IN SELECT * FROM jsonb_array_elements(p_milestones)
    LOOP
        v_title := trim(v_milestone_elem->>'title');
        v_desc := coalesce(trim(v_milestone_elem->>'description'), '');
        v_amount := (v_milestone_elem->>'amount')::INTEGER;

        IF v_title IS NULL OR char_length(v_title) < 3 OR char_length(v_title) > 120 THEN
            RAISE EXCEPTION 'Milestone title must be between 3 and 120 characters.';
        END IF;

        IF v_amount IS NULL OR v_amount <= 0 THEN
            RAISE EXCEPTION 'Milestone amount must be greater than 0 centavos.';
        END IF;

        v_total_amount := v_total_amount + v_amount;
    END LOOP;

    -- Exact sum equality check
    IF v_total_amount <> v_agreement.agreed_price THEN
        RAISE EXCEPTION 'Milestone sum (%) does not equal agreed price (%).',
            v_total_amount, v_agreement.agreed_price;
    END IF;

    -- Delete existing pending milestones for this agreement
    DELETE FROM public.milestones WHERE agreement_id = p_agreement_id;

    -- Insert new milestones
    FOR v_milestone_elem IN SELECT * FROM jsonb_array_elements(p_milestones)
    LOOP
        v_title := trim(v_milestone_elem->>'title');
        v_desc := coalesce(trim(v_milestone_elem->>'description'), '');
        v_amount := (v_milestone_elem->>'amount')::INTEGER;

        INSERT INTO public.milestones (
            agreement_id,
            seq,
            title,
            description,
            amount,
            status,
            revision_count
        ) VALUES (
            p_agreement_id,
            v_seq,
            v_title,
            v_desc,
            v_amount,
            'pending',
            0
        );

        v_seq := v_seq + 1;
    END LOOP;

    -- Audit event
    INSERT INTO public.audit_events (
        event_type,
        actor_id,
        target_id,
        target_table,
        metadata
    ) VALUES (
        'milestones_defined',
        v_caller_id,
        p_agreement_id,
        'agreements',
        jsonb_build_object(
            'milestones_count', v_count,
            'total_amount', v_total_amount
        )
    );
END;
$$;

-- 7. RPC Function: submit_milestone
-- Freelancer submits work and file deliverables.
CREATE OR REPLACE FUNCTION public.submit_milestone(
    p_milestone_id UUID,
    p_message TEXT,
    p_file_paths TEXT[] DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id UUID;
    v_milestone RECORD;
    v_agreement RECORD;
    v_sub_num INTEGER;
    v_submission_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    -- Lock milestone row
    SELECT * INTO v_milestone
    FROM public.milestones
    WHERE id = p_milestone_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Milestone not found.';
    END IF;

    -- Check agreement
    SELECT * INTO v_agreement
    FROM public.agreements
    WHERE id = v_milestone.agreement_id;

    IF v_agreement.freelancer_id <> v_caller_id THEN
        RAISE EXCEPTION 'Only the assigned freelancer can submit milestone deliverables.';
    END IF;

    IF v_agreement.status <> 'active' THEN
        RAISE EXCEPTION 'Cannot submit work for an inactive or disputed agreement.';
    END IF;

    -- Milestone status check
    IF v_milestone.status NOT IN ('pending', 'revision_requested') THEN
        RAISE EXCEPTION 'Milestone is currently in % status and cannot receive new submissions.', v_milestone.status;
    END IF;

    IF char_length(trim(p_message)) < 10 OR char_length(trim(p_message)) > 2000 THEN
        RAISE EXCEPTION 'Submission message must be between 10 and 2000 characters.';
    END IF;

    -- Calculate submission number
    v_sub_num := v_milestone.revision_count + 1;
    IF v_sub_num > 3 THEN
        RAISE EXCEPTION 'Maximum submission limit reached for this milestone.';
    END IF;

    -- Insert submission record
    INSERT INTO public.submissions (
        milestone_id,
        freelancer_id,
        submission_number,
        message,
        file_paths
    ) VALUES (
        p_milestone_id,
        v_caller_id,
        v_sub_num,
        trim(p_message),
        coalesce(p_file_paths, '{}')
    )
    RETURNING id INTO v_submission_id;

    -- Update milestone status
    UPDATE public.milestones
    SET status = 'submitted',
        updated_at = now()
    WHERE id = p_milestone_id;

    -- Audit event
    INSERT INTO public.audit_events (
        event_type,
        actor_id,
        target_id,
        target_table,
        metadata
    ) VALUES (
        'milestone_submitted',
        v_caller_id,
        p_milestone_id,
        'milestones',
        jsonb_build_object(
            'agreement_id', v_milestone.agreement_id,
            'submission_id', v_submission_id,
            'submission_number', v_sub_num,
            'file_count', cardinality(p_file_paths)
        )
    );

    RETURN v_submission_id;
END;
$$;

-- 8. RPC Function: review_milestone
-- Client reviews milestone: 'approve' or 'request_revision' (max 2 revisions allowed).
CREATE OR REPLACE FUNCTION public.review_milestone(
    p_milestone_id UUID,
    p_action TEXT,
    p_feedback TEXT DEFAULT ''
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id UUID;
    v_milestone RECORD;
    v_agreement RECORD;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    IF p_action NOT IN ('approve', 'request_revision') THEN
        RAISE EXCEPTION 'Invalid review action. Must be approve or request_revision.';
    END IF;

    -- Lock milestone row
    SELECT * INTO v_milestone
    FROM public.milestones
    WHERE id = p_milestone_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Milestone not found.';
    END IF;

    -- Check agreement
    SELECT * INTO v_agreement
    FROM public.agreements
    WHERE id = v_milestone.agreement_id;

    IF v_agreement.client_id <> v_caller_id THEN
        RAISE EXCEPTION 'Only the client can review milestone submissions.';
    END IF;

    IF v_milestone.status <> 'submitted' THEN
        RAISE EXCEPTION 'Only submitted milestones can be reviewed. Current status is %.', v_milestone.status;
    END IF;

    IF p_action = 'approve' THEN
        UPDATE public.milestones
        SET status = 'approved',
            updated_at = now()
        WHERE id = p_milestone_id;

        -- Audit event
        INSERT INTO public.audit_events (
            event_type,
            actor_id,
            target_id,
            target_table,
            metadata
        ) VALUES (
            'milestone_approved',
            v_caller_id,
            p_milestone_id,
            'milestones',
            jsonb_build_object(
                'agreement_id', v_milestone.agreement_id,
                'feedback', trim(coalesce(p_feedback, ''))
            )
        );

    ELSIF p_action = 'request_revision' THEN
        IF v_milestone.revision_count >= 2 THEN
            RAISE EXCEPTION 'Maximum of 2 revisions already reached for this milestone.';
        END IF;

        IF p_feedback IS NULL OR char_length(trim(p_feedback)) < 5 THEN
            RAISE EXCEPTION 'Please provide clear revision feedback explaining what needs improvement.';
        END IF;

        UPDATE public.milestones
        SET status = 'revision_requested',
            revision_count = revision_count + 1,
            updated_at = now()
        WHERE id = p_milestone_id;

        -- Audit event
        INSERT INTO public.audit_events (
            event_type,
            actor_id,
            target_id,
            target_table,
            metadata
        ) VALUES (
            'milestone_revision_requested',
            v_caller_id,
            p_milestone_id,
            'milestones',
            jsonb_build_object(
                'agreement_id', v_milestone.agreement_id,
                'new_revision_count', v_milestone.revision_count + 1,
                'feedback', trim(p_feedback)
            )
        );
    END IF;
END;
$$;
