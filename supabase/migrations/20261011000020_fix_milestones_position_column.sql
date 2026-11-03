-- Migration: 20261011000020_fix_milestones_position_column.sql
-- Fixes position vs seq column compatibility in public.milestones and notify overload

ALTER TABLE public.milestones ADD COLUMN IF NOT EXISTS position INTEGER;
UPDATE public.milestones SET position = seq WHERE position IS NULL;

-- Overload for notify with 5 parameters (p_user_id, p_type, p_title, p_body, p_data)
CREATE OR REPLACE FUNCTION public.notify(
    p_user_id UUID,
    p_type TEXT,
    p_title TEXT,
    p_body TEXT,
    p_data JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    RETURN public.notify(p_user_id, p_type, p_title, p_body, NULL, NULL, p_data);
END;
$$;

CREATE OR REPLACE FUNCTION public.define_milestones(
    p_agreement_id UUID,
    p_milestones JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_agreement RECORD;
    v_total_amount INTEGER := 0;
    v_elem JSONB;
    v_pos INTEGER := 1;
    v_count INTEGER;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    SELECT * INTO v_agreement
    FROM public.agreements
    WHERE id = p_agreement_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agreement not found.';
    END IF;

    IF v_agreement.client_id <> v_caller_id THEN
        RAISE EXCEPTION 'Only the client can define milestones.';
    END IF;

    IF v_agreement.status <> 'active' THEN
        RAISE EXCEPTION 'Milestones can only be defined on active agreements.';
    END IF;

    SELECT count(*) INTO v_count
    FROM public.milestones
    WHERE agreement_id = p_agreement_id;

    IF v_count > 0 THEN
        RAISE EXCEPTION 'Milestones have already been defined for this agreement.';
    END IF;

    IF jsonb_array_length(p_milestones) < 1 OR jsonb_array_length(p_milestones) > 5 THEN
        RAISE EXCEPTION 'Agreement must have between 1 and 5 milestones.';
    END IF;

    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_milestones) LOOP
        IF (v_elem->>'title') IS NULL OR char_length(trim(v_elem->>'title')) < 3 THEN
            RAISE EXCEPTION 'Each milestone must have a title of at least 3 characters.';
        END IF;
        IF (v_elem->>'amount') IS NULL OR (v_elem->>'amount')::integer <= 0 THEN
            RAISE EXCEPTION 'Milestone amount must be greater than zero.';
        END IF;
        v_total_amount := v_total_amount + (v_elem->>'amount')::integer;
    END LOOP;

    IF v_total_amount <> v_agreement.agreed_price THEN
        RAISE EXCEPTION 'Sum of milestone amounts (%) must exactly equal agreed price (%).',
            v_total_amount, v_agreement.agreed_price;
    END IF;

    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_milestones) LOOP
        INSERT INTO public.milestones (
            agreement_id,
            seq,
            position,
            title,
            description,
            amount,
            status
        ) VALUES (
            p_agreement_id,
            v_pos,
            v_pos,
            trim(v_elem->>'title'),
            coalesce(trim(v_elem->>'description'), ''),
            (v_elem->>'amount')::integer,
            'pending'
        );
        v_pos := v_pos + 1;
    END LOOP;

    INSERT INTO public.audit_events (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_caller_id,
        'define_milestones',
        'agreements',
        p_agreement_id,
        jsonb_build_object('milestone_count', jsonb_array_length(p_milestones), 'total_amount', v_total_amount)
    );

    PERFORM public.notify(
        v_agreement.freelancer_id,
        'milestones_defined',
        'Milestones Defined',
        'Milestones have been defined for your active agreement.',
        'agreement',
        p_agreement_id
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.define_milestones(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.define_milestones(UUID, JSONB) TO authenticated;
