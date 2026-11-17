import { expect, test as testCase } from 'vitest';

import { createItemSession, parseQtiXml, visibleModalFeedback } from '@longsightgroup/qti3-core';
import type { Draft } from '../lib/types/draft.ts';
import { type AnswerFeedback, parseAnswerFeedback } from '../lib/answer_feedback.ts';
import { buildQtiPreviewXml } from '../lib/qti_preview.ts';
import {
  parseItemXml,
  recognizeEditableChoiceSource,
} from '../lib/import/adapters/qti3/parse_item.ts';
import { parseItemLanguage } from '../lib/types/item_language.ts';
import { requireAssessmentAnswerFeedbackRelease } from '../lib/export/assessment.ts';
import { buildAssessmentTestXml } from '../lib/test_export.ts';
const feedback: AnswerFeedback = {
  correct: {
    text: 'Correct <literal>\nSecond line',
    link: { url: 'https://example.org/lesson?a=1&b=2', label: 'Read more' },
    media: null,
  },
  incorrect: {
    text: 'Try a different idea',
    link: null,
    media: {
      kind: 'video-link',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Explanation',
      transcript: 'Accessible transcript',
      networkNotice: 'Internet required',
    },
  },
};
const draft = {
  type: 'single_select' as const,
  itemLanguage: parseItemLanguage('en-US'),
  title: 'Feedback',
  bodyHtml: '<p>Choose A</p>',
  choices: [{ id: 'A', text: 'One' }, { id: 'B', text: 'Two' }],
  correctId: 'A',
  answerFeedback: feedback,
  maximumScore: 0,
};
function xml() {
  const built = buildQtiPreviewXml(draft, { identifier: 'feedback-test' });
  if (!built.ok) throw new Error(JSON.stringify(built));
  return built.xml;
}
testCase(
  'feedback: exact content and whole-response program round-trip, including zero-score correctness',
  () => {
    const source = xml();
    expect(parseItemXml(source).draft.answerFeedback).toStrictEqual(feedback);
    expect(recognizeEditableChoiceSource(source)._tag).toStrictEqual('Editable');
    const document = parseQtiXml(source).document!;
    const session = createItemSession(document);
    expect(visibleModalFeedback(document.item, session.serialize().outcomes).length).toStrictEqual(
      0,
    );
    session.respond('RESPONSE', 'B');
    session.score();
    expect(
      visibleModalFeedback(document.item, session.serialize().outcomes).map((f) => f.identifier),
    ).toStrictEqual(['INCORRECT']);
    session.respond('RESPONSE', 'A');
    session.score();
    expect(
      visibleModalFeedback(document.item, session.serialize().outcomes).map((f) => f.identifier),
    ).toStrictEqual(['CORRECT']);
  },
);
testCase(
  'feedback: reject unsafe links, malformed explanations and unrepresentable source programs',
  () => {
    for (
      const url of [
        'javascript:alert(1)',
        'http://example.org',
        'https://user:password@example.org',
        'https://example.org/ x',
      ]
    ) {
      expect(
        parseAnswerFeedback({
          ...feedback,
          correct: { ...feedback.correct, link: { url, label: 'link' } },
        }).ok,
      ).toStrictEqual(false);
    }
    expect(parseAnswerFeedback({ correct: null, incorrect: null }).ok).toStrictEqual(false);
    expect(parseAnswerFeedback({ ...feedback, hidden: true }).ok).toStrictEqual(false);
    const source = xml().replace('show-hide="show"', 'show-hide="hide"');
    expect(recognizeEditableChoiceSource(source)._tag).toStrictEqual('SourceOnly');
    expect(() => parseItemXml(source)).toThrowError(Error);
  },
);
testCase(
  'feedback: learner artifact requires explicit release and writes portable session control',
  () => {
    const parts = [{
      id: 'part',
      title: 'Part',
      placements: [{ id: 'placement', itemId: 'question' }],
    }];
    expect(() =>
      requireAssessmentAnswerFeedbackRelease(
        { assessment: { id: 'assessment' }, parts },
        { question: xml() },
      )
    ).toThrowError(Error);
    for (const policy of ['never', 'after-submit'] as const) {
      const configured = [{ ...parts[0], options: { answerFeedbackRelease: policy } }];
      requireAssessmentAnswerFeedbackRelease(
        { assessment: { id: 'assessment' }, parts: configured },
        { question: xml() },
      );
      const test = buildAssessmentTestXml({ id: 'assessment' }, configured);
      expect(test.includes(`show-feedback="${policy === 'never' ? 'false' : 'true'}"`))
        .toStrictEqual(true);
    }
  },
);

testCase('feedback: incomplete autosaved fields remain editable but cannot publish', async () => {
  const { parsePersistedDraft } = await import('../lib/persisted_draft.ts');
  const { prepareDriverDraft } = await import('../lib/qti_build.ts');
  const incomplete: Draft = {
    ...draft,
    answerFeedback: {
      correct: {
        text: '',
        link: { url: 'not a URL yet', label: '' },
        media: {
          kind: 'video',
          src: '',
          mimeType: '',
          title: '',
          captionSrc: '',
          captionLanguage: 'en-US',
          transcript: '',
        },
      },
      incorrect: null,
    },
  };
  const parsed = parsePersistedDraft(incomplete, 'single_select');
  expect(parsed.answerFeedback).toStrictEqual(incomplete.answerFeedback);
  expect(prepareDriverDraft(parsed).ok).toStrictEqual(false);
});

