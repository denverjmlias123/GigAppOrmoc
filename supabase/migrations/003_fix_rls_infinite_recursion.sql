-- ============================================================================
-- Fix RLS Infinite Recursion on platform_admins and cascading policies
-- ============================================================================

-- 1. Helper function that executes with SECURITY DEFINER to avoid RLS loop
CREATE OR REPLACE FUNCTION public.is_platform_admin(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth, extensions
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins WHERE user_id = p_user_id
  );
$$;

-- Grant execute to authenticated and anon
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO anon, authenticated, service_role;

-- 2. Drop and re-create platform_admins select policy (no self-referential subquery)
DROP POLICY IF EXISTS admins_select_policy ON public.platform_admins;
CREATE POLICY admins_select_policy ON public.platform_admins
FOR SELECT USING (
  user_id = auth.uid() OR public.is_platform_admin(auth.uid())
);

-- 3. Drop and re-create profiles select policy
DROP POLICY IF EXISTS profiles_select_policy ON public.profiles;
CREATE POLICY profiles_select_policy ON public.profiles
FOR SELECT USING (
  id = auth.uid() OR public.is_platform_admin(auth.uid())
);

-- 4. Audit events policy
DROP POLICY IF EXISTS audit_events_select_policy ON public.audit_events;
CREATE POLICY audit_events_select_policy ON public.audit_events
FOR SELECT USING (
  public.is_platform_admin(auth.uid())
);

-- 5. Database backups policy
DROP POLICY IF EXISTS backups_select_policy ON public.database_backups;
CREATE POLICY backups_select_policy ON public.database_backups
FOR SELECT USING (
  public.is_platform_admin(auth.uid())
);

-- 6. Gigs select policy
DROP POLICY IF EXISTS gigs_select ON public.gigs;
CREATE POLICY gigs_select ON public.gigs
FOR SELECT USING (
  status = 'open' OR client_id = auth.uid() OR public.is_platform_admin(auth.uid())
);

-- 7. Applications select policy
DROP POLICY IF EXISTS applications_select ON public.applications;
CREATE POLICY applications_select ON public.applications
FOR SELECT USING (
  freelancer_id = auth.uid() OR
  EXISTS (SELECT 1 FROM public.gigs g WHERE g.id = applications.gig_id AND g.client_id = auth.uid()) OR
  public.is_platform_admin(auth.uid())
);

-- 8. Agreements select policy
DROP POLICY IF EXISTS agreements_select ON public.agreements;
CREATE POLICY agreements_select ON public.agreements
FOR SELECT USING (
  client_id = auth.uid() OR freelancer_id = auth.uid() OR
  public.is_platform_admin(auth.uid())
);

-- 9. Milestones select policy
DROP POLICY IF EXISTS milestones_select ON public.milestones;
CREATE POLICY milestones_select ON public.milestones
FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.agreements a WHERE a.id = milestones.agreement_id AND (a.client_id = auth.uid() OR a.freelancer_id = auth.uid())) OR
  public.is_platform_admin(auth.uid())
);

-- 10. External payments select policy
DROP POLICY IF EXISTS payments_select ON public.external_payments;
CREATE POLICY payments_select ON public.external_payments
FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.agreements a WHERE a.id = external_payments.agreement_id AND (a.client_id = auth.uid() OR a.freelancer_id = auth.uid())) OR
  public.is_platform_admin(auth.uid())
);

-- 11. Conversations select policy
DROP POLICY IF EXISTS conversations_select ON public.conversations;
CREATE POLICY conversations_select ON public.conversations
FOR SELECT USING (
  client_id = auth.uid() OR freelancer_id = auth.uid() OR
  public.is_platform_admin(auth.uid())
);

-- 12. Messages select policy
DROP POLICY IF EXISTS messages_select ON public.messages;
CREATE POLICY messages_select ON public.messages
FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = messages.conversation_id AND (c.client_id = auth.uid() OR c.freelancer_id = auth.uid())) OR
  public.is_platform_admin(auth.uid())
);

-- 13. Reports select policy
DROP POLICY IF EXISTS reports_select ON public.reports;
CREATE POLICY reports_select ON public.reports
FOR SELECT USING (
  reporter_id = auth.uid() OR
  public.is_platform_admin(auth.uid())
);
