import { expect, test as testCase } from 'vitest';

import { compileSakaiPool } from '../lib/export/releases/sakai_pool.ts';
import {
  findAllDescendantsByLocalName as descendants,
  parseXmlStrict,
} from '../lib/import/xml_dom.ts';
import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

function question(n: number, corrected = false) {
  return {
    revisionId: `proof-${n}${corrected ? '-b' : ''}`,
    xml: exportQti3TestItemXml(
      'single_select',
      {
        title: `Proof ${n}`,
        promptHtml: '',
        bodyHtml: `<p>Question ${n}: Which number is two plus two?</p>`,
        choices: [
          { id: 'first', text: 'Three' },
          { id: 'second', text: 'Four' },
          { id: 'third', text: 'Five' },
        ],
        correctId: corrected ? 'third' : 'second',
        shuffle: false,
      },
      { identifier: `proof-${n}` },
    ),
  };
}

testCase(
  'Sakai pools reconcile 100 ordered revisions and retain A after one answer correction',
  async () => {
    const items = Array.from({ length: 100 }, (_, index) => question(index + 1));
    const a = await compileSakaiPool({ id: 'edition-a', label: 'Edition A', items });
    const b = await compileSakaiPool({
      id: 'edition-b',
      label: 'Edition B',
      items: [question(1, true), ...items.slice(1)],
    });
    if (!(a.ok && b.ok)) expect.unreachable('Expected a.ok && b.ok');
    const aDoc = parseXmlStrict(a.xml, 'edition A');
    const bDoc = parseXmlStrict(b.xml, 'edition B');
    expect(descendants(aDoc.documentElement, 'item').map((item) => item.getAttribute('ident')))
      .toStrictEqual(items.map((item) => item.revisionId));
    expect(descendants(aDoc.documentElement, 'varequal').map((item) => item.textContent))
      .toStrictEqual(Array(100).fill('B'));
    expect(descendants(bDoc.documentElement, 'varequal').map((item) => item.textContent))
      .toStrictEqual([
        'C',
        ...Array(99).fill('B'),
      ]);
    expect(descendants(aDoc.documentElement, 'decvar').map((item) => item.getAttribute('maxvalue')))
      .toStrictEqual(Array(100).fill('1'));
    expect(descendants(aDoc.documentElement, 'fieldentry').map((item) => item.textContent))
      .toStrictEqual(Array(100).fill('Multiple Choice'));
    expect(
      descendants(aDoc.documentElement, 'displayfeedback').map((item) =>
        item.getAttribute('linkrefid')
      ),
    ).toStrictEqual(Array(100).fill('Correct'));
    expect(a.xml).not.toStrictEqual(b.xml);
    expect(await compileSakaiPool({ id: 'edition-a', label: 'Edition A', items })).toStrictEqual(a);
  },
);

testCase('Sakai exports supported revisions and identifies every excluded question', async () => {
  const valid = question(1);
  const mutations = [
    valid.xml.replace('max-choices="1"', 'max-choices="2"'),
    valid.xml.replace('/match_correct', '/map_response'),
    valid.xml.replace('<qti-correct-response>', '<qti-mapping/><qti-correct-response>'),
    valid.xml.replace('cardinality="single"', 'cardinality="multiple"'),
    valid.xml.replace(
      'base-type="float"/>',
      'base-type="float"><qti-default-value><qti-value>5</qti-value></qti-default-value></qti-outcome-declaration>',
    ),
    valid.xml.replace('<p>', '<p><img src="../assets/figure.png"/>'),
    valid.xml.replace('<p>', '<p><img src="https://example.org/figure.png"/>'),
    valid.xml.replace('<qti-item-body>', '<qti-item-body><qti-object data="passage.xml"/>'),
    '<broken>',
  ];
  const result = await compileSakaiPool({
    id: 'mixed',
    label: 'Mixed',
    items: [valid, ...mutations.map((xml, index) => ({ revisionId: `blocked-${index}`, xml }))],
  });
  if (!(result.ok)) expect.unreachable('Expected result.ok');
  expect(result.includedRevisionIds).toStrictEqual([valid.revisionId]);
  expect(descendants(parseXmlStrict(result.xml, 'partial pool').documentElement, 'item').length)
    .toStrictEqual(1);
  expect(result.excluded.map((item) => item.revisionId)).toStrictEqual(
    mutations.map((_, index) => `blocked-${index}`),
  );
  const empty = await compileSakaiPool({
    id: 'empty',
    label: 'No supported questions',
    items: mutations.map((xml, index) => ({ revisionId: `excluded-${index}`, xml })),
  });
  if (empty.ok) expect.unreachable('Expected !empty.ok');
  expect(empty.blocked.length).toStrictEqual(mutations.length);
  if ('xml' in empty) expect.unreachable("Expected !('xml' in empty)");
  expect(
    (await compileSakaiPool({ id: 'duplicate', label: 'Duplicate', items: [valid, valid] })).ok,
  ).toStrictEqual(false);
});

testCase('Sakai text remains literal after XML and HTML decoding', async () => {
  const item = question(1);
  const xml = item.xml.replace('Which number is two plus two?', 'Is 2 &lt; 3 &amp; 4 &gt; 3?')
    .replace('Three', '&lt;strong&gt;Three&lt;/strong&gt;');
  const result = await compileSakaiPool({
    id: 'literal',
    label: 'Literal text',
    items: [{ ...item, xml }],
  });
  if (!(result.ok)) expect.unreachable('Expected result.ok');
  const doc = parseXmlStrict(result.xml, 'literal output');
  const material = descendants(doc.documentElement, 'mattext');
  expect(material[0].textContent).toStrictEqual('Question 1: Is 2 &lt; 3 &amp; 4 &gt; 3?');
  expect(material[1].textContent).toStrictEqual('&lt;strong&gt;Three&lt;/strong&gt;');
  expect(material.map((node) => node.getAttribute('texttype'))).toStrictEqual(
    Array(4).fill('text/html'),
  );
});

testCase(
  'Sakai adapts formatting and shuffling while retaining language, keys and original XML',
  async () => {
    const original = question(1);
    const xml = original.xml.replace('shuffle="false"', 'shuffle="true"')
      .replace('xml:lang="en-US"', 'xml:lang="fr"')
      .replace('Which number is two plus two?', '<strong>Combien font deux plus deux ?</strong>')
      .replace('Three', '<em>Trois</em>').replace('Four', 'Quatre');
    const source = { ...original, xml };
    const result = await compileSakaiPool({ id: 'adapted', label: 'Adapted', items: [source] });
    if (!(result.ok)) expect.unreachable('Expected result.ok');
    expect(source.xml).toStrictEqual(xml);
    expect(result.excluded).toStrictEqual([]);
    expect(result.diagnostics.filter((d) => d.severity === 'warning').map((d) => d.code).sort())
      .toStrictEqual(['sakai.fixed_choice_order', 'sakai.presentation_simplified']);
    const doc = parseXmlStrict(result.xml, 'adapted pool');
    const item = descendants(doc.documentElement, 'item')[0];
    expect(item.getAttribute('xml:lang')).toStrictEqual('fr');
    expect(descendants(item, 'varequal')[0].textContent).toStrictEqual('B');
    expect(descendants(item, 'mattext').map((node) => node.textContent)).toStrictEqual([
      'Question 1: Combien font deux plus deux ?',
      'Trois',
      'Quatre',
      'Five',
    ]);
    expect(descendants(item, 'decvar')[0].getAttribute('maxvalue')).toStrictEqual('1');
  },
);