testCase(
  'feedback: dropdown conversion and partial multiple responses retain complete-response conditions',
  async () => {
    const { changeQuestionPresentation } = await import('../lib/question_presentation.ts');
    const converted = changeQuestionPresentation(draft);
    expect(converted.ok).toStrictEqual(true);
    if (converted.ok) {
      const built = buildQtiPreviewXml(converted.draft, { identifier: 'dropdown-feedback' });
      if (!built.ok) throw new Error(JSON.stringify(built));
      expect(parseItemXml(built.xml).draft.answerFeedback).toStrictEqual(feedback);
    }
    const multiple = {
      ...draft,
      type: 'multi_select' as const,
      correctIds: ['A', 'B'],
      choices: [...draft.choices, { id: 'C', text: 'Three' }],
      responseMode: 'partial' as const,
      maximumScore: 2,
    };
    const built = buildQtiPreviewXml(multiple, { identifier: 'multiple-feedback' });
    if (!built.ok) throw new Error(JSON.stringify(built));
    const document = parseQtiXml(built.xml).document!;
    const session = createItemSession(document);
    session.respond('RESPONSE', ['A']);
    session.score();
    expect(
      visibleModalFeedback(document.item, session.serialize().outcomes).map((entry) =>
        entry.identifier
      ),
    ).toStrictEqual(['INCORRECT']);
    session.respond('RESPONSE', ['A', 'B']);
    session.score();
    expect(
      visibleModalFeedback(document.item, session.serialize().outcomes).map((entry) =>
        entry.identifier
      ),
    ).toStrictEqual(['CORRECT']);
    expect(parseItemXml(built.xml).draft.answerFeedback).toStrictEqual(feedback);
  },
);

testCase(
  'feedback: every lossy destination retains useful questions and discloses feedback omission',
  async () => {
    const { convertQti3AssessmentPackage } = await import('../lib/export/assessment.ts');
    const { listSelectableAssessmentExportTargets } = await import(
      '../lib/export/assessment_export_targets.ts'
    );
    const document = {
      assessment: { id: 'assessment' },
      parts: [{
        id: 'part',
        title: 'Part',
        options: { answerFeedbackRelease: 'after-submit' as const },
        placements: [{ id: 'placement', itemId: 'question' }],
      }],
    };
    const source = xml();
    const input = {
      document,
      assessmentXml: buildAssessmentTestXml(document.assessment, document.parts),
      itemsXml: { question: source },
      assets: [],
    };
    for (const target of listSelectableAssessmentExportTargets()) {
      const result = await convertQti3AssessmentPackage(input, target);
      expect(result.ok, target.id).toStrictEqual(true);
      if (!result.ok) throw new Error(target.id);
      expect(result.artifact.length > 0).toStrictEqual(true);
      if (target.compilation._tag === 'CanonicalPackage') {
        expect(result.transcodeEvidence).toStrictEqual(null);
      } else {
        expect(result.transcodeEvidence?.fidelity).toStrictEqual('lossy');
        expect(
          result.transcodeEvidence?.diagnostics.some((entry) =>
            entry.code === 'qflow.export.answer_feedback_omitted'
          ),
        ).toStrictEqual(true);
        expect(result.transcodeEvidence?.reports.length).toStrictEqual(1);
      }
    }
  },
);

testCase(
  'feedback: native import protects an unrepresentable feedback program and exact source XML',
  async () => {
    const { convertQti3AssessmentPackage } = await import('../lib/export/assessment.ts');
    const { resolveAssessmentExportTarget } = await import(
      '../lib/export/assessment_export_targets.ts'
    );
    const { parseQtiPackage } = await import('../lib/import/adapters/qti3/parse_package.ts');
    const document = {
      assessment: { id: 'protected-feedback' },
      parts: [{
        id: 'part',
        title: 'Part',
        options: { answerFeedbackRelease: 'never' as const },
        placements: [{ id: 'placement', itemId: 'question' }],
      }],
    };
    const source = xml().replace('show-hide="show"', 'show-hide="hide"');
    const target = resolveAssessmentExportTarget('qti3-conformant');
    if (!target.ok) throw new Error('Missing native target.');
    const packaged = await convertQti3AssessmentPackage({
      document,
      assessmentXml: buildAssessmentTestXml(document.assessment, document.parts),
      itemsXml: { question: source },
      assets: [],
    }, target.target);
    expect(packaged.ok).toStrictEqual(true);
    if (!packaged.ok) throw new Error('Native source protection failed.');
    const imported = await parseQtiPackage(packaged.artifact);
    expect(imported.items[0].xml).toStrictEqual(source);
    expect(imported.items[0].draft.preserveSourceXml).toStrictEqual(true);
    expect(imported.items[0].draft.answerFeedback).toStrictEqual(undefined);
    expect(recognizeEditableChoiceSource(imported.items[0].xml)._tag).toStrictEqual('SourceOnly');
  },
);
