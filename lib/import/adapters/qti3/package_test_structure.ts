import type {
  QtiAssessmentSectionPackageModel,
  QtiAssessmentTestPackageModel,
  QtiTestPartPackageModel,
} from '@longsightgroup/qti3-core';

import type { PartOptions } from '../../../test_export.ts';
import { normalizeQtiHtmlFragment } from './content_html.ts';
import type { ImportedPart, ImportedPlacement } from '../../types.ts';
import { importSectionContent } from './standalone_content.ts';
import {
  attr,
  childElements,
  findAllDescendantsByLocalName,
  findChildByLocalName,
  findChildrenByLocalName,
  localName,
  parseXml,
  serializeChildren,
} from '../../xml_dom.ts';

export function parseTestStructure(
  test: QtiAssessmentTestPackageModel,
): ImportedPart[] {
  const root = parseXml(test.xml, 'qti-assessment-test').documentElement;
  const elementsByIdentifier = new Map(
    findAllDescendantsByLocalName(root, 'qti-test-part')
      .map((element) => [attr(element, 'identifier'), element] as const),
  );
  const sectionsByIdentifier = new Map(
    findAllDescendantsByLocalName(root, 'qti-assessment-section')
      .map((element) => [attr(element, 'identifier'), element] as const),
  );
  return test.testParts.map((part, index) =>
    importedPart(
      part,
      index,
      elementsByIdentifier.get(part.identifier),
      sectionsByIdentifier,
      test.href,
    )
  );
}

function importedPart(
  part: QtiTestPartPackageModel,
  index: number,
  element: Element | undefined,
  sectionsByIdentifier: ReadonlyMap<string | null, Element>,
  sourceHref: string,
): ImportedPart {
  const options: PartOptions = {
    navigationMode: part.navigationMode,
    submissionMode: part.submissionMode,
    timeLimits: part.timeLimits
      ? {
        minTime: part.timeLimits.minTimeSeconds,
        maxTime: part.timeLimits.maxTimeSeconds,
      }
      : undefined,
    ...(element ? extractPartContent(element) : {}),
    ...(element ? extractAnswerFeedbackRelease(element) : {}),
  };
  return {
    id: part.identifier,
    title: part.attributes.title?.trim() || `Part ${index + 1}`,
    placements: part.sections.flatMap((section) =>
      sectionPlacements(section, sectionsByIdentifier, sourceHref)
    ),
    options: Object.values(options).some((value) => value !== undefined) ? options : undefined,
  };
}

function sectionPlacements(
  section: QtiAssessmentSectionPackageModel,
  elements: ReadonlyMap<string | null, Element>,
  sourceHref: string,
): ImportedPlacement[] {
  const element = elements.get(section.identifier);
  if (!element) throw new Error('Assessment section has no source XML scope.');
  const placements: ImportedPlacement[] = importSectionContent(element, sourceHref).map((
    content,
  ) => ({
    content,
    refIdentifier: section.identifier,
  }));
  const refs = new Map(section.itemRefs.map((ref) => [ref.identifier, ref]));
  const children = new Map(section.sections.map((child) => [child.identifier, child]));
  for (const child of childElements(element)) {
    const identifier = attr(child, 'identifier');
    if (localName(child) === 'qti-assessment-item-ref') {
      const ref = identifier === null ? undefined : refs.get(identifier);
      if (!ref) throw new Error('Assessment item reference has no canonical resource binding.');
      placements.push({ href: ref.href, refIdentifier: ref.identifier });
    } else if (localName(child) === 'qti-assessment-section') {
      const nested = identifier === null ? undefined : children.get(identifier);
      if (!nested) throw new Error('Nested assessment section has no canonical scope binding.');
      placements.push(...sectionPlacements(nested, elements, sourceHref));
    }
  }
  return placements;
}

function extractPartContent(el: Element): Pick<PartOptions, 'instructionsHtml' | 'feedback'> {
  const options: Pick<PartOptions, 'instructionsHtml' | 'feedback'> = {};
  const rubric = findChildByLocalName(el, 'qti-rubric-block');
  if (rubric) {
    const html = normalizeQtiHtmlFragment(serializeChildren(rubric));
    if (html.trim()) options.instructionsHtml = html;
  }
  const feedbackEls = findChildrenByLocalName(el, 'qti-test-feedback');
  if (feedbackEls.length) {
    options.feedback = feedbackEls.map((fb) => ({
      id: attr(fb, 'identifier') || `FB-${attr(el, 'identifier') || ''}`,
      access: attr(fb, 'access') === 'during' ? 'during' : 'atEnd',
      showHide: attr(fb, 'show-hide') === 'hide' ? 'hide' : 'show',
      outcomeIdentifier: attr(fb, 'outcome-identifier') || 'TEST_FEEDBACK',
      html: normalizeQtiHtmlFragment(serializeChildren(fb)),
    }));
  }
  return options;
}

function extractAnswerFeedbackRelease(part: Element): Pick<PartOptions, 'answerFeedbackRelease'> {
  const refs = findAllDescendantsByLocalName(part, 'qti-assessment-item-ref');
  const values = refs.map((ref) =>
    attr(findChildByLocalName(ref, 'qti-item-session-control') ?? ref, 'show-feedback')
  );
  if (values.every((value) => value === null)) return {};
  if (values.every((value) => value === 'true' || value === '1')) {
    return { answerFeedbackRelease: 'after-submit' };
  }
  if (values.every((value) => value === 'false' || value === '0')) {
    return { answerFeedbackRelease: 'never' };
  }
  throw new Error(
    'Mixed or invalid answer feedback release settings cannot be preserved in this part.',
  );
}
