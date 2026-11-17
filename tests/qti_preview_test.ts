import { expect, test as testCase } from 'vitest';

import { parseQtiXml } from '@longsightgroup/qti3-core';
import { buildQtiPreviewXml } from '../lib/qti_preview.ts';
import { type QuestionTypeId, TYPE_DRIVERS } from '../lib/types/registry.ts';
import { prepareDriverDraftForBuild } from '../lib/types/buildable_driver_draft.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';

testCase('buildQtiPreviewXml builds qti3-parseable XML for driver defaults', () => {
  for (const [id, driver] of Object.entries(TYPE_DRIVERS)) {
    const typeId = id as QuestionTypeId;
    const result = buildQtiPreviewXml(
      prepareDriverDraftForBuild(typeId, {
        ...driver.defaults(),
        itemLanguage: newAuthoringItemLanguage(),
      }),
      { identifier: `preview-${typeId}` },
    );

    if (!(result.ok)) {
      expect.unreachable(
        `${id}: ${result.ok ? '' : result.issues.map((i) => i.message).join('; ')}`,
      );
    }
    const parsed = parseQtiXml(result.xml);
    if (!(parsed.document)) {
      expect.unreachable(`${id}: preview XML did not parse into a QTI document`);
    }
  }
});

testCase('buildQtiPreviewXml returns issues for invalid drafts', () => {
  const result = buildQtiPreviewXml({
    type: 'single_select',
    itemLanguage: newAuthoringItemLanguage(),
    title: '',
    choices: [],
    correctId: '',
  });

  expect(result.ok).toStrictEqual(false);
  if (!result.ok) {
    if (!(result.issues.length > 0)) expect.unreachable('Expected result.issues.length > 0');
  }
});

testCase('type drivers no longer expose preview renderers', () => {
  for (const driver of Object.values(TYPE_DRIVERS)) {
    expect('preview' in driver).toStrictEqual(false);
  }
});
