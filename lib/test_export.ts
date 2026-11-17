import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { AssessmentExportError } from './export/assessment_export_error.ts';
import type { AssessmentContentPlacement } from './assessment_standalone_content.ts';
import { qti3TrustedXmlFragment, writeQti3FixedAssessmentTest } from '@longsightgroup/qti3-writer';
import { sanitizeInlineHtml } from './sanitize.ts';
import { createPackageIdentifierFactory, toPackageIdentifier } from './qti_identifiers.ts';
import { parseQtiTestRubrics, type QtiFixedTestItemRef } from '@longsightgroup/qti3-core';
import type { Qti3TrustedXmlFragment } from '@longsightgroup/qti3-writer';
import { assessmentContentQtiFragment } from './assessment_content_qti.ts';

export type QuestionPlacement = {
  id: string;
  itemId: string;
  snapshotRev?: number;
  /** Retain this authored position when its section is shuffled. */
  fixed?: boolean;
};
export type Placement = QuestionPlacement | AssessmentContentPlacement;
export type PartOptions = {
  /** Harbor releases matching explanations after the whole assessment is submitted, or never. */
  answerFeedbackRelease?: 'after-submit' | 'never';
  /** Randomize questions inside this fixed part; authored placement order remains unchanged. */
  shuffleQuestions?: boolean;
  navigationMode?: 'linear' | 'nonlinear';
  submissionMode?: 'individual' | 'simultaneous';
  timeLimits?: { minTime?: number; maxTime?: number };
  instructionsHtml?: string;
  feedback?: Array<
    {
      id: string;
      access: 'during' | 'atEnd';
      showHide: 'show' | 'hide';
      outcomeIdentifier: string;
      html: string;
    }
  >;
};
export type Part = { id: string; title: string; placements: Placement[]; options?: PartOptions };

/** Project fixed authoring settings into the shared, schema-ordered QTI writer. */
export function buildAssessmentTestXml(a: { id: string; title?: string }, parts: Part[]): string {
  const next = createPackageIdentifierFactory();
  const contentSections: string[] = [];
  const result = writeQti3FixedAssessmentTest({
    identifier: next(`test-${a.id}`, 'test'),
    title: a.title || 'Assessment',
    parts: parts.map((part, index) => ({
      identifier: next(part.id, `part-${index + 1}`),
      title: part.title || `Part ${index + 1}`,
      navigationMode: part.options?.navigationMode ?? 'nonlinear',
      submissionMode: part.options?.submissionMode ?? 'individual',
      timeLimits: part.options?.timeLimits,
      instructions: part.options?.instructionsHtml
        ? qti3TrustedXmlFragment(sanitizeInlineHtml(part.options.instructionsHtml))
        : undefined,
      sections: fixedSections(part, index, next, contentSections),
      feedback: (part.options?.feedback ?? []).map((feedback) => ({
        identifier: next(feedback.id, `fb-${index + 1}`),
        outcomeIdentifier: toPackageIdentifier(feedback.outcomeIdentifier, 'TEST_FEEDBACK'),
        access: feedback.access,
        showHide: feedback.showHide,
        content: qti3TrustedXmlFragment(sanitizeInlineHtml(feedback.html)),
      })),
    })),
  });
  if (!result.ok) throw new Error('Assessment structure cannot be written as QTI 3.');
  if (contentSections.length) {
    const rubrics = parseQtiTestRubrics(result.value);
    if (
      !rubrics.ok ||
      contentSections.some((id) =>
        !rubrics.value.some((rubric) =>
          rubric.scopeType === 'assessment-section' && rubric.scopeIdentifier === id
        )
      )
    ) {
      throw new AssessmentExportError(
        'Text blocks could not be preserved in this export. Update QFlow to a build that supports text blocks, then retry.',
      );
    }
  }
  return applyAnswerFeedbackRelease(result.value, parts);
}

/** Content owns an instruction-only scope; contiguous real questions retain their own scope. */
function fixedSections(
  part: Part,
  partIndex: number,
  next: ReturnType<typeof createPackageIdentifierFactory>,
  contentSections: string[],
) {
  type Section = {
    identifier: string;
    title: string;
    shuffle?: boolean;
    instructions?: Qti3TrustedXmlFragment;
    items: QtiFixedTestItemRef[];
  };
  const sections: Section[] = [];
  let questions: Section | null = null;
  for (const [position, placement] of part.placements.entries()) {
    if ('content' in placement) {
      if (part.options?.shuffleQuestions) {
        throw new Error('Standalone text blocks require authored question order.');
      }
      const identifier = next(`content-${placement.id}`, 'content');
      contentSections.push(identifier);
      sections.push({
        identifier,
        title: 'Instructions',
        instructions: qti3TrustedXmlFragment(assessmentContentQtiFragment(placement.content)),
        items: [],
      });
      questions = null;
      continue;
    }
    if (!questions) {
      questions = {
        identifier: next(
          `section-${part.id}${sections.length ? `-${placement.id}` : ''}`,
          `section-${partIndex + 1}`,
        ),
        title: part.title || `Part ${partIndex + 1}`,
        shuffle: part.options?.shuffleQuestions,
        items: [],
      };
      sections.push(questions);
    }
    questions.items.push({
      identifier: next(
        `itemref-${placement.itemId}-${position + 1}`,
        `itemref-${partIndex + 1}-${position + 1}`,
      ),
      href: `items/${placement.itemId}.xml`,
      fixed: placement.fixed === true ? true : undefined,
      categories: [],
    });
  }
  if (!sections.length) {
    sections.push({
      identifier: next(`section-${part.id}`, `section-${partIndex + 1}`),
      title: part.title || `Part ${partIndex + 1}`,
      shuffle: part.options?.shuffleQuestions,
      items: [],
    });
  }
  return sections;
}

/** The fixed-test writer has no session-control field; add only this explicit portable setting. */
function applyAnswerFeedbackRelease(xml: string, parts: readonly Part[]): string {
  if (!parts.some((part) => part.options?.answerFeedbackRelease !== undefined)) return xml;
  const document = new DOMParser().parseFromString(xml, 'text/xml');
  const scopes = document.getElementsByTagName('qti-test-part');
  for (const [index, part] of parts.entries()) {
    const policy = part.options?.answerFeedbackRelease;
    if (policy === undefined) continue;
    const scope = scopes.item(index);
    if (!scope) throw new Error('Feedback release has no test-part scope.');
    const refs = scope.getElementsByTagName('qti-assessment-item-ref');
    for (let i = 0; i < refs.length; i++) {
      const ref = refs.item(i);
      if (!ref) throw new Error('Feedback release has no item reference.');
      const control = document.createElementNS(
        'http://www.imsglobal.org/xsd/imsqtiasi_v3p0',
        'qti-item-session-control',
      );
      control.setAttribute('show-feedback', policy === 'after-submit' ? 'true' : 'false');
      ref.insertBefore(control, ref.firstChild);
    }
  }
  return new XMLSerializer().serializeToString(document);
}
