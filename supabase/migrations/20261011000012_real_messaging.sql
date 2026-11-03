-- Migration: 20261011000012_real_messaging.sql
-- Milestone 12: Real Messaging with conversation_reads, unread tracking, and new_message notification
-- Strictly adheres to AGENTS.md, docs/GIGORMOC_SPEC.md, and docs/REAL_LOGIC_V5.md section 4

-- 1. Create conversation_reads table to track unread messages per user
CREATE TABLE IF NOT EXISTS public.conversation_reads (
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_reads_user ON public.conversation_reads(user_id);

ALTER TABLE public.conversation_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own conversation reads"
    ON public.conversation_reads
    FOR ALL
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- 2. RPC to mark a conversation read
CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_conv RECORD;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    -- Verify participation
    SELECT * INTO v_conv
    FROM public.conversations
    WHERE id = p_conversation_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Conversation not found.';
    END IF;

    IF v_conv.client_id <> v_caller_id AND v_conv.freelancer_id <> v_caller_id THEN
        RAISE EXCEPTION 'Only participants can mark conversation as read.';
    END IF;

    INSERT INTO public.conversation_reads (conversation_id, user_id, last_read_at)
    VALUES (p_conversation_id, v_caller_id, now())
    ON CONFLICT (conversation_id, user_id)
    DO UPDATE SET last_read_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_conversation_read(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(UUID) TO authenticated;

-- 3. Update send_message RPC to:
--    - Verify participation and suspend check
--    - Prevent messaging oneself
--    - Update updated_at on conversation
--    - Mark conversation read for sender
--    - Emit / update collapsed new_message notification for recipient
CREATE OR REPLACE FUNCTION public.send_message(
    p_conversation_id UUID,
    p_content TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_conv RECORD;
    v_recipient_id UUID;
    v_sender_profile RECORD;
    v_recent_count INTEGER;
    v_msg_id UUID;
    v_preview TEXT;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    -- Load sender profile and verify active status
    SELECT * INTO v_sender_profile
    FROM public.profiles
    WHERE id = v_caller_id;

    IF v_sender_profile.status = 'suspended' THEN
        RAISE EXCEPTION 'Suspended accounts cannot send messages.';
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

    -- Determine recipient
    IF v_conv.client_id = v_caller_id THEN
        v_recipient_id := v_conv.freelancer_id;
    ELSE
        v_recipient_id := v_conv.client_id;
    END IF;

    -- Own-content rule
    IF v_recipient_id = v_caller_id THEN
        RAISE EXCEPTION 'Cannot converse with yourself.';
    END IF;

    -- Rate limit check: max 30 messages per 1 minute
    SELECT count(*) INTO v_recent_count
    FROM public.messages
    WHERE sender_id = v_caller_id
      AND created_at > (now() - interval '1 minute');

    IF v_recent_count >= 30 THEN
        RAISE EXCEPTION 'Message rate limit exceeded (max 30 messages per minute).';
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

    -- Mark conversation read for the sender
    INSERT INTO public.conversation_reads (conversation_id, user_id, last_read_at)
    VALUES (p_conversation_id, v_caller_id, now())
    ON CONFLICT (conversation_id, user_id)
    DO UPDATE SET last_read_at = now();

    -- Notify recipient with collapsed message notification
    v_preview := substring(trim(p_content) from 1 for 100);
    IF char_length(trim(p_content)) > 100 THEN
        v_preview := v_preview || '...';
    END IF;

    PERFORM public.notify(
        v_recipient_id,
        'new_message',
        'New Message from ' || coalesce(v_sender_profile.display_name, 'User'),
        v_preview,
        'conversation',
        p_conversation_id,
        jsonb_build_object('conversation_id', p_conversation_id, 'sender_id', v_caller_id)
    );

    RETURN v_msg_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.send_message(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_message(UUID, TEXT) TO authenticated;

-- 4. Update submit_application to automatically create conversation in the database
CREATE OR REPLACE FUNCTION public.submit_application(
  p_gig_id uuid,
  p_proposed_price integer,
  p_estimated_days integer,
  p_message text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_profile record;
  v_gig record;
  v_has_skill boolean;
  v_email_confirmed boolean;
  v_recent_app_count integer;
  v_app_id uuid;
  v_conv_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF p_proposed_price IS NULL OR p_proposed_price <= 0 THEN
    RAISE EXCEPTION 'Proposed price must be greater than zero.';
  END IF;
  IF p_estimated_days IS NULL OR p_estimated_days <= 0 THEN
    RAISE EXCEPTION 'Estimated days must be greater than zero.';
  END IF;
  IF p_message IS NULL OR trim(p_message) = '' THEN
    RAISE EXCEPTION 'Application message is required.';
  END IF;

  SELECT count(*) INTO v_recent_app_count
  FROM public.rate_limit_events
  WHERE user_id = v_user_id
    AND action = 'submit_application'
    AND created_at > (now() - interval '1 hour');

  IF v_recent_app_count >= 10 THEN
    RAISE EXCEPTION 'Application rate limit reached. Please wait before submitting more applications.';
  END IF;

  SELECT * INTO v_gig
  FROM public.gigs
  WHERE id = p_gig_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gig not found.';
  END IF;

  IF v_gig.client_id = v_user_id THEN
    RAISE EXCEPTION 'You cannot apply to your own gig.';
  END IF;

  IF v_gig.status <> 'open' THEN
    RAISE EXCEPTION 'Gig is not open for applications.';
  END IF;

  IF v_gig.application_deadline <= now() THEN
    RAISE EXCEPTION 'The application deadline for this gig has passed.';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_profile.active_mode <> 'find_work' THEN
    RAISE EXCEPTION 'You must be in Find Work mode to apply for gigs.';
  END IF;

  IF v_profile.status <> 'active' THEN
    RAISE EXCEPTION 'Your account is not active.';
  END IF;

  IF v_profile.avatar_path IS NULL OR trim(v_profile.avatar_path) = '' THEN
    RAISE EXCEPTION 'You must upload a profile photo before applying for gigs.';
  END IF;

  SELECT email_confirmed_at IS NOT NULL INTO v_email_confirmed
  FROM auth.users
  WHERE id = v_user_id;

  IF NOT coalesce(v_email_confirmed, false) THEN
    RAISE EXCEPTION 'You must confirm your email before applying for gigs.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profile_skills WHERE profile_id = v_user_id
  ) INTO v_has_skill;

  IF NOT v_has_skill THEN
    RAISE EXCEPTION 'You must have at least one skill added to your profile before applying.';
  END IF;

  -- Create application row
  INSERT INTO public.applications (
    gig_id,
    freelancer_id,
    proposed_price,
    estimated_days,
    message
  ) VALUES (
    p_gig_id,
    v_user_id,
    p_proposed_price,
    p_estimated_days,
    trim(p_message)
  )
  RETURNING id INTO v_app_id;

  -- Automatically create conversation in the database
  INSERT INTO public.conversations (
    application_id,
    client_id,
    freelancer_id
  ) VALUES (
    v_app_id,
    v_gig.client_id,
    v_user_id
  )
  ON CONFLICT (application_id) DO NOTHING
  RETURNING id INTO v_conv_id;

  -- Insert initial proposal pitch as first message
  IF v_conv_id IS NOT NULL THEN
    INSERT INTO public.messages (
      conversation_id,
      sender_id,
      content
    ) VALUES (
      v_conv_id,
      v_user_id,
      trim(p_message)
    );
  END IF;

  INSERT INTO public.rate_limit_events (user_id, action)
  VALUES (v_user_id, 'submit_application');

  INSERT INTO public.audit_events (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_user_id,
    'submit_application',
    'applications',
    v_app_id,
    jsonb_build_object('gig_id', p_gig_id, 'proposed_price', p_proposed_price)
  );

  -- Real notification to client
  PERFORM public.notify(
    v_gig.client_id,
    'application_received',
    'New Application Received',
    coalesce(v_profile.display_name, 'A freelancer') || ' applied to your gig "' || v_gig.title || '".',
    'application',
    v_app_id,
    jsonb_build_object('gig_id', p_gig_id)
  );

  RETURN v_app_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_application(uuid, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_application(uuid, integer, integer, text) TO authenticated;

-- 5. RPC to fetch user conversations with latest message, unread status, and partner details
CREATE OR REPLACE FUNCTION public.get_user_conversations()
RETURNS TABLE (
    id UUID,
    application_id UUID,
    gig_id UUID,
    gig_title TEXT,
    partner_id UUID,
    partner_name TEXT,
    partner_avatar TEXT,
    last_message_content TEXT,
    last_message_created_at TIMESTAMPTZ,
    last_message_sender_id UUID,
    is_unread BOOLEAN,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated.';
    END IF;

    RETURN QUERY
    SELECT 
        c.id,
        c.application_id,
        g.id AS gig_id,
        g.title AS gig_title,
        CASE WHEN c.client_id = v_caller_id THEN f.id ELSE cl.id END AS partner_id,
        CASE WHEN c.client_id = v_caller_id THEN f.display_name ELSE cl.display_name END AS partner_name,
        CASE WHEN c.client_id = v_caller_id THEN f.avatar_path ELSE cl.avatar_path END AS partner_avatar,
        m.content AS last_message_content,
        m.created_at AS last_message_created_at,
        m.sender_id AS last_message_sender_id,
        CASE 
            WHEN m.id IS NULL THEN false
            WHEN m.sender_id = v_caller_id THEN false
            WHEN cr.last_read_at IS NULL THEN true
            WHEN cr.last_read_at < m.created_at THEN true
            ELSE false
        END AS is_unread,
        c.updated_at
    FROM public.conversations c
    JOIN public.applications a ON a.id = c.application_id
    JOIN public.gigs g ON g.id = a.gig_id
    JOIN public.profiles cl ON cl.id = c.client_id
    JOIN public.profiles f ON f.id = c.freelancer_id
    LEFT JOIN LATERAL (
        SELECT msg.id, msg.content, msg.created_at, msg.sender_id
        FROM public.messages msg
        WHERE msg.conversation_id = c.id
        ORDER BY msg.created_at DESC
        LIMIT 1
    ) m ON true
    LEFT JOIN public.conversation_reads cr 
        ON cr.conversation_id = c.id AND cr.user_id = v_caller_id
    WHERE c.client_id = v_caller_id OR c.freelancer_id = v_caller_id
    ORDER BY coalesce(m.created_at, c.updated_at) DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_user_conversations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_conversations() TO authenticated;
