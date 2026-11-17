import { parsePersistedDraft } from '../lib/persisted_draft.ts';
import { projectJsonPersistenceObject } from '../lib/canonical_json.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import {
  exportQti3AssessmentItemXml,
  type Qti3AuthoringBuildOptions,
} from '../lib/types/qti3_authoring.ts';
import type { QuestionTypeId } from '../lib/types/registry.ts';

export function exportQti3TestItemXml(
  typeId: QuestionTypeId,
  draft: Record<string, unknown>,
  opts: Qti3AuthoringBuildOptions = {},
): string {
  const candidate = Object.hasOwn(draft, 'itemLanguage')
    ? draft
    : { ...draft, type: typeId, itemLanguage: newAuthoringItemLanguage() };
  return exportQti3AssessmentItemXml(
    typeId,
    parsePersistedDraft(projectJsonPersistenceObject(candidate), typeId),
    opts,
  );
}
