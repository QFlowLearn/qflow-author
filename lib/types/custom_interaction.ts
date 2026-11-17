import { isValidQtiIdentifier } from '../qti_identifiers.ts';
import type { ItemLanguage } from './item_language.ts';
import {
  type Qti3CustomInteractionAuthoringItem,
  sanitizedQti3BodyFragment,
  sanitizedQti3InlineFragment,
  trustedQti3Fragment,
} from './qti3_writer_adapter.ts';

export type CustomInteractionAttribute = { name: string; value: string };

export type CustomInteractionDraft = {
  title: string;
  promptHtml?: string;
  bodyHtml?: string;
  responseIdentifier: string;
  customBaseType?: string;
  customCardinality?: 'single' | 'multiple' | 'ordered' | 'record';
  customClassName?: string;
  customDefinition?: string;
  customAttributes?: CustomInteractionAttribute[];
  customInteractionMarkup?: string;
  customResponseProcessingXml?: string;
};

export type BuildOptions = { identifier?: string; lang: ItemLanguage };

const CARDINALITIES = ['single', 'multiple', 'ordered', 'record'] as const;
const RESERVED_ATTRS = new Set(['response-identifier', 'class', 'definition']);
const ATTR_NAME_RE = /^[A-Za-z_][A-Za-z0-9:._-]*$/;

export function defaultsCustomInteraction(): CustomInteractionDraft {
  return {
    title: 'Custom Interaction',
    promptHtml: 'Provide any short instruction here.',
    bodyHtml: '<p>Describe the custom interaction.</p>',
    responseIdentifier: 'RESPONSE',
    customBaseType: 'string',
    customCardinality: 'single',
    customClassName: 'customInteraction',
    customDefinition: '',
    customAttributes: [],
    customInteractionMarkup: '<div class="custom-interaction">Custom markup here</div>',
  };
}

export function validateCustomInteraction(draft: CustomInteractionDraft): string[] {
  const errs: string[] = [];
  if (!draft.title?.trim()) errs.push('Title is required.');
  const responseIdentifier = (draft.responseIdentifier ?? '').trim();
  if (!responseIdentifier) errs.push('Response identifier is required.');
  else if (!isValidQtiIdentifier(responseIdentifier)) {
    errs.push('Response identifier must be a valid QTI identifier.');
  }
  const baseType = (draft.customBaseType ?? '').trim();
  if (!baseType) errs.push('Response base type is required.');
  const cardinality = (draft.customCardinality ?? 'single') as string;
  if (!CARDINALITIES.includes(cardinality as any)) {
    errs.push('Response cardinality must be single, multiple, ordered, or record.');
  }
  const className = (draft.customClassName ?? '').trim();
  if (className && !isValidQtiIdentifier(className)) {
    errs.push('Custom interaction class must be a valid QTI identifier.');
  }
  const markup = (draft.customInteractionMarkup ?? '').trim();
  if (!markup) errs.push('Custom interaction markup is required.');
  const attrs = Array.isArray(draft.customAttributes) ? draft.customAttributes : [];
  for (const attr of attrs) {
    const name = (attr?.name ?? '').trim();
    if (!name) {
      errs.push('Custom attribute names cannot be empty.');
      continue;
    }
    if (!ATTR_NAME_RE.test(name)) {
      errs.push(`Custom attribute "${name}" is not a valid XML attribute name.`);
      continue;
    }
    if (RESERVED_ATTRS.has(name)) {
      errs.push(`Custom attribute "${name}" duplicates a reserved attribute.`);
    }
  }
  return errs;
}

export function toQti3CustomInteractionAuthoringItem(
  draft: CustomInteractionDraft,
  opts: BuildOptions,
): Qti3CustomInteractionAuthoringItem {
  const definition = (draft.customDefinition ?? '').trim();
  const responseProcessing = (draft.customResponseProcessingXml ?? '').trim();
  const className = (draft.customClassName ?? '').trim();
  return {
    interactionType: 'custom',
    identifier: opts.identifier ?? `item-${crypto.randomUUID()}`,
    title: draft.title || 'Untitled',
    lang: opts.lang,
    bodyHtml: sanitizedQti3BodyFragment(draft.bodyHtml),
    promptHtml: sanitizedQti3InlineFragment(draft.promptHtml),
    responseIdentifier: draft.responseIdentifier ?? 'RESPONSE',
    responseBaseType:
      ((draft.customBaseType ?? 'string').trim() || 'string') as Qti3CustomInteractionAuthoringItem[
        'responseBaseType'
      ],
    responseCardinality:
      (draft.customCardinality ?? 'single') as Qti3CustomInteractionAuthoringItem[
        'responseCardinality'
      ],
    definition: definition || undefined,
    classNames: className ? [className] : [],
    attributes: (draft.customAttributes ?? []).map((attr) => ({
      name: attr.name,
      value: attr.value,
    })),
    interactionMarkupHtml: trustedQti3Fragment((draft.customInteractionMarkup ?? '').trim()),
    responseProcessingXml: responseProcessing ? trustedQti3Fragment(responseProcessing) : undefined,
  };
}
