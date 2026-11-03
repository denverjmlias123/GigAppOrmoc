import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function validEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null;
}

function validTemporaryPassword(password: unknown, email: string, displayName: string): password is string {
  if (typeof password !== 'string' || password.length < 8 || password.length > 72 || /\s/.test(password)) return false;
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) return false;
  const folded = password.toLowerCase();
  return !folded.includes(email.toLowerCase()) && (!displayName || !folded.includes(displayName.toLowerCase()));
}

function isAdult(dob: unknown): dob is string {
  if (typeof dob !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return false;
  const date = new Date(`${dob}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dob) return false;
  const today = new Date();
  const minimum = new Date(Date.UTC(today.getUTCFullYear() - 18, today.getUTCMonth(), today.getUTCDate()));
  return date <= minimum;
}

async function clearPublicProfileFiles(service: ReturnType<typeof createClient>, userId: string) {
  const outcomes: Array<{ bucket: string; removed: number; failed: boolean }> = [];
  for (const bucket of ['avatars', 'portfolio']) {
    let removed = 0;
    let failed = false;
    for (;;) {
      const { data, error } = await service.storage.from(bucket).list(userId, { limit: 500 });
      if (error) { failed = true; break; }
      const paths = (data || []).filter((file) => file.id).map((file) => `${userId}/${file.name}`);
      if (paths.length) {
        const { error: removeError } = await service.storage.from(bucket).remove(paths);
        if (removeError) { failed = true; break; }
        removed += paths.length;
      }
      if (!data || data.length < 500) break;
      if (!paths.length) break;
    }
    outcomes.push({ bucket, removed, failed });
  }
  return outcomes;
}

serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);
  const jwt = authHeader.slice('Bearer '.length);
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceRoleKey) return json({ error: 'server_unavailable' }, 503);

  const service = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const caller = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  try {
    const { data: { user }, error: authError } = await service.auth.getUser(jwt);
    if (authError || !user?.id) return json({ error: 'unauthorized' }, 401);
    const { data: allowed, error: guardError } = await caller.rpc('is_admin');
    if (guardError || allowed !== true) return json({ error: 'admin_required' }, 403);

    const body = await request.json();
    const action = body?.action;
    if (action === 'create_user') {
      const email = validEmail(body?.email);
      const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';
      const dob = body?.dob;
      const password = body?.temporaryPassword;
      const requestedRole = body?.role;
      if (!email || displayName.length < 1 || displayName.length > 60 || !isAdult(dob) || !validTemporaryPassword(password, email, displayName)) {
        return json({ error: 'invalid_create_user_input' }, 400);
      }
      if (!['user', 'admin', 'super_admin'].includes(requestedRole)) return json({ error: 'invalid_admin_role' }, 400);
      if (requestedRole !== 'user') {
        const { data: isSuperAdmin, error: tierError } = await caller.rpc('is_super_admin');
        if (tierError || isSuperAdmin !== true) return json({ error: 'super_admin_required' }, 403);
      }
      const { data, error } = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName, dob, terms_version: 'v1.0' },
      });
      if (error || !data.user) {
        const duplicate = error?.code === 'email_exists' || error?.code === 'user_already_exists';
        return json({ error: duplicate ? 'email_already_registered' : 'create_failed' }, duplicate ? 409 : 400);
      }
      const { error: finalizeError } = await caller.rpc('admin_finalize_created_user', { p_user_id: data.user.id });
      if (finalizeError) {
        // Preserve the account and its log trail, but soft-delete it if finalization failed.
        await caller.rpc('admin_soft_delete_user', { p_user_id: data.user.id, p_confirm_email: email }).catch(() => undefined);
        return json({ error: 'create_finalize_failed' }, 503);
      }
      if (requestedRole !== 'user') {
        const { error: roleError } = await caller.rpc('admin_set_admin_role', { p_user_id: data.user.id, p_role: requestedRole });
        if (roleError) return json({ error: 'create_role_assignment_failed', user_id: data.user.id }, 503);
      }
      return json({ user_id: data.user.id, must_change_password: true });
    }

    if (action === 'send_password_reset') {
      const userId = typeof body?.userId === 'string' ? body.userId : '';
      if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: 'invalid_user_id' }, 400);
      const { data: userResult, error: detailError } = await caller.rpc('admin_get_user_detail', { p_user_id: userId });
      if (detailError || !userResult?.email) return json({ error: 'user_not_found' }, 404);
      const { error: resetError } = await service.auth.resetPasswordForEmail(userResult.email);
      if (resetError) return json({ error: 'reset_email_failed' }, 502);
      const { error: flagError } = await caller.rpc('admin_force_password_change', { p_user_id: userId });
      if (flagError) return json({ error: 'password_reset_flag_failed' }, 400);
      return json({ sent: true });
    }

    if (action === 'soft_delete_user') {
      const userId = typeof body?.userId === 'string' ? body.userId : '';
      const confirmEmail = validEmail(body?.confirmEmail);
      if (!/^[0-9a-f-]{36}$/i.test(userId) || !confirmEmail) return json({ error: 'invalid_delete_input' }, 400);
      const { data, error } = await caller.rpc('admin_soft_delete_user', { p_user_id: userId, p_confirm_email: confirmEmail });
      if (error) {
        const message = String(error.message || '');
        const known = ['admin_required', 'super_admin_required', 'cannot_delete_self', 'last_super_admin',
          'active_agreements_block_delete', 'pending_payments_block_delete', 'confirmation_email_mismatch', 'user_not_found'];
        const code = known.find((item) => message.includes(item));
        return json({ error: code || 'soft_delete_failed' }, code ? 400 : 500);
      }
      const storage = await clearPublicProfileFiles(service, userId);
      return json({ ...data, storage_cleanup: storage });
    }

    return json({ error: 'unsupported_action' }, 400);
  } catch {
    return json({ error: 'request_failed' }, 400);
  }
});

export { validEmail, validTemporaryPassword, isAdult };
