import { lookup } from 'dns/promises';
import net from 'net';

function isBlockedIP(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 0) return true;
    if (p[0] === 127) return true;
    if (p[0] === 10) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    if (p[0] >= 224) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const norm = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (norm === '::1' || norm === '::') return true;
    if (norm.startsWith('fe80')) return true;
    if (norm.startsWith('fc') || norm.startsWith('fd')) return true;
    const mapped = norm.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIP(mapped[1]);
    return false;
  }
  return true;
}

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
