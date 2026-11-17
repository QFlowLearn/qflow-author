import { expect, test as testCase } from 'vitest';

import { scoreQtiItemServerSide } from '@longsightgroup/qti3-core';
import { parseItemXml } from '../lib/import/adapters/qti3/parse_item.ts';
import { parseQtiPackageEntries } from '../lib/import/adapters/qti3/parse_package.ts';
import { buildQtiPreviewXml } from '../lib/qti_preview.ts';
import { prepareQuestionXmlDownload } from '../lib/export/question_xml_download.ts';
import { parsePersistedDraft } from '../lib/persisted_draft.ts';
import { projectJsonPersistenceObject } from '../lib/canonical_json.ts';
import { determineItemReadiness } from '../lib/import/migration_analysis.ts';
import { parseMigrationWarningCode } from '../lib/import/migration_warning_catalog.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { createInlineChoiceMarkerHtml } from '../lib/types/inline_choice.ts';
import type { Draft } from '../lib/types/draft.ts';
import { readQtiFixture } from './qti_fixture_loader.ts';

type Responses = Record<string, string | string[] | null>;

function grade(xml: string, responses: Responses): number | null {
  const scored = scoreQtiItemServerSide({ itemXml: xml, trustedResponses: responses });
  if (!(scored.ok)) expect.unreachable(JSON.stringify(scored.diagnostics));
  return scored.score;
}

function verifyImport(xml: string, maximum: number, rows: Array<[Responses, number]>) {
  const parsed = parseItemXml(xml);
  expect(parsed.draft.maximumScore).toStrictEqual(maximum);
  const reopened = parsePersistedDraft(
    projectJsonPersistenceObject(parsed.draft),
    parsed.draft.type,
  );
  const preview = buildQtiPreviewXml(reopened);
  if (!(preview.ok)) expect.unreachable(JSON.stringify(preview));
  const exported = prepareQuestionXmlDownload(reopened, 'weighted-roundtrip');
  if (!(exported.ok)) expect.unreachable(JSON.stringify(exported));
  const reimported = buildQtiPreviewXml(parseItemXml(exported.xml).draft);
  if (!(reimported.ok)) expect.unreachable('Expected reimported.ok');
  const artifacts: readonly string[] = [xml, preview.xml, exported.xml, reimported.xml];
  for (const [responses, expected] of rows) {
    for (const artifact of artifacts) {
      expect(grade(artifact, responses)).toStrictEqual(expected);
    }
  }
}

testCase(
  'independent weighted fixtures retain 3, 2.5 and zero through import, persistence, preview and re-import',
  async () => {
    for (
      const [name, maximum, rows] of [
        ['single', 3, [[{ RESPONSE: 'A' }, 3], [{ RESPONSE: 'B' }, 0], [{ RESPONSE: null }, 0]]],
        ['multiple', 2.5, [
          [{ RESPONSE: ['A', 'B'] }, 2.5],
          [{ RESPONSE: ['A'] }, 1.25],
          [{ RESPONSE: ['A', 'C'] }, 1.25],
          [{ RESPONSE: ['A', 'B', 'C'] }, 2.5],
          [{ RESPONSE: ['C'] }, 0],
          [{ RESPONSE: [] }, 0],
        ]],
        ['practice', 0, [[{ RESPONSE: 'A' }, 0], [{ RESPONSE: 'B' }, 0]]],
      ] satisfies Array<[string, number, Array<[Responses, number]>]>
    ) {
      verifyImport(await readQtiFixture(`choice-points/${name}.xml`), maximum, rows);
    }
  },
);

