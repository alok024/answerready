// Standalone Groq text helper — mirrors Vachix's raw-fetch pattern
// (backend/src/modules/ai/chat/chat.service.ts): POST the OpenAI-compatible endpoint.
// Keyless MOCK fallback so local dev + tests run without a GROQ_API_KEY.

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''; // optional fallback (Vachix uses gpt-4o-mini)

export const GROQ_MOCK = !GROQ_API_KEY && !OPENAI_API_KEY;

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

// Non-streaming completion. Returns the assistant text.
export async function generateText(messages: ChatMessage[], opts: GenerateOptions = {}): Promise<string> {
  if (GROQ_MOCK) {
    if (opts.mockResponder) return opts.mockResponder(messages);
    const last = messages[messages.length - 1]?.content ?? '';
    return `[[MOCK OUTPUT — no GROQ_API_KEY set]]\nEcho of prompt: ${last.slice(0, 400)}`;
  }

  const useOpenAI = !GROQ_API_KEY && !!OPENAI_API_KEY;
  const url = useOpenAI
    ? 'https://api.openai.com/v1/chat/completions'
    : 'https://api.groq.com/openai/v1/chat/completions';
  const key = useOpenAI ? OPENAI_API_KEY : GROQ_API_KEY;
  const model = useOpenAI ? (process.env.OPENAI_MODEL || 'gpt-4o-mini') : GROQ_MODEL;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.max_tokens ?? 1024,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Groq/OpenAI ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? '';
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
