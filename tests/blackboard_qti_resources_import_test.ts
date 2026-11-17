import { expect, test } from 'vitest';
import { blackboardAdapter } from '../lib/import/adapters/blackboard.ts';
import { writeZip } from '../lib/zip.ts';
import { canvasChoiceXml } from './helpers/canvas_import.ts';
import { analyzeImport } from './helpers/lms_import.ts';
test('independent Blackboard QTI resources retain unique identities and build a consistent review', async () => {
  const encode = (value: string) => new TextEncoder().encode(value);
  const resources = ['one', 'two'];
  const source = {
    filename: 'blackboard.zip',
    bytes: await writeZip([
      {
        name: 'imsmanifest.xml',
        data: encode(
          `<manifest><resources>${
            resources.map((id) =>
              `<resource identifier="${id}" type="assessment/x-bb-qti-pool" file="${id}.dat"/>`
            ).join('')
          }</resources></manifest>`,
        ),
      },
      ...resources.map((id) => ({ name: `${id}.dat`, data: encode(canvasChoiceXml()) })),
    ]),
  };
  const imported = await blackboardAdapter.parse(source);
  expect(imported.items).toHaveLength(2);
  expect(new Set(imported.items.map((item) => item.identifier)).size).toBe(2);
  expect(new Set(imported.organizationGroups.map((group) => group.id)).size).toBe(2);
  expect(new Set(imported.parts.map((part) => part.id)).size).toBe(2);
  expect(
    (await analyzeImport(blackboardAdapter, imported, source)).items.map((item) => item.readiness),
  ).toEqual(['ready', 'ready']);
  for (const item of imported.items) expect(item.xml).toContain(`identifier="${item.identifier}"`);
});
