const test = require('node:test');
const assert = require('node:assert');

test('Environment and security check', () => {
  // Ensure no service_role key exists in public environment
  assert.strictEqual(process.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.strictEqual(process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY, undefined);
});
