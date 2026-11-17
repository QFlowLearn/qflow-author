import { resolve4, resolve6, resolveTxt } from 'node:dns/promises';

/** Resolve TXT chunks through the named Node DNS API supported by Cloudflare workerd. */
export function resolveDomainTxt(domain: string): Promise<string[][]> {
  return resolveTxt(domain);
}

/** Resolve one address family without using the unsupported generic DNS resolver. */
export function resolveDomainAddresses(domain: string, family: 'A' | 'AAAA'): Promise<string[]> {
  return family === 'A' ? resolve4(domain) : resolve6(domain);
}
