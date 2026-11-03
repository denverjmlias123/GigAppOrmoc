export const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** @param {{ apiKey: string, models: string[], prompt: string }} options */
export function buildOpenRouterRequest({ apiKey, models, prompt }) {
  if (!apiKey?.trim()) throw new Error('OpenRouter API key is required.');
  if (!Array.isArray(models) || models.length !== 3) {
    throw new Error('Exactly three OpenRouter models are required.');
  }
  const normalizedModels = models.map((model) => String(model).trim());
  if (normalizedModels.some((model) => !/^[\w.~/-]+$/.test(model))) {
    throw new Error('OpenRouter model IDs contain invalid characters.');
  }
  if (new Set(normalizedModels).size !== normalizedModels.length) {
    throw new Error('OpenRouter model IDs must be unique.');
  }

  return {
    url: OPENROUTER_CHAT_COMPLETIONS_URL,
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        models: normalizedModels,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1500,
        temperature: 0.2,
      }),
    },
  };
}

/** @param {any} responseBody */
export function readOpenRouterText(responseBody) {
  const content = responseBody?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
}
