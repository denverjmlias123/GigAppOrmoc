import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

type GuardAction = 'check' | 'failure' | 'success' | 'appeal';

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const body = await request.json();
    const action = body?.action as GuardAction;
    const email = normalizeEmail(body?.email);
    if (!email || !['check', 'failure', 'success', 'appeal'].includes(action)) {
      return json({ error: 'invalid_request' }, 400);
    }

    const url = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceRoleKey) return json({ error: 'server_unavailable' }, 503);

    const service = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const ip = (request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '')
      .split(',')[0].trim().slice(0, 64) || null;

    if (action === 'appeal') {
      const details = typeof body?.details === 'string' ? body.details.trim().slice(0, 1000) : '';
      if (!details || details.length < 10) {
        return json({ error: 'invalid_appeal_details' }, 400);
      }
      const { data: userRow } = await service.from('profiles').select('id').eq('email', email).maybeSingle();
      const targetId = userRow?.id || null;

      const { error: insertError } = await service.from('audit_events').insert({
        actor_id: targetId,
        actor_email: email,
        action: 'account_appeal',
        entity_type: 'profile',
        entity_id: targetId,
        metadata: {
          appeal_reason: details,
          ip,
          submitted_at: new Date().toISOString(),
        },
      });

      if (insertError) {
        return json({ error: 'server_unavailable' }, 503);
      }
      return json({ ok: true, message: 'Appeal submitted successfully.' });
    }

    if (action === 'check') {
      const { data, error } = await service.rpc('login_guard_check', { p_email: email, p_ip: ip });
      if (error) return json({ error: 'server_unavailable' }, 503);
      return json(data ?? { locked: false, seconds_left: 0, attempts_left: 3 });
    }

    if (action === 'failure') {
      // The gateway supplies this when available. It is recorded only for operational context;
      // per-address lockout remains authoritative and does not trust client-supplied IP fields.
      const { data, error } = await service.rpc('login_guard_failure', { p_email: email, p_ip: ip });
      if (error) return json({ error: 'server_unavailable' }, 503);
      return json(data ?? { locked: false, seconds_left: 0, attempts_left: 0 });
    }

    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);
    const jwt = authHeader.slice('Bearer '.length);
    const { data: { user }, error: authError } = await service.auth.getUser(jwt);
    if (authError || !user?.id || normalizeEmail(user.email) !== email) {
      return json({ error: 'unauthorized' }, 401);
    }
    const { error } = await service.rpc('login_guard_success', { p_email: email, p_user_id: user.id, p_ip: ip });
    if (error) return json({ error: 'server_unavailable' }, 503);
    return json({ ok: true });
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }
});

export { normalizeEmail };
