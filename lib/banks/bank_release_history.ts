import { uuid } from './bank_release.ts';

/** Stable keyset anchor into the workspace's newest-first edition history. */
export type ReleaseHistoryQuery = { readonly before: string | null };
/** Reject malformed anchors and unsupported history controls at HTTP ingress. */
export function parseReleaseHistoryQuery(params: URLSearchParams): ReleaseHistoryQuery | null {
  if ([...params.keys()].some((key) => key !== 'before' || params.getAll(key).length !== 1)) {
    return null;
  }
  const before = params.get('before');
  return before === null || uuid(before) ? { before } : null;
}
