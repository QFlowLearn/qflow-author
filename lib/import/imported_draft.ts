import { parsePersistedDraft, type PersistedDraft } from '../persisted_draft.ts';
import { type OrganizationTransfer, parseOrganizationTransfer } from '../organization_transfer.ts';
import type { Draft } from '../types/draft.ts';
import type { QuestionTypeId } from '../types/registry.ts';

/** Reviewed source envelope; organization is consumed into the ledger, never the saved draft. */
export type ImportedDraft = Draft & {
  readonly type: QuestionTypeId;
  readonly importOrganization?: OrganizationTransfer;
};

/** Parse the import-only envelope separately from the ordinary authoring draft contract. */
export function parseImportedDraft(
  value: unknown,
  expectedType: QuestionTypeId,
): ImportedDraft & PersistedDraft {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Imported draft must be an object.');
  }
  // SAFETY: the object guard above permits key projection; both payloads are parsed below.
  const { importOrganization, ...body } = value as Record<string, unknown>;
  const draft = parsePersistedDraft(body, expectedType);
  return importOrganization === undefined
    ? draft
    : { ...draft, importOrganization: parseOrganizationTransfer(importOrganization) };
}
