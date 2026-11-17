import {
  type SourceBlock,
  sourceBlocksToText,
  type StructuredSourceDocument,
} from './source_model.ts';

/** Build a normalized evidence index for an imported assessment package. */
export function buildPackageIndexDocument(input: {
  readonly title: string;
  readonly entries: ReadonlyArray<
    { readonly href: string; readonly title: string; readonly identifier?: string }
  >;
}): StructuredSourceDocument {
  return buildPackageEvidenceDocument({
    title: input.title,
    entries: input.entries.map((entry, index) => ({
      id: `package-entry-${index + 1}`,
      text: `${entry.href}: ${entry.title || entry.identifier || `Item ${index + 1}`}`,
    })),
    uncertaintyMessage:
      'Normalized view lists package entries recovered by the import adapter; original bytes remain the authority.',
  });
}

/**
 * Build normalized evidence extracted by a deterministic package adapter.
 *
 * The caller owns the provenance statement because an index and reconstructed field view establish
 * different evidence.
 */
export function buildPackageEvidenceDocument(input: {
  readonly title: string;
  readonly entries: ReadonlyArray<{ readonly id: string; readonly text: string }>;
  readonly uncertaintyMessage: string;
}): StructuredSourceDocument {
  const blocks: SourceBlock[] = input.entries.map((entry) => ({
    id: entry.id,
    kind: 'paragraph',
    text: entry.text,
  }));
  return {
    version: 1,
    title: input.title,
    sourceKind: 'package',
    blocks,
    text: sourceBlocksToText(blocks),
    uncertainties: [{
      code: 'STRUCTURE_INFERRED',
      message: input.uncertaintyMessage,
    }],
  };
}
