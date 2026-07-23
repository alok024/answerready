import { generateKit } from '@/lib/generate';
import { safeFetch } from '@/lib/ssrf';

export const runtime = 'nodejs';

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
  let body: { mode?: string; value?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const mode = body.mode === 'url' ? 'url' : 'topic';
  const value = (body.value || '').trim();
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
      if (res.ok) {
        const html = await res.text();
        pageText = stripTags(html).slice(0, 6000);
      }
    } catch {
      // Fetch failed or the URL was rejected as non-public: silently fall back to topic mode
      // (no error oracle that would reveal whether an internal host exists).
      pageText = undefined;
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
