import { expect, test } from 'vitest';
import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';
import { parsePrintQuestion } from '../lib/print/print_question.ts';
import { parsePrintConfiguration } from '../lib/print/print_contract.ts';

test('paper parses actual authoring output without projecting staff title or feedback', () => {
  const xml = exportQti3TestItemXml('single_select', {
    title: 'STAFF_TITLE_SENTINEL',
    bodyHtml: '<p>Read <strong>all</strong> the choices.</p>',
    promptHtml: 'Choose one.',
    choices: [{ id: 'A', text: 'First answer' }, { id: 'B', text: 'Second answer' }],
    correctId: 'B',
    maximumScore: 3,
  });
  const result = parsePrintQuestion(xml);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.question.scoring).toEqual({ kind: 'match', correct: ['B'], maximum: 3 });
  expect(JSON.stringify(result.question.content)).not.toContain('STAFF_TITLE_SENTINEL');
  expect(JSON.stringify(result.question.content)).toContain('Choose one.');
  expect(result.question.choices).toHaveLength(2);
});

test('paper configuration never invents absent fields or accepts unknown mutations', () => {
  const input = {
    title: 'Exam',
    paper: 'a4',
    locale: 'sv-SE',
    instructions: '',
    responseLines: 9,
    responseOverrides: {},
    order: 'authored',
    approvePresentation: true,
  };
  expect(parsePrintConfiguration(input)?.locale).toBe('sv-SE');
  expect(parsePrintConfiguration({ ...input, order: 'random' })).toBeNull();
  expect(parsePrintConfiguration({ ...input, unknown: true })).toBeNull();
  expect(parsePrintConfiguration({ ...input, responseLines: 0 })).toBeNull();
});

test('unsupported media and custom processing are explicit blockers', () => {
  const xml = exportQti3TestItemXml('multi_select', {
    title: 'Exam',
    bodyHtml: '<p>Choose.</p>',
    choices: [{ id: 'A', text: 'One' }, { id: 'B', text: 'Two' }],
    correctIds: ['A'],
    maximumScore: 2,
  });
  expect(parsePrintQuestion(xml.replace('<p>Choose.</p>', '<video src="x.mp4"/>'))).toEqual({
    ok: false,
    code: 'unsupported_content',
  });
  expect(parsePrintQuestion(xml.replace('<qti-match>', '<qti-or>'))).toEqual({
    ok: false,
    code: 'invalid_xml',
  });
  expect(parsePrintQuestion(xml.replaceAll('qti-match', 'qti-or'))).toEqual({
    ok: false,
    code: 'unsupported_scoring',
  });
});

test('hidden or conditional solutions block before choices/interactions are replaced', () => {
  const xml = exportQti3TestItemXml('single_select', {
    title: 'STAFF_TITLE_SENTINEL',
    bodyHtml: '<p>Read the question.</p>',
    choices: [{ id: 'A', text: 'One' }, { id: 'B', text: 'Two' }],
    correctId: 'A',
    maximumScore: 1,
  });
  for (
    const modified of [
      xml.replace('<p>Read the question.</p>', '<p hidden="hidden">STAFF_HIDDEN_SENTINEL</p>'),
      xml.replace('<qti-simple-choice ', '<qti-simple-choice style="display:none" '),
      xml.replace(
        '<qti-choice-interaction ',
        '<qti-choice-interaction template-identifier="STAFF_CONDITION" ',
      ),
      xml.replace('<qti-simple-choice ', '<qti-simple-choice class="qti-hidden" '),
    ]
  ) expect(parsePrintQuestion(modified)).toEqual({ ok: false, code: 'unsupported_presentation' });
});

