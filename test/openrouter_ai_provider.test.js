const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('OpenRouter AI provider request', async () => {
  const { OPENROUTER_CHAT_COMPLETIONS_URL, buildOpenRouterRequest, readOpenRouterText } =
    await import('../supabase/functions/ai-assist/openrouter.mjs');

  it('targets the OpenRouter chat completions endpoint and sends the configured model securely', () => {
    const { url, init } = buildOpenRouterRequest({
      apiKey: 'test-secret',
      models: ['provider/primary', 'provider/fallback-one', 'provider/fallback-two'],
      prompt: 'Return a JSON object.',
    });

    assert.equal(url, OPENROUTER_CHAT_COMPLETIONS_URL);
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer test-secret');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(init.body), {
      models: ['provider/primary', 'provider/fallback-one', 'provider/fallback-two'],
      messages: [{ role: 'user', content: 'Return a JSON object.' }],
      max_tokens: 1500,
      temperature: 0.2,
    });
  });

  it('rejects missing keys, wrong fallback counts, and duplicate or invalid model IDs', () => {
    const models = ['provider/primary', 'provider/fallback-one', 'provider/fallback-two'];
    assert.throws(() => buildOpenRouterRequest({ apiKey: '', models, prompt: 'prompt' }));
    assert.throws(() => buildOpenRouterRequest({ apiKey: 'test-secret', models: models.slice(0, 2), prompt: 'prompt' }));
    assert.throws(() => buildOpenRouterRequest({ apiKey: 'test-secret', models: [models[0], models[0], models[2]], prompt: 'prompt' }));
    assert.throws(() => buildOpenRouterRequest({ apiKey: 'test-secret', models: [models[0], 'bad model', models[2]], prompt: 'prompt' }));
  });

  it('reads only string content from the chat completion response', () => {
    assert.equal(readOpenRouterText({ choices: [{ message: { content: '{"skills":[]}' } }] }), '{"skills":[]}');
    assert.equal(readOpenRouterText({ choices: [{ message: { content: null } }] }), '');
    assert.equal(readOpenRouterText({ choices: [] }), '');
  });
});
