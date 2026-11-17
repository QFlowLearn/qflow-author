import { expect, test as testCase } from 'vitest';

import { unzipSync } from 'fflate';
import { parseQtiPackage } from '../lib/import/adapters/qti3/parse_package.ts';
import { writeZip } from '../lib/zip.ts';
import { qtiOrganizationPackage } from './helpers/qti_organization_package.ts';

testCase(
  'QTI keywords attach only through item resource identity and exact LOM structure',
  async () => {
    const entries = unzipSync(await qtiOrganizationPackage());
    const encoder = new TextEncoder();
    const metadata = (label: string) =>
      `<metadata><lom:lom><lom:general><lom:keyword><lom:string>${label}</lom:string></lom:keyword></lom:general></lom:lom></metadata>`;
    let manifest = new TextDecoder().decode(entries['imsmanifest.xml']);
    manifest = manifest.replace(
      '<manifest xmlns=',
      '<manifest xmlns:lom="http://ltsc.ieee.org/xsd/LOM" xmlns:foreign="urn:foreign" xmlns=',
    )
      .replace('<resources>', metadata('Package keyword') + '<resources>')
      .replace(
        '<file href="tests/assessment.xml"/>',
        metadata('Test keyword') + '<file href="tests/assessment.xml"/>',
      )
      .replace(
        '<file href="items/cell.xml"/>',
        metadata(' DNA &amp; heredity ').replace(
          '</metadata>',
          '<foreign:lom><foreign:general><foreign:keyword><foreign:string>Wrong namespace</foreign:string></foreign:keyword></foreign:general></foreign:lom><lom:lom><lom:classification><lom:keyword><lom:string>Not a general keyword</lom:string></lom:keyword></lom:classification></lom:lom></metadata>',
        ) + '<file href="items/cell.xml"/>',
      );
    entries['imsmanifest.xml'] = encoder.encode(manifest);
    const result = await parseQtiPackage(
      await writeZip(Object.entries(entries).map(([name, data]) => ({ name, data }))),
    );
    expect(result.items.find((item) => item.href === 'items/cell.xml')?.draft.tags).toStrictEqual([
      'imported',
      'DNA & heredity',
    ]);
    expect(result.items.find((item) => item.href === 'items/energy.xml')?.draft.tags).toStrictEqual(
      [
        'imported',
      ],
    );
  },
);
