import { exportQti3TestItemXml } from '../qti3_writer_test_helpers.ts';
import { writeZip } from '../../lib/zip.ts';

/** Public synthetic chapters nested below one delivery part; references use relative paths. */
export async function qtiOrganizationPackage(
  options: { ambiguous?: boolean; unnamed?: boolean; swapped?: boolean } = {},
) {
  const cells = `<qti-assessment-section identifier="biology" title="Biology" visible="true">
    <qti-assessment-section identifier="cells" title="Cells" visible="true">
      <qti-time-limits max-time="30"/>
      <qti-assessment-section identifier="wrapper" ${
        options.unnamed ? '' : 'title="Practice"'
      } visible="true">
        <qti-assessment-item-ref identifier="cell-ref" href="../items/cell.xml"/>
      </qti-assessment-section>
    </qti-assessment-section>
  </qti-assessment-section>`;
  const energy = `<qti-assessment-section identifier="physics" title="Physics" visible="true">
    <qti-assessment-section identifier="energy" title="Energy" visible="true">
      <qti-assessment-item-ref identifier="energy-ref" href="../items/energy.xml"/>
      ${
        options.ambiguous
          ? '<qti-assessment-item-ref identifier="cell-again" href="../items/cell.xml"/>'
          : ''
      }
    </qti-assessment-section>
  </qti-assessment-section>`;
  const assessment = `<?xml version="1.0"?>
<qti-assessment-test xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="chapters" title="Science chapters">
  <qti-test-part identifier="delivery" navigation-mode="nonlinear" submission-mode="individual">
    <qti-time-limits max-time="900"/>
    ${options.swapped ? energy + cells : cells + energy}
  </qti-test-part>
</qti-assessment-test>`;
  const manifest = `<?xml version="1.0"?>
<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1"><resources>
  <resource identifier="test" type="imsqti_test_xmlv3p0" href="tests/assessment.xml"><file href="tests/assessment.xml"/><dependency identifierref="cell"/><dependency identifierref="energy"/></resource>
  <resource identifier="cell" type="imsqti_item_xmlv3p0" href="items/cell.xml"><file href="items/cell.xml"/></resource>
  <resource identifier="energy" type="imsqti_item_xmlv3p0" href="items/energy.xml"><file href="items/energy.xml"/></resource>
</resources></manifest>`;
  const cell = exportQti3TestItemXml(
    'single_select',
    {
      title: 'Cell nucleus',
      bodyHtml: '',
      promptHtml: '<p>Which structure contains DNA?</p>',
      choices: [{ id: 'a', text: 'Nucleus' }, { id: 'b', text: 'Cell wall' }],
      correctId: 'a',
    },
    { identifier: 'cell' },
  );
  const energyItem = exportQti3TestItemXml(
    'single_select',
    {
      title: 'Energy explanation',
      bodyHtml: '',
      promptHtml: '<p>Which quantity is conserved?</p>',
      choices: [{ id: 'a', text: 'Energy' }, { id: 'b', text: 'Temperature' }],
      correctId: 'a',
    },
    { identifier: 'energy' },
  );
  const encoder = new TextEncoder();
  return await writeZip([
    { name: 'imsmanifest.xml', data: encoder.encode(manifest) },
    { name: 'tests/assessment.xml', data: encoder.encode(assessment) },
    { name: 'items/cell.xml', data: encoder.encode(cell) },
    { name: 'items/energy.xml', data: encoder.encode(energyItem) },
  ]);
}
