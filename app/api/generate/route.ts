import { generateKit } from '@/lib/generate';
import { safeFetch } from '@/lib/ssrf';
import { capText, readCappedText, MAX_PAGE_TEXT_CHARS } from '@/lib/limits';
import { getRateLimitStore, clientIp } from '@/lib/store/rate-limit';

export const runtime = 'nodejs';

// Same message/status for a rejected-non-public URL and a generic fetch failure so a caller
// can't distinguish "SSRF-blocked" from "unreachable" (no existence/timing oracle).
const URL_FETCH_ERROR = 'Could not fetch that URL. Make sure it is public and reachable.';

// Crudely strip HTML to text so page content can seed the FAQ generation.
function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function POST(req: Request) {
  const key = clientIp(req);
  const limit = getRateLimitStore().hit(key);
  if (!limit.allowed) {
    return Response.json(
      { error: 'Rate limit exceeded, please try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limit.resetMs / 1000)) } },
    );
  }

  let body: { mode?: string; value?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const mode = body.mode === 'url' ? 'url' : 'topic';
  const value = capText(body.value ?? '');
  if (!value) {
    return Response.json({ error: 'Please enter a URL or topic.' }, { status: 400 });
  }

  let pageText: string | undefined;
  if (mode === 'url') {
    try {
      // safeFetch blocks SSRF (internal/private/metadata targets) and re-validates redirects.
      const res = await safeFetch(value.startsWith('http') ? value : `https://${value}`, {
        headers: { 'user-agent': 'AnswerReadyBot/1.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error('Fetch failed');
      const html = await readCappedText(res);
      pageText = stripTags(html).slice(0, MAX_PAGE_TEXT_CHARS);
    } catch {
      return Response.json({ error: URL_FETCH_ERROR }, { status: 422 });
    }
  }

  try {
    const kit = await generateKit({ mode, value, pageText });
    return Response.json(kit);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Generation failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