testCase(
  'canonical weighted choice and one or two dropdown slots retain literal matching and partial grades',
  () => {
    for (const [maximum, half] of [[0, 0], [3, 1.5], [3.125, 1.5625]] as const) {
      const single: Draft = {
        type: 'single_select',
        itemLanguage: newAuthoringItemLanguage(),
        title: 'Weighted',
        bodyHtml: '<p>Choose Alpha.</p>',
        choices: [{ id: 'A', text: 'Alpha' }, { id: 'B', text: 'Beta' }, {
          id: 'C',
          text: 'Gamma',
        }],
        correctId: 'A',
        responseIdentifier: 'ANSWER',
        maximumScore: maximum,
      };
      if (!(single.choices)) expect.unreachable('Expected single.choices');
      const slot = { id: 'ANSWER', label: 'Answer', correctId: 'A', options: single.choices };
      const second = { ...slot, id: 'SECOND' };
      const dropdown: Draft = {
        ...single,
        type: 'inline_choice',
        inlineChoices: [slot],
        bodyHtml: `<p>${createInlineChoiceMarkerHtml(slot)}</p>`,
        responseMode: 'all_or_nothing',
      };
      const multiple: Draft = {
        ...single,
        type: 'multi_select',
        correctIds: ['A', 'B'],
        maxChoices: 3,
      };
      for (
        const [draft, rows] of [
          [single, [[{ ANSWER: 'A' }, maximum], [{ ANSWER: 'C' }, 0], [{ ANSWER: null }, 0]]],
          [{ ...multiple, responseMode: 'all_or_nothing' }, [[{ ANSWER: ['A', 'B'] }, maximum], [{
            ANSWER: ['A'],
          }, 0]]],
          [{ ...multiple, responseMode: 'partial' }, [[{ ANSWER: ['A'] }, half], [{
            ANSWER: ['A', 'C'],
          }, half], [{ ANSWER: ['A', 'B', 'C'] }, maximum]]],
          [dropdown, [[{ ANSWER: 'A' }, maximum], [{ ANSWER: 'B' }, 0]]],
          [{
            ...dropdown,
            inlineChoices: [slot, second],
            bodyHtml: `<p>${createInlineChoiceMarkerHtml(slot)} ${
              createInlineChoiceMarkerHtml(second)
            }</p>`,
          }, [[{ ANSWER: 'A', SECOND: 'A' }, maximum], [{ ANSWER: 'A', SECOND: 'B' }, 0]]],
        ] satisfies Array<[Draft, Array<[Responses, number]>]>
      ) {
        const source = buildQtiPreviewXml(draft);
        if (!(source.ok)) expect.unreachable(JSON.stringify(source));
        verifyImport(source.xml, maximum, rows);
      }
    }
  },
);

testCase(
  'maximum metadata cannot authorize replacing altered scoring, mappings, defaults or extensions',
  async () => {
    const single = await readQtiFixture('choice-points/single.xml');
    const multi = await readQtiFixture('choice-points/multiple.xml');
    const changed = [
      single.replace(
        'base-type="float">3</qti-base-value>',
        'base-type="float">6</qti-base-value>',
      ),
      single.replace('normal-maximum="3"', 'normal-maximum="99"'),
      single.replace('<qti-value>3</qti-value>', '<qti-value>-1</qti-value>'),
      single.replace('<qti-value>3</qti-value>', '<qti-value>NaN</qti-value>'),
      single.replace('<qti-value>3</qti-value>', '<qti-value>INF</qti-value>'),
      single.replace('<qti-value>3</qti-value>', '<qti-value></qti-value>'),
      single.replace('time-dependent="false"', 'adaptive="true" time-dependent="false"'),
      single.replace(
        '<qti-item-body>',
        '<qti-outcome-declaration identifier="EXTRA" cardinality="single" base-type="float"/><qti-item-body>',
      ),
      single.replace(
        '<qti-item-body>',
        '<qti-outcome-declaration identifier="MAXSCORE" cardinality="single" base-type="float"><qti-default-value><qti-value>3</qti-value></qti-default-value></qti-outcome-declaration><qti-item-body>',
      ),
      single.replace(
        '<qti-response-processing>',
        '<qti-template-processing/><qti-response-processing>',
      ),
      single.replace(
        /\s*<qti-outcome-declaration identifier="MAXSCORE"[\s\S]*?<\/qti-outcome-declaration>/,
        '',
      ),
      single.replace(
        '<qti-response-processing>',
        '<qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct.xml">',
      ),
      single.replace(
        '<qti-response-processing>',
        '<qti-response-processing><extension xmlns="urn:custom">Retain me</extension>',
      ),
      single.replace(
        '<qti-response-declaration identifier="RESPONSE"',
        '<qti-response-declaration custom="retain" identifier="RESPONSE"',
      ),
      single.replace(
        'identifier="MAXSCORE" cardinality="single"',
        'identifier="MAXSCORE" cardinality="multiple"',
      ),
      multi.replace('map-key="C" mapped-value="0"', 'map-key="C" mapped-value="-1"'),
      multi.replace('<qti-mapping default-value="0">', '<qti-mapping default-value="1">'),
    ];
    for (const xml of changed) {
      expect(() => parseItemXml(xml)).toThrowError(
        expect.toSatisfy((caught: unknown) =>
          caught instanceof Error && caught.message.includes('points')
        ),
      );
    }
  },
);

