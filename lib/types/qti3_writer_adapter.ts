import type { AnswerFeedback } from '../answer_feedback.ts';
import { toQtiResponseFeedback } from '../answer_feedback_qti.ts';
import { sanitizeBodyHtml, sanitizeInlineHtml } from '../sanitize.ts';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { writeQti3AssessmentItemResult } from '@longsightgroup/qti3-writer';
import {
  mergeInteractionVocabulary,
  type QtiInteractionVocabulary,
  qtiStateFromInteractionVocabulary,
} from '../shared_vocabulary.ts';
import type {
  Qti3AssociateAuthoringItem,
  Qti3AuthoringChoice,
  Qti3AuthoringItem,
  Qti3ChoiceAuthoringItem,
  Qti3CustomInteractionAuthoringItem,
  Qti3DrawingAuthoringItem,
  Qti3EndAttemptAuthoringItem,
  Qti3ExtendedTextAuthoringItem,
  Qti3GapMatchAuthoringItem,
  Qti3GraphicAssociateAuthoringItem,
  Qti3GraphicGapMatchAuthoringItem,
  Qti3GraphicOrderAuthoringItem,
  Qti3HotspotAuthoringItem,
  Qti3HottextAuthoringItem,
  Qti3InlineChoiceAuthoringItem,
  Qti3MatchAuthoringItem,
  Qti3MediaAuthoringItem,
  Qti3OrderAuthoringItem,
  Qti3PortableCustomAuthoringItem,
  Qti3PositionObjectAuthoringItem,
  Qti3SelectPointAuthoringItem,
  Qti3SliderAuthoringItem,
  Qti3TextEntryAuthoringItem,
  Qti3TrustedXmlFragment,
  Qti3UploadAuthoringItem,
  Qti3WriterDiagnostic,
  Qti3WriterResult,
} from '@longsightgroup/qti3-writer';
import { selectPointCardinalityPolicy } from './select_point_cardinality.ts';

export type {
  Qti3AssociateAuthoringItem,
  Qti3AuthoringItem,
  Qti3ChoiceAuthoringItem,
  Qti3CustomInteractionAuthoringItem,
  Qti3DrawingAuthoringItem,
  Qti3EndAttemptAuthoringItem,
  Qti3ExtendedTextAuthoringItem,
  Qti3GapMatchAuthoringItem,
  Qti3GraphicAssociateAuthoringItem,
  Qti3GraphicGapMatchAuthoringItem,
  Qti3GraphicOrderAuthoringItem,
  Qti3HotspotAuthoringItem,
  Qti3HottextAuthoringItem,
  Qti3InlineChoiceAuthoringItem,
  Qti3MatchAuthoringItem,
  Qti3MediaAuthoringItem,
  Qti3OrderAuthoringItem,
  Qti3PortableCustomAuthoringItem,
  Qti3PositionObjectAuthoringItem,
  Qti3SelectPointAuthoringItem,
  Qti3SliderAuthoringItem,
  Qti3TextEntryAuthoringItem,
  Qti3TrustedXmlFragment,
  Qti3UploadAuthoringItem,
  Qti3WriterDiagnostic,
  Qti3WriterResult,
};

/**
 * Write a QTI item through qflow's typed writer boundary.
 *
 * QFlow owns narrow schema corrections for upstream writer behavior that cannot yet represent
 * qflow's authoring contract directly.
 */
export function writeQflowQti3AssessmentItemResult(
  item: Qti3AuthoringItem,
): Qti3WriterResult {
  const result = writeQti3AssessmentItemResult(item);
  if (!result.ok) return result;
  if (item.interactionType === 'selectPoint') {
    return normalizeSelectPointCardinality(result, item);
  }
  return result;
}

