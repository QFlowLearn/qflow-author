import { test as testCase } from 'vitest';
import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { exportQti3AssessmentItemXml } from '../lib/types/qti3_authoring.ts';
import { normalizeDraftForDriver } from '../lib/types/draft_utils.ts';
import { QUESTION_TYPE_IDS, TYPE_DRIVERS } from '../lib/types/registry.ts';
import { prepareDriverDraftForBuild } from '../lib/types/buildable_driver_draft.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';

testCase(
  'driver matrix exports well-formed QTI XML for defaults and serialized drafts',
  async () => {
    for (const typeId of QUESTION_TYPE_IDS) {
      const driver = TYPE_DRIVERS[typeId];
      const defaults = { ...driver.defaults(), itemLanguage: newAuthoringItemLanguage() };
      const serialized = driver.serialize(normalizeDraftForDriver(typeId, defaults));
      for (
        const [stage, draft] of [
          ['defaults', defaults],
          ['serialized', normalizeDraftForDriver(typeId, serialized)],
        ] as const
      ) {
        const xml = exportQti3AssessmentItemXml(
          typeId,
          prepareDriverDraftForBuild(typeId, draft),
          { identifier: `item-${typeId}` },
        );
        await assertQtiXmlWellFormed(xml, `${typeId}: ${stage}`);
      }
    }
  },
);
