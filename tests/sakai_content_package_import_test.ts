import { expect, test } from 'vitest';
import { qti12Adapter } from '../lib/import/adapters/qti12.ts';
import { buildMigrationAnalysis } from '../lib/import/migration_analysis.ts';
import { inspectSource } from '../lib/source_intake/registry.ts';
import { writeZip } from '../lib/zip.ts';

const manifest = `<manifest identifier="SAKAI"><organizations/><resources>
  <resource identifier="RESOURCE1" type="imsqti_xmlv1p1" href="exportAssessment.xml">
    <file href="exportAssessment.xml"/><file href="image.png"/>
  </resource>
</resources></manifest>`;
const assessment = `<questestinterop><assessment ident="A"><section ident="S">
  <item ident="ESSAY" title="Explain the result"><presentation>
    <material><mattext>Explain why the result changes.</mattext></material>
    <response_str ident="RESPONSE"><render_fib rows="6"/></response_str>
  </presentation></item>
</section></assessment></questestinterop>`;

test('Sakai content packaging resolves and migrates the declared assessment and assets', async () => {
  const image = new Uint8Array([137, 80, 78, 71]);
  const source = {
    filename: 'sakai-export.zip',
    mime: 'application/zip',
    bytes: await writeZip([
      { name: 'imsmanifest.xml', data: new TextEncoder().encode(manifest) },
      { name: 'exportAssessment.xml', data: new TextEncoder().encode(assessment) },
      { name: 'image.png', data: image },
    ]),
  };
  const inspection = await inspectSource('recover_existing', { _tag: 'file', source });
  expect(inspection._tag).toBe('resolved');
  if (inspection._tag !== 'resolved') expect.unreachable('Expected a supported Sakai package');
  expect(inspection.candidate.adapter.id).toBe('qti12');
  const sniff = await qti12Adapter.sniff(source);
  const parsed = await qti12Adapter.parse(source);
  expect(parsed.items).toHaveLength(1);
  expect(parsed.items[0].title).toBe('Explain the result');
  expect(parsed.items[0].draft).toMatchObject({
    type: 'extended_text',
    bodyHtml: '<p>Explain why the result changes.</p>',
  });
  expect(parsed.assets.find((asset) => asset.path === 'image.png')?.data).toEqual(image);
  const analysis = buildMigrationAnalysis(parsed, { adapter: qti12Adapter, sniff }, {
    _tag: 'Assessment',
  });
  expect(analysis.items[0].readiness).toBe('ready');
  expect(analysis.summary.globalWarnings?.map((warning) => warning.code)).toContain(
    'QTI_ASSESSMENT_STRUCTURE_FLATTENED',
  );
  expect(parsed.warnings).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'QTI_ASSESSMENT_STRUCTURE_FLATTENED' }),
  ]));
});

test('Sakai resource labels do not authorize unrelated XML or a missing assessment', async () => {
  for (const content of ['<quiz/>', '<assessmentItem/>', null]) {
    const source = {
      filename: 'not-a-sakai-assessment.zip',
      bytes: await writeZip([
        { name: 'imsmanifest.xml', data: new TextEncoder().encode(manifest) },
        ...(content === null
          ? []
          : [{ name: 'exportAssessment.xml', data: new TextEncoder().encode(content) }]),
      ]),
    };
    expect((await qti12Adapter.sniff(source)).supported).toBe(false);
  }
});
