
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

export const GROQ_MOCK = !GROQ_API_KEY && !OPENAI_API_KEY;

const REQUEST_TIMEOUT_MS = 20000;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateOptions {
  temperature?: number;
  max_tokens?: number;
  json?: boolean;
  mockResponder?: (messages: ChatMessage[]) => string;
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
      if (err instanceof RetryableProviderError && OPENAI_API_KEY) {
        return await callProvider(openaiProvider(), messages, opts);
      }
      throw err;
    }
  }

  return await callProvider(openaiProvider(), messages, opts);
}

export async function generateJSON<T = unknown>(messages: ChatMessage[], opts: GenerateOptions = {}): Promise<T> {
  const text = await generateText(messages, { ...opts, json: true });
  try {
    return JSON.parse(text) as T;
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as T;
    throw new Error('Model did not return valid JSON');
  }
}
