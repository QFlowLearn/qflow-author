import { expect, test } from 'vitest';
import { imsccAdapter } from '../lib/import/adapters/imscc.ts';
import { canvasChoiceXml } from './helpers/canvas_import.ts';
import { canvasCartridge } from './helpers/canvas_cartridge.ts';
import { analyzeImport } from './helpers/lms_import.ts';
const unsupported =
  '<item ident="SHORT" title="Short answer"><itemmetadata><qtimetadata><qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>short_answer_question</fieldentry></qtimetadatafield></qtimetadata></itemmetadata><presentation><material><mattext>Give an answer.</mattext></material><response_str ident="response1"><render_fib/></response_str></presentation><resprocessing><outcomes><decvar varname="SCORE" maxvalue="100"/></outcomes><respcondition><conditionvar><varequal respident="response1">Paris</varequal></conditionvar><setvar varname="SCORE">100</setvar></respcondition></resprocessing></item>';
test('one unsupported Canvas item retains usable siblings and keeps errors on its blocked record', async () => {
  const nativeXml = canvasChoiceXml().replace('</section>', `${unsupported}</section>`);
  const source = {
    filename: 'mixed.imscc',
    bytes: await canvasCartridge({
      ccXml: '<questestinterop/>',
      nativeXml,
      extraResources:
        '<resource identifier="SECOND" type="imsqti_xmlv1p2/imscc_xmlv1p1/assessment"><file href="SECOND.xml"/></resource>',
      extraFiles: [{
        name: 'SECOND.xml',
        data: new TextEncoder().encode(canvasChoiceXml().replaceAll('CHOICE', 'SECOND')),
      }],
    }),
  };
  const imported = await imsccAdapter.parse(source);
  expect(imported.items.map((item) => item.identifier)).toEqual(['CHOICE', 'SHORT', 'SECOND']);
  const analysis = await analyzeImport(imsccAdapter, imported, source);
  expect(analysis.items.map((item) => item.readiness)).toEqual(['ready', 'blocked', 'ready']);
  expect(analysis.items[1].warnings.map((warning) => warning.code)).toContain(
    'QTI12_RESPONSE_PROCESSING_UNSUPPORTED',
  );
});
test('partial resource review still blocks invalid media on the affected item', async () => {
  const nativeXml = canvasChoiceXml().replace(
    'Which city is in France?',
    '<![CDATA[Prompt <img src="missing.png"/>]]>',
  );
  const source = {
    filename: 'media.imscc',
    bytes: await canvasCartridge({ ccXml: '<questestinterop/>', nativeXml }),
  };
  const imported = await imsccAdapter.parse(source);
  expect((await analyzeImport(imsccAdapter, imported, source)).items[0].readiness).toBe('blocked');
  expect(imported.warnings?.map((warning) => warning.code)).toContain('QTI_RESOURCE_ASSET_REVIEW');
});