testCase(
  'point recognition accepts equivalent namespace prefixes and outcome declaration order',
  async () => {
    const original = await readQtiFixture('choice-points/single.xml');
    const prefixed = original
      .replace(
        'xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"',
        'xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" xmlns:q="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"',
      )
      .replace(/(<\/?)(qti-[a-z-]+)(?=[\s>])/g, '$1q:$2');
    const reordered = original.replace(
      /(<qti-outcome-declaration identifier="SCORE"[^>]*\/>)(\s*)(<qti-outcome-declaration identifier="MAXSCORE"[\s\S]*?<\/qti-outcome-declaration>)/,
      '$3$2$1',
    );
    for (const xml of [prefixed, reordered]) {
      if (!(xml !== original)) expect.unreachable('Expected xml !== original');
      verifyImport(xml, 3, [[{ RESPONSE: 'A' }, 3], [{ RESPONSE: 'B' }, 0]]);
    }
  },
);

testCase('unmarked custom point programs cannot become editable one-point questions', async () => {
  const marked = await readQtiFixture('choice-points/single.xml');
  const unmarked = marked.replace(' normal-maximum="3"', '').replace(
    /\s*<qti-outcome-declaration identifier="MAXSCORE"[\s\S]*?<\/qti-outcome-declaration>/,
    '',
  );
  expect(grade(unmarked, { RESPONSE: 'A' })).toStrictEqual(3);
  expect(() => parseItemXml(unmarked)).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('points')
    ),
  );
});

testCase(
  'a mixed package keeps useful weighted questions and exact refused source with blocking scoring review',
  async () => {
    const good = await readQtiFixture('choice-points/single.xml');
    const bad = good.replace('identifier="single" title=', 'identifier="custom" title=').replace(
      'base-type="float">3</qti-base-value>',
      'base-type="float">6</qti-base-value>',
    );
    const result = await parseQtiPackageEntries([
      {
        path: 'imsmanifest.xml',
        data:
          '<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1"><resources><resource identifier="single" type="imsqti_item_xmlv3p0" href="good.xml"><file href="good.xml"/></resource><resource identifier="custom" type="imsqti_item_xmlv3p0" href="bad.xml"><file href="bad.xml"/></resource></resources></manifest>',
      },
      { path: 'good.xml', data: good },
      { path: 'bad.xml', data: bad },
    ]);
    expect(result.items.length).toStrictEqual(2);
    const supported = result.items.find((item) => item.href === 'good.xml');
    const preserved = result.items.find((item) => item.href === 'bad.xml');
    if (!(supported && preserved)) expect.unreachable('Expected supported && preserved');
    expect(supported.draft.maximumScore).toStrictEqual(3);
    expect(preserved.xml).toStrictEqual(bad);
    expect(preserved.draft.preserveSourceXml).toStrictEqual(true);
    const warnings = preserved.draft.importWarnings ?? [];
    expect(warnings[0].code).toStrictEqual('QTI3_CHOICE_POINTS_NOT_PRESERVED');
    expect(determineItemReadiness(warnings.map((warning) => ({
      ...warning,
      code: parseMigrationWarningCode(warning.code),
    })))).toStrictEqual('blocked');
  },
);
