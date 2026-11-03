-- Copy-paste OTP auth: fake email, no real email delivery.
-- System generates a 6-digit code shown in-app; user copies and pastes it to verify.

create extension if not exists pgcrypto;

create table public.email_verification_otps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  otp_hash text not null,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_email_verification_otps_user_id on public.email_verification_otps(user_id);
create index idx_email_verification_otps_expires_at on public.email_verification_otps(expires_at);

alter table public.email_verification_otps enable row level security;

create policy "Owner can view own OTPs"
  on public.email_verification_otps
  for select
  using (auth.uid() = user_id);

create policy "Owner can insert own OTPs"
  on public.email_verification_otps
  for insert
  with check (auth.uid() = user_id);

create or replace function public.create_signup_otp(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_otp text;
  v_otp_hash text;
begin
  -- Generate 6-digit numeric OTP
  v_otp := lpad(floor(random() * 1000000)::int::text, 6, '0');

  -- Hash OTP bound to user id
  v_otp_hash := encode(digest(concat(v_otp, p_user_id::text), 'sha256'), 'hex');

  -- Invalidate any existing unused OTPs for this user (single active OTP)
  update public.email_verification_otps
  set used_at = now()
  where user_id = p_user_id and used_at is null;

  -- Insert new OTP
  insert into public.email_verification_otps (user_id, otp_hash, expires_at)
  values (p_user_id, v_otp_hash, now() + interval '10 minutes');

  return v_otp;
end;
$$;

create or replace function public.verify_signup_otp(p_user_id uuid, p_otp text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_otp_hash text;
begin
  -- Find the latest unused, unexpired OTP for this user
  select otp_hash into v_otp_hash
  from public.email_verification_otps
  where user_id = p_user_id
    and used_at is null
    and expires_at > now()
  order by created_at desc
  limit 1;

  if v_otp_hash is null then
    return false;
  end if;

  -- Verify hash
  if encode(digest(concat(p_otp, p_user_id::text), 'sha256'), 'hex') <> v_otp_hash then
    return false;
  end if;

  -- Mark as used (single-use)
  update public.email_verification_otps
  set used_at = now()
  where user_id = p_user_id
    and used_at is null
    and expires_at > now()
    and otp_hash = v_otp_hash;

  return true;
end;
$$;

-- Lock down: no direct table access for anon/public; authenticated only.
revoke all on public.email_verification_otps from public, anon;
grant select, insert on public.email_verification_otps to authenticated;

revoke execute on function public.create_signup_otp(uuid) from public, anon;
grant execute on function public.create_signup_otp(uuid) to authenticated;

revoke execute on function public.verify_signup_otp(uuid, text) from public, anon;
grant execute on function public.verify_signup_otp(uuid, text) to authenticated;
