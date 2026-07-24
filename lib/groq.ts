// Standalone Groq text helper — mirrors Vachix's raw-fetch pattern
// (backend/src/modules/ai/chat/chat.service.ts): POST the OpenAI-compatible endpoint.
// Keyless MOCK fallback so local dev + tests run without a GROQ_API_KEY.

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''; // optional fallback (Vachix uses gpt-4o-mini)

export const GROQ_MOCK = !GROQ_API_KEY && !OPENAI_API_KEY;

// Hard cap so a hung provider can't stall the request indefinitely.
const REQUEST_TIMEOUT_MS = 20000;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateOptions {
  temperature?: number;
  max_tokens?: number;
  json?: boolean; // request a JSON object response
  mockResponder?: (messages: ChatMessage[]) => string; // deterministic local output
}

interface Provider {
  name: string;
  url: string;
  key: string;
  model: string;
}

function groqProvider(): Provider {
  return {
    name: 'Groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    key: GROQ_API_KEY,
    model: GROQ_MODEL,
  };
}

function openaiProvider(): Provider {
  return {
    name: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
    key: OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  };
}

// Tags failures worth retrying against a fallback provider: the upstream is
// overloaded/rate-limited, or the request never completed (network drop, our timeout).
class RetryableProviderError extends Error {}

async function callProvider(provider: Provider, messages: ChatMessage[], opts: GenerateOptions): Promise<string> {
  let res: Response;
  try {
    res = await fetch(provider.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.key}` },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.max_tokens ?? 1024,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new RetryableProviderError(`${provider.name} request failed: ${msg}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const message = `${provider.name} ${res.status}: ${body.slice(0, 300)}`;
    if (res.status === 429 || res.status >= 500) throw new RetryableProviderError(message);
    throw new Error(message);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? '';
}

// Non-streaming completion. Returns the assistant text.
export async function generateText(messages: ChatMessage[], opts: GenerateOptions = {}): Promise<string> {
  if (GROQ_MOCK) {
    if (opts.mockResponder) return opts.mockResponder(messages);
    const last = messages[messages.length - 1]?.content ?? '';
    return `[[MOCK OUTPUT — no GROQ_API_KEY set]]\nEcho of prompt: ${last.slice(0, 400)}`;
  }

  if (GROQ_API_KEY) {
    try {
      return await callProvider(groqProvider(), messages, opts);
    } catch (err) {
      // runtime failover: only for retryable Groq failures, and only if OpenAI is configured
      if (err instanceof RetryableProviderError && OPENAI_API_KEY) {
        return await callProvider(openaiProvider(), messages, opts);
      }
      throw err;
    }
  }

  return await callProvider(openaiProvider(), messages, opts);
}

// Convenience: force a JSON object out and parse it (with a mock path).
export async function generateJSON<T = unknown>(messages: ChatMessage[], opts: GenerateOptions = {}): Promise<T> {
  const text = await generateText(messages, { ...opts, json: true });
  try {
    return JSON.parse(text) as T;
  } catch {
    // tolerate ```json fences
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as T;
    throw new Error('Model did not return valid JSON');
  }
}
