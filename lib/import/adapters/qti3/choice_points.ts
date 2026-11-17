import type { QtiAssessmentItem } from '@longsightgroup/qti3-core';
import type { ParsedItemDraft } from './qti_document_to_draft.ts';
import { canonicalJsonStringify, type CanonicalJsonValue } from '../../../canonical_json.ts';
import {
  exportQti3AssessmentItemXml,
  QflowQti3WriterExportError,
} from '../../../types/qti3_authoring.ts';
import { childElements, parseXmlStrict } from '../../xml_dom.ts';
import { choiceAnswerWarnings } from '../../choice_answer_warnings.ts';
import type { ImportWarning } from '../../types.ts';
import type { ItemLanguage } from '../../../types/item_language.ts';

/** Structured import-boundary refusal; packages retain the original as a blocked review item. */
export class QtiChoicePointsImportError extends Error {
  readonly code = 'QTI3_CHOICE_POINTS_NOT_PRESERVED' as const;
  readonly path = 'assessmentItem/responseProcessing';
  readonly itemLanguage: ItemLanguage;
  readonly answerWarnings: readonly ImportWarning[];
  constructor(reason: string, draft: ParsedItemDraft['draft']) {
    super(`Question points cannot be preserved for editing: ${reason}`);
    this.name = 'QtiChoicePointsImportError';
    this.itemLanguage = draft.itemLanguage;
    this.answerWarnings = choiceAnswerWarnings(draft, 'assessmentItem');
  }
}

type ChoicePointsImportResult =
  | { readonly ok: true; readonly draft: ParsedItemDraft['draft'] }
  | { readonly ok: false; readonly error: QtiChoicePointsImportError };

/** Recognize a point candidate only when the actual declaration/program XML is retained. */
export function importChoicePoints(
  xml: string,
  item: QtiAssessmentItem,
  draft: ParsedItemDraft['draft'],
  parsedWithoutErrors: boolean,
): ChoicePointsImportResult {
  if (!['single_select', 'multi_select', 'inline_choice'].includes(draft.type)) {
    return { ok: true, draft };
  }
  const maxima = item.outcomeDeclarations.filter((entry) => entry.identifier === 'MAXSCORE');
  const hasRange = item.outcomeDeclarations.some((entry) =>
    entry.identifier === 'SCORE' && Object.hasOwn(entry.attributes, 'normal-maximum')
  );
  const markedMaximum = maxima.length > 0 || hasRange;
  let maximumScore: number | undefined;
  if (markedMaximum) {
    const maximum = maxima[0]?.defaultValue;
    if (
      !parsedWithoutErrors || maxima.length !== 1 || typeof maximum !== 'number' ||
      !Number.isFinite(maximum) || maximum < 0 || maxima[0].cardinality !== 'single' ||
      maxima[0].baseType !== 'float'
    ) {
      return refused('A unique finite non-negative MAXSCORE declaration is required.', draft);
    }
    maximumScore = maximum;
  }
  if (
    !parsedWithoutErrors || item.adaptive ||
    (draft.responseMode === 'custom' && !(draft.type === 'inline_choice' && markedMaximum)) ||
    (draft.type === 'inline_choice'
      ? item.interactions.some((interaction) => interaction.type !== 'inlineChoice')
      : item.interactions.length !== 1)
  ) {
    return refused(
      'The source has scoring or interaction dependencies outside this authoring model.',
      draft,
    );
  }
  // Weighted dropdowns have one supported canonical model. In particular, its zero-point
  // program has no match expression from which the generic mode mapper could infer matching.
  // The complete XML identity below, rather than that inference, authorizes this import.
  const candidate = {
    ...draft,
    ...(maximumScore === undefined ? {} : { maximumScore }),
    responseMode: draft.type === 'inline_choice' && markedMaximum
      ? 'all_or_nothing' as const
      : draft.responseMode,
  };
  let written: string;
  try {
    written = exportQti3AssessmentItemXml(candidate.type, candidate, {
      identifier: item.identifier,
      scoring: candidate.responseMode === 'partial' ? 'map_response' : 'match_correct',
    });
  } catch (cause: unknown) {
    if (!(cause instanceof QflowQti3WriterExportError)) throw cause;
    return refused('The shared writer cannot reproduce the declared point configuration.', draft);
  }
  if (scoringXmlIdentity(xml) !== scoringXmlIdentity(written)) {
    return refused('Response declarations, outcomes, feedback or processing would change.', draft);
  }
  return { ok: true, draft: candidate };
}

function refused(reason: string, draft: ParsedItemDraft['draft']): ChoicePointsImportResult {
  return { ok: false, error: new QtiChoicePointsImportError(reason, draft) };
}

const SCORING_CHILDREN = new Set([
  'qti-response-declaration',
  'qti-outcome-declaration',
  'qti-response-processing',
  'qti-template-declaration',
  'qti-template-processing',
  'qti-modal-feedback',
]);

function scoringXmlIdentity(xml: string): string {
  const root = parseXmlStrict(xml, 'choice point fidelity').documentElement;
  const nodes = childElements(root)
    .filter((element) => SCORING_CHILDREN.has(element.localName))
    .map(scoringNode);
  // Declarations are identified by their attributes; their sibling order has no scoring effect.
  // Internal expression/rule order remains exact. Unknown children/attributes remain in the tree.
  return canonicalJsonStringify(nodes.map(canonicalJsonStringify).sort());
}

function scoringNode(element: Element): CanonicalJsonValue {
  const attributes: CanonicalJsonValue[] = [];
  for (let i = 0; i < element.attributes.length; i++) {
    const attribute = element.attributes.item(i);
    if (!attribute || attribute.namespaceURI === 'http://www.w3.org/2000/xmlns/') continue;
    attributes.push({
      namespace: attribute.namespaceURI || '',
      name: attribute.localName,
      value: attribute.value,
    });
  }
  const children: CanonicalJsonValue[] = [];
  for (let i = 0; i < element.childNodes.length; i++) {
    const child = element.childNodes.item(i);
    if (!child) continue;
    if (child.nodeType === 1) {
      // SAFETY: DOM nodeType 1 establishes an Element for structural XML projection.
      children.push(scoringNode(child as Element));
    } else if ((child.nodeType === 3 || child.nodeType === 4) && child.nodeValue?.trim()) {
      children.push(child.nodeValue);
    }
  }
  return {
    namespace: element.namespaceURI || '',
    name: element.localName,
    attributes: attributes.map(canonicalJsonStringify).sort(),
    children,
  };
}
