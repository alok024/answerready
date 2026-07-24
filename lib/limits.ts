// lib/limits.ts - input and fetch-size caps (zero-dependency, Node built-ins only).

export const MAX_INPUT_CHARS = 500; // hard cap on user topic/value before it enters the LLM prompt
export const MAX_FETCH_BYTES = 2_000_000; // hard cap on URL-mode fetched body size in bytes
export const MAX_PAGE_TEXT_CHARS = 6000; // downstream page-text slice cap

// Trim then hard-truncate to max (default MAX_INPUT_CHARS). Never throws; returns '' for non-strings.
export function capText(input: string, max: number = MAX_INPUT_CHARS): string {
  if (typeof input !== 'string') return '';
  return input.trim().slice(0, max);
}

// Read a fetch Response body as text with a hard byte cap. Honors Content-Length when present AND
// enforces the cap while streaming res.body, so a missing or lying Content-Length cannot buffer an
// unbounded body. Decodes via TextDecoder; falls back to a bounded res.text() if res.body is null.
export async function readCappedText(res: Response, maxBytes: number = MAX_FETCH_BYTES): Promise<string> {
  if (maxBytes <= 0) return '';

  if (!res.body) {
    const text = await res.text();
    return text.slice(0, maxBytes);
  }

  const declared = Number(res.headers.get('content-length'));
  // An honest oversized Content-Length lets us cap the target below maxBytes up front; a missing,
  // non-integer, or understated header falls back to maxBytes, and the per-chunk count below is
  // what actually enforces the cap either way, so it cannot be bypassed by a lying header.
  const target = Number.isInteger(declared) && declared > 0 ? Math.min(declared, maxBytes) : maxBytes;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  let total = 0;

  try {
    while (total < target) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      const chunk = value.subarray(0, target - total);
      out += decoder.decode(chunk, { stream: true });
      total += chunk.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return out + decoder.decode();
}
