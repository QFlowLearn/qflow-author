import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { parseItemXml } from '../lib/import/adapters/qti3/parse_item.ts';
import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { type PortableCustomDraft } from '../lib/types/portable_custom.ts';
import { draftOfType } from './import_draft.ts';
import { readQtiFixture } from './qti_fixture_loader.ts';

const FIXTURE = 'fractions_deps.xml';

testCase('portable_custom import: fixture → draft contains module config', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  const draft = draftOfType<PortableCustomDraft>(parsed, 'portable_custom');
  expect(draft.portableBaseType).toStrictEqual('identifier');
  expect(draft.portableCardinality).toStrictEqual('single');
  const modules = draft.portableInteractionModules ?? [];
  if (!(modules.length >= 1)) expect.unreachable('Expected modules.length >= 1');
  const dataAttrs = draft.portableDataAttributes ?? [];
  if (!(dataAttrs.length >= 1)) expect.unreachable('Expected dataAttrs.length >= 1');
});

testCase(
  'portable_custom import round-trip: fixture → draft → qti3 export → re-import',
  async () => {
    const xml = await readQtiFixture(FIXTURE);

    const parsed = parseItemXml(xml);
    const draft = draftOfType<PortableCustomDraft>(parsed, 'portable_custom');
    const rebuilt = exportQti3TestItemXml('portable_custom', {
      title: draft.title,
      promptHtml: draft.promptHtml,
      bodyHtml: draft.bodyHtml,
      responseIdentifier: draft.responseIdentifier,
      portableCustomTypeIdentifier: draft.portableCustomTypeIdentifier,
      portableModule: draft.portableModule,
      portableClassName: draft.portableClassName,
      portableLabel: draft.portableLabel,
      portableBaseType: draft.portableBaseType,
      portableCardinality: draft.portableCardinality,
      portableInteractionMarkup: draft.portableInteractionMarkup,
      portableDataAttributes: draft.portableDataAttributes ?? [],
      portableInteractionModules: draft.portableInteractionModules ?? [],
      portableModulesPrimaryConfiguration: draft.portableModulesPrimaryConfiguration,
      portableModulesSecondaryConfiguration: draft.portableModulesSecondaryConfiguration,
      portableResponseProcessingXml: draft.portableResponseProcessingXml,
    }, { identifier: 'item-pci-roundtrip' });

    if (!(rebuilt.includes('qti-portable-custom-interaction'))) {
      expect.unreachable("Expected rebuilt.includes('qti-portable-custom-interaction')");
    }
    await assertQtiXmlWellFormed(rebuilt);

    const reparsed = parseItemXml(rebuilt);
    const reModules =
      draftOfType<PortableCustomDraft>(reparsed, 'portable_custom').portableInteractionModules ??
        [];
    if (!(reModules.length >= 1)) expect.unreachable('Expected reModules.length >= 1');
  },
);
