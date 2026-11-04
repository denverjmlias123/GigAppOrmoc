-- Fix missing columns in profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS headline text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_path text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS about_hiring text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS preferred_contact text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS languages text[] DEFAULT '{}'::text[];
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS work_types text[] DEFAULT '{}'::text[];
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS availability text DEFAULT 'available_now';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS experience_years text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS starting_rate_note text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarding_complete boolean DEFAULT false;

-- Sync avatar_path with avatar_url and onboarding_complete with onboarding_completed
UPDATE public.profiles SET avatar_path = avatar_url WHERE avatar_path IS NULL AND avatar_url IS NOT NULL;
UPDATE public.profiles SET avatar_url = avatar_path WHERE avatar_url IS NULL AND avatar_path IS NOT NULL;
UPDATE public.profiles SET onboarding_complete = onboarding_completed WHERE onboarding_complete IS NOT NULL;

-- Fix missing participant columns in conversations table
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS participant_a uuid REFERENCES public.profiles(id);
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS participant_b uuid REFERENCES public.profiles(id);

UPDATE public.conversations SET participant_a = client_id WHERE participant_a IS NULL AND client_id IS NOT NULL;
UPDATE public.conversations SET participant_b = freelancer_id WHERE participant_b IS NULL AND freelancer_id IS NOT NULL;

-- Update get_user_conversations RPC to be fully backward and forward compatible
CREATE OR REPLACE FUNCTION public.get_user_conversations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'application_id', c.application_id,
      'gig_id', c.gig_id,
      'client_id', coalesce(c.client_id, c.participant_a),
      'freelancer_id', coalesce(c.freelancer_id, c.participant_b),
      'partner_id', CASE 
        WHEN coalesce(c.client_id, c.participant_a) = v_uid THEN coalesce(c.freelancer_id, c.participant_b)
        ELSE coalesce(c.client_id, c.participant_a)
      END,
      'partner_name', p.display_name,
      'partner_avatar', coalesce(p.avatar_path, p.avatar_url),
      'last_message_at', c.last_message_at,
      'created_at', c.created_at,
      'updated_at', coalesce(c.last_message_at, c.created_at)
    ) ORDER BY coalesce(c.last_message_at, c.created_at) DESC NULLS LAST
  ), '[]'::jsonb) INTO v_res
  FROM public.conversations c
  LEFT JOIN public.profiles p ON p.id = (
    CASE 
      WHEN coalesce(c.client_id, c.participant_a) = v_uid THEN coalesce(c.freelancer_id, c.participant_b)
      ELSE coalesce(c.client_id, c.participant_a)
    END
  )
  WHERE (coalesce(c.client_id, c.participant_a) = v_uid)
     OR (coalesce(c.freelancer_id, c.participant_b) = v_uid);

  RETURN v_res;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_user_conversations() TO anon, authenticated, service_role;

-- Update get_or_create_conversation RPC
CREATE OR REPLACE FUNCTION public.get_or_create_conversation(p_other_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Not authenticated');
  END IF;

  SELECT id INTO v_id
  FROM public.conversations
  WHERE (coalesce(client_id, participant_a) = v_uid AND coalesce(freelancer_id, participant_b) = p_other_user_id)
     OR (coalesce(client_id, participant_a) = p_other_user_id AND coalesce(freelancer_id, participant_b) = v_uid)
     OR (participant_a = v_uid AND participant_b = p_other_user_id)
     OR (participant_a = p_other_user_id AND participant_b = v_uid)
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.conversations (participant_a, participant_b, client_id, freelancer_id)
    VALUES (v_uid, p_other_user_id, v_uid, p_other_user_id)
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_or_create_conversation(uuid) TO anon, authenticated, service_role;
