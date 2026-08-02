
export const MAX_INPUT_CHARS = 500;
export const MAX_FETCH_BYTES = 2_000_000;
export const MAX_PAGE_TEXT_CHARS = 6000;

export function capText(input: string, max: number = MAX_INPUT_CHARS): string {
  if (typeof input !== 'string') return '';
  return input.trim().slice(0, max);
}

export async function readCappedText(res: Response, maxBytes: number = MAX_FETCH_BYTES): Promise<string> {
  if (maxBytes <= 0) return '';

  if (!res.body) {
    const text = await res.text();
    return text.slice(0, maxBytes);
  }

  const declared = Number(res.headers.get('content-length'));
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
