import { isCanonicalUuid } from './uuid.ts';

/** One bounded collection mutation. Update also sets the collection's navigation position. */
export type BankCollectionCommand =
  | {
    readonly _tag: 'Create' | 'Update';
    readonly collectionId: string;
    readonly name: string;
    readonly description: string;
    readonly position: number;
  }
  | { readonly _tag: 'Archive' | 'Restore'; readonly collectionId: string }
  | {
    readonly _tag: 'AddItems' | 'RemoveItems' | 'ReorderItems';
    readonly collectionId: string;
    readonly questionIds: readonly string[];
  };

/** Parse untrusted commands, including persisted receipts, into one canonical representation. */
export function parseBankCollectionCommand(input: unknown): BankCollectionCommand | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  if (
    !('_tag' in input) || !('collectionId' in input) || typeof input.collectionId !== 'string' ||
    !isCanonicalUuid(input.collectionId)
  ) return null;
  const collectionId = input.collectionId;
  switch (input._tag) {
    case 'Create':
    case 'Update': {
      if (Object.keys(input).sort().join(',') !== '_tag,collectionId,description,name,position') {
        return null;
      }
      if (
        !('name' in input) || typeof input.name !== 'string' || !input.name.trim() ||
        input.name.trim().length > 160
      ) return null;
      if (
        !('description' in input) || typeof input.description !== 'string' ||
        input.description.length > 4000
      ) return null;
      if (
        !('position' in input) || typeof input.position !== 'number' ||
        !Number.isInteger(input.position) || input.position < 0 || input.position > 2147483647
      ) return null;
      return {
        _tag: input._tag,
        collectionId,
        name: input.name.trim(),
        description: input.description,
        position: input.position,
      };
    }
    case 'Archive':
    case 'Restore':
      return Object.keys(input).sort().join(',') === '_tag,collectionId'
        ? { _tag: input._tag, collectionId }
        : null;
    case 'AddItems':
    case 'RemoveItems':
    case 'ReorderItems': {
      if (Object.keys(input).sort().join(',') !== '_tag,collectionId,questionIds') return null;
      if (
        !('questionIds' in input) || !Array.isArray(input.questionIds) ||
        input.questionIds.length < 1 || input.questionIds.length > 500
      ) return null;
      const questionIds: string[] = [];
      for (const id of input.questionIds) {
        if (typeof id !== 'string' || !isCanonicalUuid(id)) return null;
        questionIds.push(id);
      }
      if (new Set(questionIds).size !== questionIds.length) return null;
      return { _tag: input._tag, collectionId, questionIds };
    }
    default:
      return null;
  }
}
