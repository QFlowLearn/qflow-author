import { expect, test as testCase } from 'vitest';

import {
  adaptivePoolCounts,
  adaptiveSettingsDocument,
  parseAdaptivePlan,
  parseAdaptivePlanCommand,
  parseAdaptiveSettings,
} from '../lib/assessment_adaptive_plan.ts';

testCase('adaptive settings require three ordered levels in one current category version', () => {
  const settings = {
    selection: `scheme=${crypto.randomUUID()}`,
    versionId: crypto.randomUUID(),
    levelIds: ['easy', 'moderate', 'hard'],
    questionCount: 100,
  };
  const parsed = parseAdaptiveSettings(settings);
  if (!parsed) expect.unreachable('Expected parsed');
  expect(adaptivePoolCounts(100)).toStrictEqual([100, 95, 90]);
  expect(adaptivePoolCounts(15)).toStrictEqual([15, 10, 5]);
  expect(parseAdaptiveSettings(adaptiveSettingsDocument(parsed))).toStrictEqual(parsed);
  for (
    const bad of [
      { ...settings, questionCount: 10 },
      { ...settings, questionCount: 101 },
      { ...settings, questionCount: 17 },
      { ...settings, levelIds: ['easy', 'easy', 'hard'] },
      { ...settings, levelIds: ['easy', 'hard'] },
      { ...settings, selection: `${settings.selection}&subject=${crypto.randomUUID()}:cells` },
      { ...settings, selection: `${settings.selection}&difficulty=${settings.versionId}:easy` },
      { ...settings, extra: true },
    ]
  ) expect(parseAdaptiveSettings(bad)).toStrictEqual(null);
  if (
    !(parseAdaptivePlanCommand({
      kind: 'build',
      settings,
      buildId: crypto.randomUUID(),
      expectedRevision: 0,
    }))
  ) {
    expect.unreachable(
      "Expected parseAdaptivePlanCommand({ kind: 'build', settings, buildId: crypto.randomUUID(), expected",
    );
  }
});

testCase('persisted adaptive plans require every reachable block and distinct placements', () => {
  const blocks = [];
  for (let group = 0; group < 3; group++) {
    for (let level = 0; level <= Math.min(group, 2); level++) {
      blocks.push({
        group,
        level,
        placementIds: Array.from({ length: 5 }, () => crypto.randomUUID()),
      });
    }
  }
  const document = {
    revision: 1,
    buildId: crypto.randomUUID(),
    requestDigest: 'a'.repeat(64),
    partId: crypto.randomUUID(),
    settings: {
      selection: `scheme=${crypto.randomUUID()}`,
      versionId: crypto.randomUUID(),
      levelIds: ['easy', 'moderate', 'hard'],
      questionCount: 15,
    },
    audience: 'Grade 6 science',
    levels: [{ id: 'easy', label: 'Easy' }, { id: 'moderate', label: 'Moderate' }, {
      id: 'hard',
      label: 'Hard',
    }],
    blocks,
  };
  if (!(parseAdaptivePlan(document))) expect.unreachable('Expected parseAdaptivePlan(document)');
  expect(parseAdaptivePlan({ ...document, blocks: blocks.slice(1) })).toStrictEqual(null);
  const repeated = structuredClone(document);
  repeated.blocks[1].placementIds[0] = repeated.blocks[0].placementIds[0];
  expect(parseAdaptivePlan(repeated)).toStrictEqual(null);
});
