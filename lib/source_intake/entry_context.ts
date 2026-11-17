import { isCanonicalUuid } from '../uuid.ts';
import type { SourcePurpose } from './registry.ts';

import {
  migrationPurposeError,
  type SourceIntakeDestination,
} from '../import/migration_destination.ts';
export type { SourceIntakeDestination } from '../import/migration_destination.ts';

export type SourceEntry = 'respondus';

export type SourceIntakeEntryContext = {
  readonly destination: SourceIntakeDestination;
  readonly initialPurpose: SourcePurpose;
  readonly entrySource?: SourceEntry;
};

export type SourceIntakeEntryContextResult =
  | { readonly ok: true; readonly context: SourceIntakeEntryContext }
  | { readonly ok: false; readonly message: string };

/**
 * Parses the public source-intake query into one explicit workflow context.
 */
export function parseSourceIntakeEntryContext(
  searchParams: URLSearchParams,
  destination: SourceIntakeDestination,
): SourceIntakeEntryContextResult {
  if (
    destination._tag === 'WorkspaceBank' && destination.collectionId !== null &&
    !isCanonicalUuid(destination.collectionId)
  ) return { ok: false, message: 'Invalid bank collection.' };
  const intent = searchParams.get('intent');
  const source = searchParams.get('source');

  if (intent !== null && intent !== 'recover' && intent !== 'generate') {
    return { ok: false, message: `QFlowLearn does not support the "${intent}" intake intent.` };
  }
  if (source !== null && source !== 'respondus') {
    return { ok: false, message: `QFlowLearn does not support the "${source}" intake source.` };
  }
  const purposeError = migrationPurposeError(
    destination,
    intent === 'generate' ? 'generate_new' : 'recover_existing',
  );
  if (purposeError) return { ok: false, message: purposeError };
  if (source === 'respondus' && intent === 'generate') {
    return {
      ok: false,
      message: 'The Respondus converter recovers existing questions. It does not generate them.',
    };
  }

  return {
    ok: true,
    context: {
      destination,
      initialPurpose: intent === 'generate' ? 'generate_new' : 'recover_existing',
      ...(source === 'respondus' ? { entrySource: source } : {}),
    },
  };
}
