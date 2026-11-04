import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Avatar Upload & Storage Resilience', async (t) => {
  const root = process.cwd();

  await t.test('1. Migration 20261104000006 creates set_profile_avatar RPC and storage policies', () => {
    const migrationPath = path.join(root, 'supabase', 'migrations', '20261104000006_fix_avatars_storage_and_rpc.sql');
    assert.ok(fs.existsSync(migrationPath), 'Migration file must exist');

    const content = fs.readFileSync(migrationPath, 'utf8');
    assert.match(content, /p_avatar_path text DEFAULT NULL/i, 'Must define p_avatar_path default parameter');
    assert.match(content, /p_avatar_url text DEFAULT NULL/i, 'Must define p_avatar_url default parameter');
    assert.match(content, /Auth Upload Avatars/i, 'Must define Auth Upload Avatars policy');
    assert.match(content, /Auth Update Avatars/i, 'Must define Auth Update Avatars policy');
    assert.match(content, /Auth Delete Avatars/i, 'Must define Auth Delete Avatars policy');
    assert.match(content, /Public Read Avatars/i, 'Must define Public Read Avatars policy');
    assert.match(content, /avatar_path = v_target_url,\s+avatar_url = v_target_url/i, 'Must update both avatar_path and avatar_url in profiles');
  });

  await t.test('2. services/profile.ts has direct fallback update if RPC fails and supports web Blobs', () => {
    const servicePath = path.join(root, 'services', 'profile.ts');
    const content = fs.readFileSync(servicePath, 'utf8');

    assert.match(content, /supabase[\s\S]*?\.from\('profiles'\)[\s\S]*?\.update/i, 'Must have direct fallback to profiles table');
    assert.match(content, /new Blob\(\[fileData as any\],\s*\{ type: validation\.mimeType \}\)/i, 'Must safely construct Blob for web');
    assert.match(content, /upsert:\s*true/i, 'Must enable upsert in storage upload');
  });

  await t.test('3. app/(tabs)/profile.tsx opens picker and checks avatar_path or avatar_url', () => {
    const profilePath = path.join(root, 'app', '(tabs)', 'profile.tsx');
    const content = fs.readFileSync(profilePath, 'utf8');

    assert.match(content, /handleMissingItemPress[\s\S]*?item\.key === 'photo'[\s\S]*?handlePickAvatar\('library'\)/i, 'Missing photo tap triggers handlePickAvatar');
    assert.match(content, /profile\?\.avatar_path \|\| profile\?\.avatar_url/i, 'Avatar and remove button check both avatar_path and avatar_url');
  });

  await t.test('4. get_profile_completeness counts avatar as complete if either avatar_path or avatar_url is set', () => {
    const migrationPath = path.join(root, 'supabase', 'migrations', '20261104000006_fix_avatars_storage_and_rpc.sql');
    const content = fs.readFileSync(migrationPath, 'utf8');

    assert.match(content, /v_p\.avatar_path IS NOT NULL AND trim\(v_p\.avatar_path\) <> ''\s*\)\s*OR\s*\(\s*v_p\.avatar_url IS NOT NULL/i, 'Completeness checks either avatar_path or avatar_url');
  });
});
