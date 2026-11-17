import type { Draft } from './types/draft.ts';
import { normalizeDraftForDriver } from './types/draft_utils.ts';
import { type QuestionTypeId, TYPE_DRIVERS } from './types/registry.ts';
import { parseValidPersistedDraft } from './persisted_draft.ts';
import { canonicalJsonStringify, projectJsonPersistenceObject } from './canonical_json.ts';
import { parseXmlStrict, serializer } from './import/xml_dom.ts';
import { isValidQtiIdentifier } from './qti_identifiers.ts';

/** Parse persisted question content before it is used as a variant source. */
export function parseQuestionVariantDraft(
  value: unknown,
  label: 'source' | 'target',
): Draft & { readonly type: QuestionTypeId } {
  try {
    return parseValidPersistedDraft(value);
  } catch (cause: unknown) {
    throw new Error(`Variant ${label} question body is invalid.`, { cause });
  }
}

/** Return only type changes that preserve the source question's answer construct. */
export function compatibleVariantTypes(draft: Draft): readonly QuestionTypeId[] {
  const type = draft.type;
  if (!type) return [];
  if (type === 'single_select') return ['single_select', 'multi_select'];
  if (type === 'multi_select' && (draft.correctIds ?? []).length === 1) {
    return ['multi_select', 'single_select'];
  }
  return [type];
}

/** Create a new draft through one explicit construct-preserving transformation. */
export function createQuestionVariantDraft(
  source: Draft,
  targetType: QuestionTypeId,
): Draft {
  const sourceType = source.type;
  if (!sourceType || !compatibleVariantTypes(source).includes(targetType)) {
    throw new Error(
      `Cannot preserve the construct when changing ${sourceType ?? 'unknown'} to ${targetType}.`,
    );
  }
  const title = sourceType === targetType
    ? source.title
    : source.title?.trim()
    ? `${source.title.trim()} variant`
    : 'Question variant';
  const base = {
    ...source,
    itemId: undefined,
    title,
    preserveSourceXml: sourceType === targetType ? source.preserveSourceXml === true : false,
  };
  if (sourceType === targetType) return base;
  if (sourceType === 'single_select' && targetType === 'multi_select') {
    const { correctId: _correctId, ...withoutSingleKey } = base;
    return {
      ...withoutSingleKey,
      type: 'multi_select',
      correctIds: source.correctId ? [source.correctId] : [],
      minChoices: 1,
      maxChoices: 1,
    };
  }
  if (sourceType === 'multi_select' && targetType === 'single_select') {
    const correctId = source.correctIds?.[0];
    if (!correctId || source.correctIds?.length !== 1) {
      throw new Error(
        'Multiple-select questions need exactly one correct option for this transform.',
      );
    }
    const { correctIds: _correctIds, ...withoutMultipleKey } = base;
    return {
      ...withoutMultipleKey,
      type: 'single_select',
      correctId,
      minChoices: 1,
      maxChoices: 1,
    };
  }
  throw new Error(`No construct-preserving transform exists from ${sourceType} to ${targetType}.`);
}

/** Give an independent copy a new root identity without rebuilding its saved content or scoring. */
export function copyQuestionSourceXml(
  sourceXml: string,
  identifier: string,
): { readonly ok: true; readonly xml: string } | { readonly ok: false } {
  if (!isValidQtiIdentifier(identifier)) return { ok: false };
  try {
    const document = parseXmlStrict(sourceXml, 'question copy');
    const root = document.documentElement;
    if (
      root.localName !== 'qti-assessment-item' ||
      root.namespaceURI !== 'http://www.imsglobal.org/xsd/imsqtiasi_v3p0'
    ) return { ok: false };
    root.setAttribute('identifier', identifier);
    return { ok: true, xml: serializer.serializeToString(document) };
  } catch {
    return { ok: false };
  }
}

/** Test whether persisted target content is exactly the server-owned source transformation. */
export function isExactQuestionVariantTransformation(
  source: Draft & { readonly type: QuestionTypeId },
  target: Draft & { readonly type: QuestionTypeId },
  targetType: QuestionTypeId,
): boolean {
  if (target.type !== targetType || !compatibleVariantTypes(source).includes(targetType)) {
    return false;
  }
  const expected = createQuestionVariantDraft(source, targetType);
  return canonicalVariantDraft(expected, targetType) === canonicalVariantDraft(target, targetType);
}

function canonicalVariantDraft(draft: Draft, type: QuestionTypeId): string {
  const normalized = normalizeDraftForDriver(type, {
    ...draft,
    type,
    answerMasking: Boolean(draft.answerMasking),
  }) as Draft;
  const serialized = TYPE_DRIVERS[type].serialize(normalized);
  return canonicalJsonStringify(projectJsonPersistenceObject(serialized));
}
