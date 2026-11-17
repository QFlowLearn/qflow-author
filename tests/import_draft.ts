import { expect } from 'vitest';

import type { ParsedItemDraft } from '../lib/import/adapters/qti3/qti_document_to_draft.ts';
import type { QuestionTypeId } from '../lib/types/registry.ts';

export function draftOfType<T>(
  parsed: ParsedItemDraft,
  type: QuestionTypeId,
): T {
  expect(parsed.draft.type).toStrictEqual(type);
  return parsed.draft as T;
}
