import { writeZip } from '../../lib/zip.ts';
import { exportQti3TestItemXml } from '../qti3_writer_test_helpers.ts';

/** Repeats cross the 100-item checkpoint; key, passage, media and missing-key cases differ. */
export async function migrationRepeatPackage() {
  const encoder = new TextEncoder();
  const entries = Array.from({ length: 131 }, (_, i) => {
    const content = i < 100 ? i : i < 121 ? i - 100 : 0;
    let xml = exportQti3TestItemXml('single_select', {
      title: `Question title ${i + 1}`,
      bodyHtml: i === 128
        ? '<p>Passage: there are 6 cells.</p>'
        : '<p>Passage: there are 5 cells.</p>',
      promptHtml: `<p>Question ${content}: how many cells?</p>`,
      choices: [{ id: 'A', text: '5' }, { id: 'B', text: '6' }],
      correctId: i === 127 ? 'B' : 'A',
    }, { identifier: `item-${i + 1}` });
    if (i === 129) {
      xml = xml.replace(
        '<qti-item-body>',
        '<qti-item-body><img src="https://example.com/cells.png" alt="Cells"/>',
      );
    }
    if (i === 130) xml = xml.replace(/<qti-correct-response>[\s\S]*?<\/qti-correct-response>/, '');
    return { name: `items/item-${i + 1}.xml`, data: encoder.encode(xml) };
  });
  const manifest =
    `<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1"><resources>${
      entries.map((e, i) =>
        `<resource identifier="item-${
          i + 1
        }" type="imsqti_item_xmlv3p0" href="${e.name}"><file href="${e.name}"/></resource>`
      ).join('')
    }</resources></manifest>`;
  return await writeZip([{ name: 'imsmanifest.xml', data: encoder.encode(manifest) }, ...entries]);
}
