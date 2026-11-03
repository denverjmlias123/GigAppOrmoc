-- ============================================================================
-- GIGORMOC REFERENCE CATALOG & EVALUATOR BOOTSTRAP SEED DATA
-- Provides 24 Ormoc skills across 8 categories, bootstrap Admin accounts,
-- and an initial baseline scheduled database backup.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SEED SKILLS CATALOG (24 Skills across 8 Ormoc Categories)
-- ----------------------------------------------------------------------------

INSERT INTO public.skills_catalog (name, category, keywords)
VALUES
  -- Home Repair
  ('Carpentry & Woodwork', 'Home Repair', ARRAY['furniture', 'cabinet', 'repair', 'wood', 'table', 'door', 'roof']),
  ('Plumbing & Pipe Fitting', 'Home Repair', ARRAY['pipe', 'leak', 'drain', 'faucet', 'toilet', 'water', 'sink']),
  ('Electrical Wiring & Installation', 'Home Repair', ARRAY['wire', 'switch', 'breaker', 'lights', 'fan', 'outlet', 'solar']),

  -- Graphic Design
  ('Logo & Brand Identity', 'Graphic Design', ARRAY['branding', 'logo', 'vector', 'typography', 'business card']),
  ('Social Media Graphics', 'Graphic Design', ARRAY['canva', 'photoshop', 'facebook post', 'instagram story', 'ads']),
  ('Flyer, Poster & Tarpaulin Layout', 'Graphic Design', ARRAY['tarp', 'poster', 'print', 'banner', 'event flyer']),

  -- Web & IT Support
  ('Computer Repair & Reformatting', 'Web & IT Support', ARRAY['reformat', 'laptop', 'pc', 'windows', 'virus clean', 'hardware']),
  ('WiFi & Network Installation', 'Web & IT Support', ARRAY['router', 'lan', 'wifi', 'cabling', 'fiber', 'antenna']),
  ('WordPress & Website Setup', 'Web & IT Support', ARRAY['website', 'wordpress', 'domain', 'landing page', 'seo', 'hosting']),

  -- Event Photography
  ('Event & Portrait Photography', 'Event Photography', ARRAY['photo', 'portrait', 'camera', 'birthday', 'debut', 'dslr']),
  ('Videography & Video Editing', 'Event Photography', ARRAY['video', 'reels', 'youtube', 'premiere', 'capcut', 'drone']),
  ('Photo Retouching & Album Layout', 'Event Photography', ARRAY['lightroom', 'color grade', 'retouch', 'album', 'editing']),

  -- Academic Tutoring
  ('High School Math Tutoring', 'Academic Tutoring', ARRAY['algebra', 'geometry', 'calculus', 'trigonometry', 'exam review']),
  ('English & Grammar Tutoring', 'Academic Tutoring', ARRAY['essay', 'grammar', 'reading', 'speaking', 'research']),
  ('Science & Chemistry Tutoring', 'Academic Tutoring', ARRAY['biology', 'physics', 'chemistry', 'science', 'laboratory']),

  -- Bookkeeping & Admin
  ('Small Business Bookkeeping', 'Bookkeeping & Admin', ARRAY['accounting', 'receipts', 'ledger', 'cashflow', 'excel']),
  ('BIR Tax Filing Assistance', 'Bookkeeping & Admin', ARRAY['bir', 'tax', 'forms', 'compliance', 'returns']),
  ('Inventory & Stock Auditing', 'Bookkeeping & Admin', ARRAY['stock', 'inventory', 'warehouse', 'pos', 'supplies']),

  -- Delivery & Errands
  ('Motorcycle Courier & Errand Run', 'Delivery & Errands', ARRAY['motorcycle', 'package', 'pickup', 'deliver', 'fast']),
  ('Grocery & Market Shopping', 'Delivery & Errands', ARRAY['market', 'supermarket', 'pasabuy', 'groceries', 'errands']),
  ('Document Filing & Bank Errands', 'Delivery & Errands', ARRAY['bank', 'government', 'city hall', 'permits', 'papers']),

  -- Catering & Culinary
  ('Event Food Catering', 'Catering & Culinary', ARRAY['buffet', 'party', 'viands', 'lechon', 'fiesta', 'dinner']),
  ('Custom Cake & Pastry Baking', 'Catering & Culinary', ARRAY['cake', 'pastry', 'birthday cake', 'cupcakes', 'dessert']),
  ('Party Short Orders & Packed Meals', 'Catering & Culinary', ARRAY['packed meal', 'lunch box', 'finger food', 'snack', 'spaghetti'])
