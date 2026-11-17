import { buildQtiPreviewXml } from '../qti_preview.ts';
import type { Draft } from '../types/draft.ts';
import { unlabeledImportItemLanguage } from '../types/item_language.ts';
import { xmlEscape } from '../xml.ts';
import type { ImportedDraftValidation, ImportedItem, ImportedSourceEvidence } from './types.ts';

type SynthesizedImportedItem = ImportedItem & {
  readonly draftValidation: ImportedDraftValidation;
};

/** Import draft before the canonical item-language enrichment boundary. */
export type UnlabeledImportDraft = Omit<Draft, 'itemLanguage' | 'type'> & {
  readonly type: NonNullable<Draft['type']>;
};

/** Normalize one synthesized draft and project it into the canonical imported-item shape. */
export function buildImportedItem(input: {
  readonly draft: UnlabeledImportDraft;
  readonly identifier: string;
  readonly title: string;
  readonly sourceText: string;
  readonly href: string;
  readonly sourceFormat: import('../types/item_language.ts').UnlabeledImportSource;
  readonly sourceEvidence?: ImportedSourceEvidence[];
}): SynthesizedImportedItem {
  const typeId = input.draft.type;
  if (!typeId) throw new Error('Imported draft is missing its question type.');
  // SAFETY: normalizeDraftForDriver hydrates the selected driver and preserves its required type
  // discriminant. This module is the single projection boundary for synthesized import items.
  const draft: Draft & { readonly type: NonNullable<Draft['type']> } = {
    itemLanguage: unlabeledImportItemLanguage(input.sourceFormat),
    ...input.draft,
  };
  const built = buildQtiPreviewXml(draft, { identifier: input.identifier });
  const projected = built.ok
    ? {
      xml: built.xml,
      draftValidation: { _tag: 'validated' as const, warnings: [] },
    }
    : {
      xml: buildReviewPlaceholderQti({
        identifier: input.identifier,
        title: input.title,
        sourceText: input.sourceText,
        itemLanguage: draft.itemLanguage,
      }),
      draftValidation: {
        _tag: 'validated' as const,
        warnings: built.issues.map((issue) => ({
          code: 'QFLOW_DRAFT_VALIDATION' as const,
          message: issue.message,
          detail:
            'QTI preview build failed; QFlowLearn created a non-interactive placeholder for review.',
          path: input.href,
        })),
      },
    };

  return {
    href: input.href,
    identifier: input.identifier,
    title: input.title,
    xml: projected.xml,
    draft,
    draftValidation: projected.draftValidation,
    sourceEvidence: input.sourceEvidence,
  };
}

function buildReviewPlaceholderQti(input: {
  readonly identifier: string;
  readonly title: string;
  readonly sourceText: string;
  readonly itemLanguage: Draft['itemLanguage'];
}): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<qti-assessment-item xmlns="https://purl.imsglobal.org/spec/qti/v3p0"',
    ` identifier="${xmlEscape(input.identifier)}" title="${xmlEscape(input.title)}" xml:lang="${
      xmlEscape(input.itemLanguage)
    }"`,
    ' adaptive="false" time-dependent="false">',
    `<qti-item-body><p>${
      xmlEscape(input.sourceText || 'Source question text is missing.')
    }</p></qti-item-body>`,
    '</qti-assessment-item>',
  ].join('');
}
