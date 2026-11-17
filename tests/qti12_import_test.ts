import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';

import { determineItemReadiness } from '../lib/import/migration_analysis.ts';
import type { ImportResult } from '../lib/import/types.ts';
import { qti12Adapter } from '../lib/import/adapters/qti12.ts';

testCase('QTI 1.2 import: Canvas partial-credit scoring requires manual review', async () => {
  const bytes = await _fs.readFile(
    new URL('fixtures/import/canvas/canvas_matching_question.xml', import.meta.url),
  );
  const result = await qti12Adapter.parse({
    filename: 'canvas_matching_question.xml',
    bytes,
    mime: 'application/xml',
  });

  expect(result.items.length).toStrictEqual(1);
  assertUnsupportedScoring(result);
});

testCase('QTI 1.2 import: Sakai feedback labels do not invent correct answers', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop>
  <assessment title="Sakai Sample">
    <section>
      <item ident="ITEM_1" title="Multiple Choice">
        <presentation>
          <flow class="Block">
            <material><mattext>Pick the correct letter.</mattext></material>
            <response_lid ident="MCSC" rcardinality="Single">
              <render_choice shuffle="No">
                <response_label ident="A"><material><mattext>A</mattext></material></response_label>
                <response_label ident="B"><material><mattext>B</mattext></material></response_label>
                <response_label ident="C"><material><mattext>C</mattext></material></response_label>
              </render_choice>
            </response_lid>
          </flow>
        </presentation>
        <resprocessing>
          <outcomes>
            <decvar varname="SCORE" defaultval="0" minvalue="0.0" maxvalue="1.0" />
          </outcomes>
          <respcondition continue="No">
            <conditionvar><varequal respident="MCSC">A</varequal></conditionvar>
            <setvar action="Add" varname="SCORE">0.0</setvar>
            <displayfeedback feedbacktype="Response" linkrefid="InCorrect" />
          </respcondition>
          <respcondition continue="No">
            <conditionvar><varequal respident="MCSC">B</varequal></conditionvar>
            <setvar action="Add" varname="SCORE">0.0</setvar>
            <displayfeedback feedbacktype="Response" linkrefid="Correct" />
          </respcondition>
          <respcondition continue="No">
            <conditionvar><varequal respident="MCSC">C</varequal></conditionvar>
            <setvar action="Add" varname="SCORE">0.0</setvar>
            <displayfeedback feedbacktype="Response" linkrefid="InCorrect" />
          </respcondition>
        </resprocessing>
      </item>
    </section>
  </assessment>
</questestinterop>`;

  const result = await qti12Adapter.parse({
    filename: 'sakai_qti12.xml',
    bytes: new TextEncoder().encode(xml),
    mime: 'application/xml',
  });

  expect(result.items.length).toStrictEqual(1);
  assertUnsupportedScoring(result);
});

testCase('QTI 1.2 import: Sakai additive matching scoring requires manual review', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop>
  <assessment title="Sakai Matching">
    <section>
      <item ident="MATCH_1" title="Matching">
        <itemmetadata>
          <qtimetadata>
            <qtimetadatafield>
              <fieldlabel>qmd_itemtype</fieldlabel>
              <fieldentry>Matching</fieldentry>
            </qtimetadatafield>
          </qtimetadata>
        </itemmetadata>
        <presentation>
          <flow class="Block">
            <material><mattext>Match each term to its definition.</mattext></material>
            <response_grp ident="resp_grp" rcardinality="Ordered">
              <render_choice shuffle="No">
                <response_label ident="MT-A"><material><mattext>Definition A</mattext></material></response_label>
                <response_label ident="MT-B"><material><mattext>Definition B</mattext></material></response_label>
                <response_label ident="MS-1" match_max="1"><material><mattext>Term 1</mattext></material></response_label>
                <response_label ident="MS-2" match_max="1"><material><mattext>Term 2</mattext></material></response_label>
              </render_choice>
            </response_grp>
          </flow>
        </presentation>
        <resprocessing>
          <outcomes><decvar varname="SCORE" defaultval="0" minvalue="0.0" maxvalue="2.0" /></outcomes>
          <respcondition><conditionvar><varequal respident="MT-A">MS-1</varequal></conditionvar><setvar action="Add" varname="SCORE">1</setvar></respcondition>
          <respcondition><conditionvar><varequal respident="MT-B">MS-2</varequal></conditionvar><setvar action="Add" varname="SCORE">1</setvar></respcondition>
          <respcondition><conditionvar><varequal respident="MT-A">MS-2</varequal></conditionvar><setvar action="Add" varname="SCORE">0</setvar></respcondition>
          <respcondition><conditionvar><varequal respident="MT-B">MS-1</varequal></conditionvar><setvar action="Add" varname="SCORE">0</setvar></respcondition>
        </resprocessing>
      </item>
    </section>
  </assessment>
</questestinterop>`;

  const result = await qti12Adapter.parse({
    filename: 'sakai_matching_group.xml',
    bytes: new TextEncoder().encode(xml),
    mime: 'application/xml',
  });

  expect(result.items.length).toStrictEqual(1);
  assertUnsupportedScoring(result);
});

