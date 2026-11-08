import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import type { Grant } from './model';
export class SourceError extends Error { constructor(public code: string, message: string) { super(message); this.name = 'SourceError'; } }
export function publicIPv4(address: string) {
  const p = address.split('.').map(Number);
  if (p.length !== 4 || p.some(v => !Number.isInteger(v) || v < 0 || v > 255)) return false;
  const [a,b,c] = p;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}
export function grantFor(url: URL, purpose: Grant['purpose'], grants: readonly Grant[]) {
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined;
  return grants.find(g => g.origin === url.origin && g.purpose === purpose && typeof g.authorizationReference === 'string' && g.authorizationReference.trim() && Date.parse(g.expiresAt) > Date.now() && typeof g.pathPrefix === 'string' && g.pathPrefix.startsWith('/') && (g.pathPrefix === '/' || url.pathname === g.pathPrefix || url.pathname.startsWith(g.pathPrefix.endsWith('/') ? g.pathPrefix : g.pathPrefix + '/')));
}
export type HttpResult = { status: number; location?: string; contentType: string; body: string };
// Every request is exact-origin/path authorized. DNS is resolved and pinned to a
// validated public IPv4 address; redirects are returned, never auto-followed.
export async function authorizedRequest(url: URL, purpose: Grant['purpose'], grants: readonly Grant[], options: { head?: boolean; robots?: boolean; signal?: AbortSignal } = {}): Promise<HttpResult> {
  const grant = options.robots ? grants.find(g => g.origin === url.origin && g.purpose === purpose && g.authorizationReference && Date.parse(g.expiresAt) > Date.now()) : grantFor(url, purpose, grants);
  if (!grant || url.protocol !== 'https:' || url.username || url.password || url.port) throw new SourceError('permission_required', 'This source has no current authorization for this request.');
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(url.hostname, { family: 4, all: true }),
    new Promise<never>((_resolve,reject)=>{dnsTimer=setTimeout(()=>reject(new SourceError('timeout','The source DNS lookup timed out.')),2000);})
  ]).finally(()=>clearTimeout(dnsTimer));
  if (!addresses.length || addresses.some(a => !publicIPv4(a.address))) throw new SourceError('unsafe_destination', 'The destination is not a public internet address.');
  const address = addresses[0].address;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => req.destroy(new SourceError('timeout', 'The source timed out. Retry later.')), 7000);
    const req = request(url, { method: options.head ? 'HEAD' : 'GET', family: 4, lookup: (_hostname, _options, callback) => callback(null, address, 4), headers: { 'User-Agent': 'MrPinbot/1.0 (+https://pinbot.annabuchy.com)', Accept: purpose === 'feed' ? 'application/json' : 'text/html,text/plain', 'Accept-Encoding': 'identity' }, signal: options.signal }, res => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) { res.destroy(); resolve({ status, location: res.headers.location, contentType: '', body: '' }); return; }
      const chunks: Buffer[] = []; let bytes = 0;
      res.on('data', chunk => { bytes += chunk.length; if (bytes > 2_000_000) req.destroy(new SourceError('too_large', 'The response exceeded the size limit.')); else chunks.push(chunk); });
      res.on('end', () => resolve({ status, contentType: res.headers['content-type'] ?? '', body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject); req.on('close', () => clearTimeout(timer)); req.end();
  });
}
