-- Migration: Add update_gig RPC function and revoke direct UPDATE on gigs
-- Allows editing gig fields only while status is 'draft' (price/scope frozen after acceptance per spec §5).
-- Follows the idempotency pattern from publish_gig (migration 20261011000022).

-- 1. Create update_gig RPC function
CREATE OR REPLACE FUNCTION public.update_gig(
    p_gig_id UUID,
    p_title TEXT,
    p_description TEXT,
    p_requirements TEXT,
    p_price_min INTEGER,
    p_price_max INTEGER,
    p_work_type TEXT,
    p_area TEXT,
    p_application_deadline TIMESTAMPTZ,
    p_deadline TIMESTAMPTZ,
    p_category_id UUID DEFAULT NULL,
    p_category_name TEXT DEFAULT NULL,
    p_secondary_category_ids UUID[] DEFAULT '{}',
    p_request_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_idem_found BOOLEAN;
    v_idem_result JSONB;
    v_gig RECORD;
    v_profile RECORD;
    v_resolved_category_id UUID;
    v_email_confirmed BOOLEAN;
    v_category_valid BOOLEAN;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    -- Idempotency check
    SELECT p_found, p_result INTO v_idem_found, v_idem_result
    FROM public.get_idempotency_result(v_user_id, p_request_id);
    IF v_idem_found THEN
        RETURN;
    END IF;

    -- Lock gig row
    SELECT * INTO v_gig
    FROM public.gigs
    WHERE id = p_gig_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Gig not found.';
    END IF;

    -- Only the gig owner can edit
    IF v_gig.client_id <> v_user_id THEN
        RAISE EXCEPTION 'Only the gig owner can edit this gig.';
    END IF;

    -- Only drafts can be edited (price/scope frozen after acceptance)
    IF v_gig.status <> 'draft' THEN
        RAISE EXCEPTION 'Only draft gigs can be edited.';
    END IF;

    -- Resolve primary category
    IF p_category_id IS NOT NULL THEN
        SELECT c.id INTO v_resolved_category_id
        FROM public.categories c
        WHERE c.id = p_category_id AND c.is_active = true;

        IF v_resolved_category_id IS NULL THEN
            RAISE EXCEPTION 'Selected category was not found or is inactive.';
        END IF;
    ELSIF p_category_name IS NOT NULL AND trim(p_category_name) <> '' THEN
        v_resolved_category_id := public.get_or_create_category(p_category_name);
    ELSE
        v_resolved_category_id := v_gig.category_id;
    END IF;

    -- Validate input bounds
    IF char_length(trim(COALESCE(p_title, ''))) < 5 OR char_length(trim(COALESCE(p_title, ''))) > 80 THEN
        RAISE EXCEPTION 'Gig title must be between 5 and 80 characters.';
    END IF;

    IF char_length(trim(COALESCE(p_description, ''))) < 30 OR char_length(trim(COALESCE(p_description, ''))) > 2000 THEN
        RAISE EXCEPTION 'Gig description must be between 30 and 2000 characters.';
    END IF;

    IF p_price_min < 10000 THEN
        RAISE EXCEPTION 'Minimum budget must be at least ₱100.00 (10000 centavos).';
    END IF;

    IF p_price_max < p_price_min THEN
        RAISE EXCEPTION 'Maximum budget cannot be less than minimum budget.';
    END IF;

    IF p_work_type NOT IN ('remote', 'face_to_face', 'hybrid') THEN
        RAISE EXCEPTION 'Invalid work type.';
    END IF;

    -- Validate secondary categories (max 2, distinct, not matching primary)
    IF p_secondary_category_ids IS NOT NULL AND array_length(p_secondary_category_ids, 1) > 0 THEN
        IF array_length(p_secondary_category_ids, 1) > 2 THEN
            RAISE EXCEPTION 'You can select up to 2 secondary categories.';
        END IF;
        IF p_secondary_category_ids && ARRAY[v_resolved_category_id] THEN
            RAISE EXCEPTION 'Secondary categories must not include the primary category.';
        END IF;
    END IF;

    -- Update the gig
    UPDATE public.gigs
    SET title = trim(p_title),
        description = trim(p_description),
        requirements = trim(COALESCE(p_requirements, '')),
        category_id = v_resolved_category_id,
        secondary_category_ids = COALESCE(p_secondary_category_ids, '{}'),
        price_min = p_price_min,
        price_max = p_price_max,
        work_type = p_work_type,
        area = trim(COALESCE(p_area, '')),
        application_deadline = p_application_deadline,
        deadline = p_deadline,
        updated_at = now()
    WHERE id = p_gig_id;

    -- Audit event
    INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_user_id, 'update_gig', 'gigs', p_gig_id, jsonb_build_object(
        'title', trim(p_title),
        'category_id', v_resolved_category_id,
        'secondary_category_ids', COALESCE(p_secondary_category_ids, '{}')
    ));

    -- Store idempotency result
    PERFORM public.store_idempotency_result(
        v_user_id,
        p_request_id,
        'update_gig',
        jsonb_build_object('already_done', false, 'status', 'draft')
    );
END;
$$;

-- 2. Revoke direct UPDATE on gigs from client roles (mutations go through RPC functions)
REVOKE UPDATE ON public.gigs FROM PUBLIC, anon, authenticated;

-- 3. Grant execute on update_gig to authenticated users
REVOKE EXECUTE ON FUNCTION public.update_gig(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, UUID[], UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_gig(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, UUID[], UUID) TO authenticated;
