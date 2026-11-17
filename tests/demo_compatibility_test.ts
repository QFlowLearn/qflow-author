import { expect, test as testCase } from 'vitest';

import { parseQtiXml } from '@longsightgroup/qti3-core';

import { DEMO_COMPATIBILITY } from '../lib/demo_compatibility.ts';
import {
  createDemoPresidentRevisionContent,
  DEMO_PRESIDENT_PARTS,
  DEMO_PRESIDENT_SOURCES,
  projectDemoCompatibilityFixture,
} from '../lib/demo_presidents_catalog.ts';
import { parseValidPersistedDraft } from '../lib/persisted_draft.ts';

testCase('demo catalog has unique stable keys and known parts', () => {
  const stableKeys = DEMO_PRESIDENT_SOURCES.map((source) => source.stableKey);
  expect(new Set(stableKeys).size).toStrictEqual(stableKeys.length);

  const partKeys = new Set(DEMO_PRESIDENT_PARTS.map((part) => part.key));
  expect(DEMO_PRESIDENT_SOURCES.every((source) => partKeys.has(source.partKey))).toStrictEqual(
    true,
  );
});

testCase('generated demo compatibility matches every canonical demo question', async () => {
  expect(await projectDemoCompatibilityFixture()).toStrictEqual(DEMO_COMPATIBILITY);
});

testCase('every demo question exports parseable QTI 3 item XML', () => {
  for (const source of DEMO_PRESIDENT_SOURCES) {
    const content = createDemoPresidentRevisionContent(source);
    const parsed = parseQtiXml(content.qtiXml);
    expect(parsed.ok, `${source.stableKey}: ${JSON.stringify(parsed.diagnostics)}`).toStrictEqual(
      true,
    );
    expect(parsed.document?.item !== undefined, source.stableKey).toStrictEqual(true);
  }
});

testCase('every demo question crosses the production persistence boundary', () => {
  const parsedQuestions = DEMO_PRESIDENT_SOURCES.map((source) => {
    const content = createDemoPresidentRevisionContent(source);
    const draft = parseValidPersistedDraft(content.body);
    return {
      stableKey: source.stableKey,
      title: draft.title,
      type: draft.type,
    };
  });

  expect(parsedQuestions).toStrictEqual(DEMO_PRESIDENT_SOURCES.map((source) => ({
    stableKey: source.stableKey,
    title: source.draft.title,
    type: source.type,
  })));
});
