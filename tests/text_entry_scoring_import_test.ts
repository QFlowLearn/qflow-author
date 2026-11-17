import { expect, test as testCase } from 'vitest';

import { scoreQtiItemServerSide } from '@longsightgroup/qti3-core';
import { parseItemXml } from '../lib/import/adapters/qti3/parse_item.ts';
import { buildQtiPreviewXml } from '../lib/qti_preview.ts';
import { readQtiFixture } from './qti_fixture_loader.ts';
import { parseQtiPackage } from '../lib/import/adapters/qti3/parse_package.ts';
import { writeZip } from '../lib/zip.ts';

async function nativeTextEntryXml(): Promise<string> {
  const weighted = await readQtiFixture('choice-points/single.xml');
  return weighted.replace('base-type="identifier"', 'base-type="string"').replace(
    /<qti-choice-interaction[\s\S]*?<\/qti-choice-interaction>/,
    '<qti-text-entry-interaction response-identifier="RESPONSE" expected-length="10"/>',
  );
}

testCase(
  'native text-entry points remain exact in editable answers and generated Preview',
  async () => {
    const native = await nativeTextEntryXml();
    for (const score of [0, 3, 3.125]) {
      const xml = native.replaceAll('>3<', `>${score}<`).replace(
        'normal-maximum="3"',
        `normal-maximum="${score}"`,
      );
      const parsed = parseItemXml(xml);
      expect(parsed.draft.textEntries?.[0].answers[0].score).toStrictEqual(score);
      const preview = buildQtiPreviewXml(parsed.draft);
      if (!(preview.ok)) expect.unreachable('Expected preview.ok');
      for (const response of ['A', 'B', 'a', '', null]) {
        const original = scoreQtiItemServerSide({
          itemXml: xml,
          trustedResponses: { RESPONSE: response },
        });
        const generated = scoreQtiItemServerSide({
          itemXml: preview.xml,
          trustedResponses: { RESPONSE: response },
        });
        if (!(original.ok && generated.ok)) {
          expect.unreachable('Expected original.ok && generated.ok');
        }
        expect(generated.score).toStrictEqual(original.score);
      }
    }
  },
);

testCase(
  'match-correct ignores unused mapping weights and retains exact case matching',
  async () => {
    const xml = (await nativeTextEntryXml()).replace(
      '</qti-response-declaration>',
      '<qti-mapping default-value="2"><qti-map-entry map-key="B" mapped-value="9" case-sensitive="false"/></qti-mapping></qti-response-declaration>',
    );
    const parsed = parseItemXml(xml);
    expect(
      parsed.draft.textEntries?.[0].answers.map((answer) => ({
        value: answer.value,
        score: answer.score,
        caseSensitive: answer.caseSensitive,
      })),
    ).toStrictEqual([{ value: 'A', score: 3, caseSensitive: true }]);
  },
);

testCase('numeric match values and the standard one-point template remain executable', async () => {
  const native = await nativeTextEntryXml();
  const template = native.replace(
    /<qti-response-processing>[\s\S]*?<\/qti-response-processing>/,
    '<qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct"/>',
  );
  for (
    const xml of [
      template,
      native.replace('base-type="string"', 'base-type="integer"').replace('>A<', '>42<'),
      native.replace('base-type="string"', 'base-type="float"').replace('>A<', '>42.125<'),
    ]
  ) {
    const draft = parseItemXml(xml).draft;
    const preview = buildQtiPreviewXml(draft);
    if (!(preview.ok)) expect.unreachable('Expected preview.ok');
    expect(draft.textEntries?.[0].answers[0].score).toStrictEqual(xml === template ? 1 : 3);
    for (const response of ['A', 'a', 42, 42.125, 0, null]) {
      const original = scoreQtiItemServerSide({
        itemXml: xml,
        trustedResponses: { RESPONSE: response },
      });
      const generated = scoreQtiItemServerSide({
        itemXml: preview.xml,
        trustedResponses: { RESPONSE: response },
      });
      if (!(original.ok && generated.ok)) {
        expect.unreachable('Expected original.ok && generated.ok');
      }
      expect(generated.score).toStrictEqual(original.score);
    }
  }
});

testCase(
  'unrepresentable matching programs retain original XML as explicit package review items',
  async () => {
    const native = await nativeTextEntryXml();
    const encoder = new TextEncoder();
    const unsupported = [
      native.replace('>0<', '>2<'),
      native.replaceAll('>3<', '>-3<'),
      native.replace(
        '<qti-value>A</qti-value>',
        '<qti-value>A</qti-value><qti-value>B</qti-value>',
      ),
      native.replace(
        '<qti-outcome-declaration identifier="SCORE"',
        '<qti-response-declaration identifier="OTHER" cardinality="single" base-type="string"><qti-correct-response><qti-value>A</qti-value></qti-correct-response></qti-response-declaration><qti-outcome-declaration identifier="SCORE"',
      ).replace('identifier="RESPONSE"/>', 'identifier="OTHER"/>'),
      native.replace(
        '</qti-response-if>',
        '<qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">9</qti-base-value></qti-set-outcome-value></qti-response-if>',
      ),
    ];
    for (const xml of unsupported) {
      expect(() => parseItemXml(xml)).toThrowError(
        expect.toSatisfy((caught: unknown) =>
          caught instanceof Error &&
          caught.message.includes('Text-entry scoring cannot be preserved for editing')
        ),
      );
      const bytes = await writeZip([
        {
          name: 'imsmanifest.xml',
          data: encoder.encode(
            '<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1"><resources><resource identifier="source" type="imsqti_item_xmlv3p0" href="source.xml"><file href="source.xml"/></resource></resources></manifest>',
          ),
        },
        { name: 'source.xml', data: encoder.encode(xml) },
      ]);
      const packaged = await parseQtiPackage(bytes);
      expect(packaged.items.length).toStrictEqual(1);
      expect(packaged.items[0].xml).toStrictEqual(xml);
      expect(packaged.items[0].draft.preserveSourceXml).toStrictEqual(true);
      if (!(packaged.warnings)) expect.unreachable('Expected packaged.warnings');
      if (
        !(packaged.warnings.some((warning) =>
          warning.code === 'UNSUPPORTED_ITEM_STUBBED' &&
          warning.message.includes('Review the source scoring') &&
          warning.detail?.includes('Text-entry scoring cannot be preserved')
        ))
      ) {
        expect.unreachable(
          "Expected packaged.warnings.some((warning) => warning.code === 'UNSUPPORTED_ITEM_STUBBED' && warning",
        );
      }
    }
  },
);
