import { lookup } from 'dns/promises';
import net from 'net';

// SSRF guard for user-supplied URLs (URL mode fetches a page the caller names).
// Blocks loopback / private / link-local / ULA / CGNAT / unspecified / multicast targets so
// the fetch cannot reach cloud metadata (169.254.169.254), localhost, or internal services.

function isBlockedIP(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 0) return true; // 0.0.0.0/8 unspecified
    if (p[0] === 127) return true; // loopback
    if (p[0] === 10) return true; // private
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // private
    if (p[0] === 192 && p[1] === 168) return true; // private
    if (p[0] === 169 && p[1] === 254) return true; // link-local (incl. cloud metadata)
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT 100.64/10
    if (p[0] >= 224) return true; // multicast / reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const norm = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (norm === '::1' || norm === '::') return true; // loopback / unspecified
    if (norm.startsWith('fe80')) return true; // link-local
    if (norm.startsWith('fc') || norm.startsWith('fd')) return true; // unique-local fc00::/7
    const mapped = norm.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
    if (mapped) return isBlockedIP(mapped[1]);
    return false;
  }
  return true; // unparseable -> block
}

// Validate scheme, reject credentials, and ensure every resolved address is public.
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http/https URLs are allowed');
  if (u.username || u.password) throw new Error('URLs with embedded credentials are not allowed');

  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isBlockedIP(host)) throw new Error('URL resolves to a non-public address');
    return u;
  }
  const resolved = await lookup(host, { all: true });
  if (!resolved.length) throw new Error('Host did not resolve');
  for (const r of resolved) {
    if (isBlockedIP(r.address)) throw new Error('URL resolves to a non-public address');
  }
  return u;
}

// SSRF-safe fetch: validates the URL, then follows redirects manually, re-validating each hop
// so a public URL cannot redirect into an internal one. (Residual DNS-rebinding risk is best
// closed in production with an egress allowlist/proxy; noted in README.)
export async function safeFetch(raw: string, init?: RequestInit, maxRedirects = 3): Promise<Response> {
  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const u = await assertPublicUrl(current);
    const res = await fetch(u, { ...init, redirect: 'manual' });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, u).toString();
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects');
}
