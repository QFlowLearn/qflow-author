import { isIP } from 'node:net';
/** Only the Worker composition can attest where an incoming Request came from. */
export type Ingress = 'CloudflareEdge' | 'Local';
/** Cloudflare metadata and an edge composition are required; HTTP headers alone prove nothing. */
export function readClientIp(request: Request, ingress: Ingress): string | null {
  if (ingress !== 'CloudflareEdge') return null;
  const metadata: unknown = Reflect.get(request, 'cf');
  if (!metadata || typeof metadata !== 'object') return null;
  const address = request.headers.get('cf-connecting-ip')?.trim();
  return address && isIP(address) ? address : null;
}