testCase('QTI 1.2 import: Sakai audio recording maps to upload draft', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop>
  <assessment title="Sakai Audio">
    <section>
      <item ident="AUDIO_1" title="Audio Recording">
        <itemmetadata>
          <qtimetadata>
            <qtimetadatafield>
              <fieldlabel>qmd_itemtype</fieldlabel>
              <fieldentry>Audio Recording</fieldentry>
            </qtimetadatafield>
          </qtimetadata>
        </itemmetadata>
        <presentation>
          <flow class="Block">
            <material><mattext>&lt;p&gt;Student audio recording&lt;/p&gt;</mattext></material>
            <material><mat_extension>jsp/aam/applet/soundRecorder_captured.jsp</mat_extension></material>
            <response_str ident="audio" rcardinality="Single" />
          </flow>
        </presentation>
        <resprocessing>
          <outcomes><decvar varname="SCORE" defaultval="0" minvalue="0.0" maxvalue="10.0" /></outcomes>
        </resprocessing>
      </item>
    </section>
  </assessment>
</questestinterop>`;

  const result = await qti12Adapter.parse({
    filename: 'sakai_audio.xml',
    bytes: new TextEncoder().encode(xml),
    mime: 'application/xml',
  });

  expect(result.items.length).toStrictEqual(1);
  expect(result.items[0].draft.type).toStrictEqual('extended_text');
  expect(result.warnings?.some((w) => w.code === 'UNSUPPORTED_ITEM_STUBBED') ?? false)
    .toStrictEqual(true);

  const draft = result.items[0].draft as unknown as {
    responseIdentifier?: string;
    bodyHtml?: string;
  };
  expect(draft.responseIdentifier).toStrictEqual('RESPONSE');
  expect(draft.bodyHtml ?? '').toContain('manual migration review');
});

testCase('QTI 1.2 import: ILIAS unsupported scoring does not guess correct answers', async () => {
  const bytes = await _fs.readFile(
    new URL('fixtures/import/ilias/QuestionPool_test.txt.ilias.xml', import.meta.url),
  );
  const result = await qti12Adapter.parse({
    filename: 'QuestionPool_test.txt.ilias.xml',
    bytes,
    mime: 'application/xml',
  });

  expect(result.items.length).toStrictEqual(9);
  for (const item of result.items) {
    expect(item.draft.type).toStrictEqual('extended_text');
    expect(item.xml).toContain('manual migration review');
    expect(item.xml.includes('<qti-correct-response>')).toStrictEqual(false);
  }
  expect(result.warnings?.some((w) => w.code === 'QTI12_COMPOSITE_RESPONSES_UNSUPPORTED'))
    .toStrictEqual(true);
  expect(result.warnings?.some((w) => w.code === 'QTI12_MATERIAL_NOT_PRESERVED')).toStrictEqual(
    true,
  );
  assertUnsupportedScoring(result);
});

testCase('QTI 1.2 import: BOM-prefixed XML is parsed successfully', async () => {
  const base = await _fs.readFile(
    new URL('fixtures/import/canvas/canvas_matching_question.xml', import.meta.url),
    'utf8',
  );
  const result = await qti12Adapter.parse({
    filename: 'canvas_matching_bom.xml',
    bytes: new TextEncoder().encode(`\uFEFF${base}`),
    mime: 'application/xml',
  });

  expect(result.items.length).toStrictEqual(1);
  assertUnsupportedScoring(result);
});

testCase(
  'QTI 1.2 import: leading whitespace before XML declaration is parsed successfully',
  async () => {
    const base = await _fs.readFile(
      new URL('fixtures/import/canvas/canvas_matching_question.xml', import.meta.url),
      'utf8',
    );
    const result = await qti12Adapter.parse({
      filename: 'canvas_matching_leading_whitespace.xml',
      bytes: new TextEncoder().encode(`\n\n  ${base}`),
      mime: 'application/xml',
    });

    expect(result.items.length).toStrictEqual(1);
    assertUnsupportedScoring(result);
  },
);

testCase(
  'QTI 1.2 import: Blackboard unsupported score expression does not guess a choice',
  async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop>
  <assessment title="Blackboard Generic Respident">
    <section>
      <item ident="ITEM_1" title="Multiple Choice">
        <presentation>
          <flow class="Block">
            <material><mattext>Choose one.</mattext></material>
            <response_lid ident="RESPONSE_I0_R0" rcardinality="Single">
              <render_choice shuffle="No">
                <response_label ident="I0_C0"><material><mattext>A</mattext></material></response_label>
                <response_label ident="I0_C1"><material><mattext>B</mattext></material></response_label>
                <response_label ident="I0_C2"><material><mattext>C</mattext></material></response_label>
              </render_choice>
            </response_lid>
          </flow>
        </presentation>
        <resprocessing>
          <outcomes><decvar varname="SCORE" defaultval="0" minvalue="0" maxvalue="1" /></outcomes>
          <respcondition title="correct">
            <conditionvar>
              <varequal respident="response">I0_C2</varequal>
            </conditionvar>
            <setvar variablename="SCORE" action="Set">SCORE.max</setvar>
            <displayfeedback linkrefid="correct" feedbacktype="Response" />
          </respcondition>
        </resprocessing>
      </item>
    </section>
  </assessment>
</questestinterop>`;

    const result = await qti12Adapter.parse({
      filename: 'blackboard_generic_respident.xml',
      bytes: new TextEncoder().encode(xml),
      mime: 'application/xml',
    });

    expect(result.items.length).toStrictEqual(1);
    assertUnsupportedScoring(result);
  },
);

function assertUnsupportedScoring(result: ImportResult): void {
  if (!(result.warnings)) expect.unreachable('Expected result.warnings');
  expect(result.items[0].draft.type).toStrictEqual('extended_text');
  expect(result.items[0].xml).toContain('manual migration review');
  expect(result.items[0].xml.includes('<qti-correct-response>')).toStrictEqual(false);
  expect(result.warnings.some((w) => w.code === 'QTI12_RESPONSE_PROCESSING_UNSUPPORTED'))
    .toStrictEqual(true);
  expect(result.warnings.some((w) => w.code === 'UNSUPPORTED_ITEM_STUBBED')).toStrictEqual(true);
  expect(result.warnings.some((w) => w.code === 'UNREGISTERED_IMPORT_DIAGNOSTIC')).toStrictEqual(
    false,
  );
  expect(determineItemReadiness(result.warnings)).toStrictEqual('blocked');
}
