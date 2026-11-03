export const OPENROUTER_CHAT_COMPLETIONS_URL: string;
export function buildOpenRouterRequest(options: {
  apiKey: string;
  models: string[];
  prompt: string;
}): { url: string; init: RequestInit };
export function readOpenRouterText(responseBody: unknown): string;