test('choice roots preserve their language and reject malformed language metadata', () => {
  const xml = exportQti3TestItemXml('single_select', {
    title: 'STAFF_TITLE',
    bodyHtml: '<p>English prompt.</p>',
    choices: [{ id: 'A', text: 'Español' }, { id: 'B', text: 'Two' }],
    correctId: 'A',
    maximumScore: 1,
  });
  const result = parsePrintQuestion(
    xml.replace('<qti-simple-choice ', '<qti-simple-choice xml:lang="es-ES" '),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(JSON.stringify(result.question.choices[0].content)).toContain('es-ES');
  expect(
    parsePrintQuestion(
      xml.replace('<qti-simple-choice ', '<qti-simple-choice xml:lang="not a language" '),
    ),
  ).toEqual({ ok: false, code: 'language_invalid' });
});

test('manual guidance remains staff-only while candidate rubric language survives', () => {
  const xml = exportQti3TestItemXml('extended_text', {
    title: 'STAFF_TITLE',
    bodyHtml: '<p>Explain the result.</p>',
    promptHtml: 'Write your answer.',
    rubricHtml: '<p>STAFF_RUBRIC_SENTINEL: award up to 5 points for a justified explanation.</p>',
  });
  const result = parsePrintQuestion(
    xml.replace(
      '<qti-extended-text-interaction',
      '<qti-rubric-block view="candidate" xml:lang="sv-SE"><p>Läs noggrant.</p></qti-rubric-block><qti-extended-text-interaction',
    ),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.question.scoring.kind).toBe('manual');
  expect(JSON.stringify(result.question.content)).not.toContain('STAFF_');
  expect(JSON.stringify(result.question.content)).toContain('sv-SE');
  expect(JSON.stringify(result.question.scoring)).toContain('STAFF_RUBRIC_SENTINEL');
  expect(parsePrintQuestion(xml.replaceAll('view="scorer"', 'view="author"'))).toEqual({
    ok: false,
    code: 'marking_guidance_required',
  });
});

test('official mapping preserves bounds, default and selection limits and rejects case-insensitive keys', () => {
  const xml =
    `<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="mapped" title="STAFF_TITLE" xml:lang="en-US">
  <qti-response-declaration identifier="R" cardinality="multiple" base-type="identifier"><qti-correct-response><qti-value>A</qti-value></qti-correct-response><qti-mapping default-value="-1" lower-bound="0" upper-bound="2"><qti-map-entry map-key="A" mapped-value="2"/><qti-map-entry map-key="B" mapped-value="-1"/></qti-mapping></qti-response-declaration>
  <qti-item-body><p>Select up to two.</p><qti-choice-interaction response-identifier="R" min-choices="1" max-choices="2"><qti-simple-choice identifier="A">One</qti-simple-choice><qti-simple-choice identifier="B">Two</qti-simple-choice><qti-simple-choice identifier="C">Three</qti-simple-choice></qti-choice-interaction></qti-item-body>
  <qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/map_response"/></qti-assessment-item>`;
  const result = parsePrintQuestion(xml);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.question.selection).toEqual({ minimum: 1, maximum: 2 });
  expect(result.question.scoring).toEqual({
    kind: 'mapping',
    entries: [{ option: 'A', score: 2 }, { option: 'B', score: -1 }],
    defaultScore: -1,
    lower: 0,
    upper: 2,
  });
  expect(parsePrintQuestion(xml.replace('map-key="A"', 'case-sensitive="false" map-key="A"')))
    .toEqual({ ok: false, code: 'unsupported_scoring' });
  expect(
    parsePrintQuestion(
      xml.replace('cardinality="multiple"', 'cardinality="single"').replace(
        'max-choices="2"',
        'max-choices="1"',
      ).replace('<qti-value>A</qti-value>', '<qti-value>A</qti-value><qti-value>B</qti-value>'),
    ),
  ).toEqual({ ok: false, code: 'unsupported_scoring' });
});

test('deep canonical content and unsupported math presentation return typed blockers', () => {
  const xml = exportQti3TestItemXml('single_select', {
    title: 'Deep',
    bodyHtml: '<p>Replace me.</p>',
    choices: [{ id: 'A', text: 'One' }, { id: 'B', text: 'Two' }],
    correctId: 'A',
    maximumScore: 1,
  });
  expect(
    parsePrintQuestion(
      xml.replace('<p>Replace me.</p>', '<div>'.repeat(6000) + 'Deep' + '</div>'.repeat(6000)),
    ),
  ).toEqual({ ok: false, code: 'content_depth' });
  for (
    const math of [
      '<math><mfrac linethickness="0"><mi>a</mi><mi>b</mi></mfrac></math>',
      '<math><mi mathvariant="bold">a</mi></math>',
      '<math><mo form="prefix">+</mo></math>',
    ]
  ) {
    expect(parsePrintQuestion(xml.replace('<p>Replace me.</p>', math))).toEqual({
      ok: false,
      code: 'unsupported_math',
    });
  }
});
