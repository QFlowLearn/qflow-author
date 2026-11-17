import { type BankCollectionCommand, parseBankCollectionCommand } from '../bank_collections.ts';
import { isCanonicalUuid } from '../uuid.ts';

/** Parse a collection management form without accepting duplicate, extra, or file fields. */
export function parseBankCollectionForm(
  form: FormData,
): { readonly operationId: string; readonly command: BankCollectionCommand } | null {
  if (form.get('collectionAction') === 'ReorderItems') {
    const allowed = ['collectionAction', 'collectionId', 'operationId', 'questionId'];
    if ([...form.keys()].some((key) => !allowed.includes(key))) return null;
    if (allowed.slice(0, 3).some((key) => form.getAll(key).length !== 1)) return null;
    const operationId = form.get('operationId');
    if (!isCanonicalUuid(operationId)) return null;
    const command = parseBankCollectionCommand({
      _tag: 'ReorderItems',
      collectionId: form.get('collectionId'),
      questionIds: form.getAll('questionId'),
    });
    return command ? { operationId, command } : null;
  }
  const fields = new Map<string, string>();
  for (const [key, value] of form.entries()) {
    if (typeof value !== 'string' || fields.has(key)) return null;
    fields.set(key, value);
  }
  const action = fields.get('collectionAction');
  const operationId = fields.get('operationId');
  if (!isCanonicalUuid(operationId)) return null;
  const metadata = action === 'Create' || action === 'Update';
  const expected = metadata
    ? ['collectionAction', 'operationId', 'collectionId', 'name', 'description', 'position']
    : ['collectionAction', 'operationId', 'collectionId'];
  if (fields.size !== expected.length || expected.some((key) => !fields.has(key))) return null;
  if (!metadata && action !== 'Archive' && action !== 'Restore') return null;
  const position = fields.get('position');
  if (metadata && (!position || !/^[1-9]\d*$/.test(position))) return null;
  const command = parseBankCollectionCommand(
    metadata
      ? {
        _tag: action,
        collectionId: fields.get('collectionId'),
        name: fields.get('name'),
        description: fields.get('description'),
        position: Number(position) - 1,
      }
      : { _tag: action, collectionId: fields.get('collectionId') },
  );
  return command ? { operationId, command } : null;
}
