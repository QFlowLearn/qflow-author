import { isCanonicalUuid } from './uuid.ts';
import { parseEnrichmentDimensions } from './services/bank_enrichment_run_contract.ts';

/** A localized action failure or an allowlisted setup destination, parsed at the HTTP boundary. */
export type EnrichmentActionReply = { readonly url: string } | { readonly error: string };
/** Send one logical command; callers retain operation IDs across retries. */
export async function submitEnrichmentAction(
  url: string,
  command: unknown,
  options: { readonly signal?: AbortSignal } = {},
): Promise<EnrichmentActionReply | null> {
  const form = new FormData();
  form.set('payload', JSON.stringify(command));
  try {
    const response = await fetch(url, { method: 'POST', body: form, signal: options.signal });
    const raw: unknown = await response.json();
    return parseEnrichmentActionReply(raw);
  } catch {
    return null;
  }
}

/** Accept only local job destinations and explicitly parsed preview field selections. */
export function parseEnrichmentActionReply(raw: unknown): EnrichmentActionReply | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  if (Object.keys(raw).join(',') === 'url' && 'url' in raw && typeof raw.url === 'string') {
    if (raw.url === '/items/organize') return { url: raw.url };
    const match = /^\/items\/organize\/([0-9a-f-]{36})(?:\?(.+))?$/.exec(raw.url);
    if (!match || !isCanonicalUuid(match[1])) return null;
    if (match[2] !== undefined) {
      const query = new URLSearchParams(match[2]);
      if (query.toString() === 'kind=organization') return { url: raw.url };
      if (
        [...query.keys()].join(',') !== 'fields' ||
        !parseEnrichmentDimensions(query.get('fields')?.split(','))
      ) return null;
    }
    return { url: raw.url };
  }
  if (
    Object.keys(raw).join(',') === 'error' && 'error' in raw && typeof raw.error === 'string' &&
    raw.error.length < 2000
  ) return { error: raw.error };
  return null;
}