function normalizeSelectPointCardinality(
  result: { readonly ok: true; readonly xml: string; readonly diagnostics: readonly [] },
  item: Qti3SelectPointAuthoringItem,
): Qti3WriterResult {
  const policy = selectPointCardinalityPolicy(item.maxChoices);
  if (policy.responseCardinality !== 'multiple' || item.maxChoices !== 0) return result;

  const parser = new DOMParser();
  const document = parser.parseFromString(result.xml, 'text/xml');
  const declarations = document.getElementsByTagName('qti-response-declaration');
  let responseDeclaration: Element | undefined;
  for (let index = 0; index < declarations.length; index += 1) {
    const declaration = declarations.item(index);
    if (!declaration) continue;
    if (
      declaration.getAttribute('identifier') === item.responseIdentifier &&
      declaration.getAttribute('base-type') === 'point'
    ) {
      responseDeclaration = declaration;
      break;
    }
  }

  if (!responseDeclaration) {
    return {
      ok: false,
      diagnostics: [{
        code: 'select_point_cardinality_boundary',
        path: 'responseDeclaration.cardinality',
        message: 'Writer output omitted the select-point response declaration.',
      }],
    };
  }

  responseDeclaration.setAttribute('cardinality', policy.responseCardinality);
  return {
    ok: true,
    xml: new XMLSerializer().serializeToString(document),
    diagnostics: [],
  };
}

export type QflowChoiceForQti3 = {
  id: string;
  text?: string;
  html?: string;
  fixed?: boolean;
};

export type QflowChoiceAuthoringInput = {
  readonly answerFeedback?: AnswerFeedback;
  identifier: string;
  title: string;
  lang: string;
  bodyHtml?: string;
  promptHtml?: string;
  responseCardinality: 'single' | 'multiple';
  responseIdentifier?: string;
  maximumScore?: number;
  choices: readonly QflowChoiceForQti3[];
  correctResponse: readonly string[];
  shuffle?: boolean;
  minChoices?: number;
  maxChoices?: number;
  scoring?: 'match_correct' | 'map_response';
  choiceVisibility?: 'visible' | 'hide';
  classNames?: readonly string[];
  draftSharedVocabulary?: QtiInteractionVocabulary;
  optionSharedVocabulary?: QtiInteractionVocabulary;
};

export function trustedQti3Fragment(value: string): Qti3TrustedXmlFragment {
  // SAFETY: qflow callers route editor-controlled HTML through qflow's sanitizer before branding.
  return value as Qti3TrustedXmlFragment;
}

export function sanitizedQti3BodyFragment(value: string | undefined): Qti3TrustedXmlFragment {
  return trustedQti3Fragment(sanitizeBodyHtml(value ?? ''));
}

export function sanitizedQti3InlineFragment(value: string | undefined): Qti3TrustedXmlFragment {
  return trustedQti3Fragment(value != null && value !== '' ? sanitizeInlineHtml(value) : '');
}

export function toQti3ChoiceAuthoringItem(
  input: QflowChoiceAuthoringInput,
): Qti3ChoiceAuthoringItem {
  const sharedVocabulary = mergeInteractionVocabulary(
    input.draftSharedVocabulary,
    input.optionSharedVocabulary,
  );
  return {
    interactionType: 'choice',
    identifier: input.identifier,
    title: input.title || 'Untitled',
    lang: input.lang,
    bodyHtml: sanitizedQti3BodyFragment(input.bodyHtml),
    promptHtml: sanitizedQti3InlineFragment(input.promptHtml),
    responseCardinality: input.responseCardinality,
    responseIdentifier: input.responseIdentifier,
    maximumScore: input.maximumScore,
    responseFeedback: toQtiResponseFeedback(input.answerFeedback),
    choices: input.choices.map(toQti3Choice),
    correctResponse: input.correctResponse,
    shuffle: Boolean(input.shuffle),
    minChoices: input.minChoices,
    maxChoices: input.maxChoices,
    scoring: input.scoring ?? 'match_correct',
    choiceVisibility: input.choiceVisibility,
    classNames: input.classNames ?? [],
    sharedVocabulary: sharedVocabulary
      ? qtiStateFromInteractionVocabulary(sharedVocabulary)
      : undefined,
  };
}

function toQti3Choice(choice: QflowChoiceForQti3): Qti3AuthoringChoice {
  return {
    identifier: choice.id,
    text: choice.text,
    contentHtml: choice.html && choice.html.trim() !== ''
      ? trustedQti3Fragment(sanitizeInlineHtml(choice.html))
      : undefined,
    fixed: choice.fixed,
  };
}