ON CONFLICT (name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. BOOTSTRAP ADMIN & SUPER ADMIN ACCOUNTS
-- Credentials for Evaluation (IAS 1 Checklists A, F, H):
--   Super Admin: superadmin@gigormoc.ph / SuperAdmin@123!
--   Admin:       admin@gigormoc.ph       / AdminPass@123!
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  v_sa_id uuid := '11111111-1111-1111-1111-111111111111';
  v_ad_id uuid := '22222222-2222-2222-2222-222222222222';
BEGIN
  -- Insert Super Admin into auth.users
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'superadmin@gigormoc.ph') THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_sa_id,
      'authenticated',
      'authenticated',
      'superadmin@gigormoc.ph',
      crypt('SuperAdmin@123!', gen_salt('bf', 10)),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"username":"superadmin","display_name":"Super Admin Evaluator"}'::jsonb,
      now(), now(), '', '', '', ''
    );

    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (v_sa_id, v_sa_id, jsonb_build_object('sub', v_sa_id::text, 'email', 'superadmin@gigormoc.ph'), 'email', v_sa_id::text, now(), now(), now());

    INSERT INTO public.profiles (
      id, username, email, display_name, date_of_birth, active_mode, email_verified,
      onboarding_completed, onboarding_step, is_active, is_admin_locked, verification_status, legitimacy_score
    ) VALUES (
      v_sa_id, 'superadmin', 'superadmin@gigormoc.ph', 'Super Admin Evaluator', '1990-01-01',
      'client', true, true, 3, true, false, 'verified', 100
    );

    INSERT INTO public.login_security_state (user_id, failed_attempts, lockout_tier, captcha_required)
    VALUES (v_sa_id, 0, 0, false);

    INSERT INTO public.platform_admins (user_id, role, assigned_by)
    VALUES (v_sa_id, 'super_admin', v_sa_id);
  END IF;

  -- Insert Admin into auth.users
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@gigormoc.ph') THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_ad_id,
      'authenticated',
      'authenticated',
      'admin@gigormoc.ph',
      crypt('AdminPass@123!', gen_salt('bf', 10)),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"username":"admin","display_name":"Platform Admin"}'::jsonb,
      now(), now(), '', '', '', ''
    );

    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (v_ad_id, v_ad_id, jsonb_build_object('sub', v_ad_id::text, 'email', 'admin@gigormoc.ph'), 'email', v_ad_id::text, now(), now(), now());

    INSERT INTO public.profiles (
      id, username, email, display_name, date_of_birth, active_mode, email_verified,
      onboarding_completed, onboarding_step, is_active, is_admin_locked, verification_status, legitimacy_score
    ) VALUES (
      v_ad_id, 'admin', 'admin@gigormoc.ph', 'Platform Admin', '1995-05-15',
      'client', true, true, 3, true, false, 'verified', 90
    );

    INSERT INTO public.login_security_state (user_id, failed_attempts, lockout_tier, captcha_required)
    VALUES (v_ad_id, 0, 0, false);

    INSERT INTO public.platform_admins (user_id, role, assigned_by)
    VALUES (v_ad_id, 'admin', v_sa_id);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. INITIAL SCHEDULED DATABASE BACKUP BASELINE
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.database_backups WHERE backup_type = 'scheduled') THEN
    INSERT INTO public.database_backups (
      created_by_admin_id,
      created_by_identifier,
      backup_type,
      label,
      checksum_sha256,
      table_row_counts,
      snapshot_payload
    ) VALUES (
      '11111111-1111-1111-1111-111111111111',
      'superadmin@gigormoc.ph',
      'scheduled',
      'Initial Baseline Seed Backup',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      jsonb_build_object('skills_catalog', 24, 'profiles', 2, 'platform_admins', 2),
      jsonb_build_object(
        'skills_catalog', (SELECT jsonb_agg(to_jsonb(sc)) FROM public.skills_catalog sc),
        'profiles', (SELECT jsonb_agg(to_jsonb(p)) FROM public.profiles p),
        'platform_admins', (SELECT jsonb_agg(to_jsonb(pa)) FROM public.platform_admins pa)
      )
    );
  END IF;
END $$;
