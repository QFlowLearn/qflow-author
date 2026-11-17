import { expect, test as testCase } from 'vitest';

import {
  type AssessmentExportDocument,
  buildQti3AssessmentPackageEntries,
  buildValidatedQti3Assessment,
} from '../lib/export/assessment.ts';
import {
  listSelectableAssessmentExportTargets,
  resolveAssessmentExportTarget,
} from '../lib/export/assessment_export_targets.ts';

testCase('assessment export registry binds LMS destinations to exact profiles', () => {
  const targets = listSelectableAssessmentExportTargets();
  expect(targets.find((target) => target.id === 'canvas-classic')?.compilation).toStrictEqual({
    _tag: 'ProfileArchive',
    profileId: 'canvas-classic-quizzes@1',
  });
  expect(targets.find((target) => target.id === 'moodle')?.compilation).toStrictEqual({
    _tag: 'ProfileFile',
    profileId: 'moodle-xml@1',
    path: 'moodle_questions.xml',
  });
  expect(targets.find((target) => target.id === 'canvas-new-quizzes')?.compilation).toStrictEqual({
    _tag: 'ProfileArchive',
    profileId: 'canvas-new-quizzes@1',
  });
  expect(targets.find((target) => target.id === 'blackboard-question-banks')?.compilation)
    .toStrictEqual({
      _tag: 'ProfileArchive',
      profileId: 'blackboard-question-banks@1',
    });
  expect(targets.find((target) => target.id === 'brightspace-course-import')?.compilation)
    .toStrictEqual({
      _tag: 'ProfileArchive',
      profileId: 'brightspace-course-import@1',
    });
  expect(targets.find((target) => target.id === 'qti3-conformant')?.compilation).toStrictEqual({
    _tag: 'CanonicalPackage',
  });
  expect(targets.find((target) => target.id === 'canvas-classic')?.targetContractId).toStrictEqual(
    'canvas-classic-quizzes@1',
  );
  expect(targets.find((target) => target.id === 'moodle')?.targetContractId).toStrictEqual(
    'moodle-xml@1',
  );
  expect(targets.find((target) => target.id === 'canvas-classic')?.directPublish).toStrictEqual({
    provider: 'canvas',
  });
  expect(targets.find((target) => target.id === 'canvas-new-quizzes')?.directPublish).toStrictEqual(
    { provider: 'canvas' },
  );
  expect(targets.find((target) => target.id === 'moodle')?.directPublish).toStrictEqual(null);
});

testCase('published LMS profiles resolve through their exact contracts', () => {
  for (
    const targetId of [
      'canvas-new-quizzes',
      'blackboard-question-banks',
      'brightspace-course-import',
    ] as const
  ) {
    const resolved = resolveAssessmentExportTarget(targetId);
    expect(resolved.ok).toStrictEqual(true);
    if (!resolved.ok) throw new Error(`${targetId} did not resolve.`);
    expect(resolved.target.id).toStrictEqual(targetId);
    expect(resolved.target.targetContractId).toStrictEqual(`${targetId}@1`);
  }
});

testCase('assessment export registry rejects missing, unknown, and former format aliases', () => {
  for (const requestedTargetId of [null, 'imscc', 'qti3', 'qti21', 'qti12']) {
    expect(resolveAssessmentExportTarget(requestedTargetId)).toStrictEqual({
      ok: false,
      error: {
        _tag: 'DestinationNotRegistered',
        requestedTargetId,
      },
    });
  }
});

testCase('assessment export builds one canonical QTI 3 source package', async () => {
  const document: AssessmentExportDocument = {
    assessment: { id: 'assessment-1', title: 'Compatibility Sample' },
    parts: [{
      id: 'part-1',
      title: 'Part 1',
      options: { navigationMode: 'linear' },
      placements: [{ id: 'placement-1', itemId: 'item-1' }],
    }],
  };
  const built = await buildValidatedQti3Assessment(document);
  const entries = buildQti3AssessmentPackageEntries({
    document,
    assessmentXml: built.xml,
    itemsXml: { 'item-1': '<qti-assessment-item/>' },
    assets: [{ id: 'asset-1', name: 'image.png', data: new Uint8Array([1]) }],
    assetIdsByItem: { 'item-1': ['asset-1'] },
  });

  expect(built.validation.ok).toStrictEqual(true);
  expect(entries.map((entry) => entry.name)).toStrictEqual([
    'imsmanifest.xml',
    'assessment.xml',
    'items/item-1.xml',
    'assets/image.png',
  ]);
  const manifest = new TextDecoder().decode(entries[0].data);
  expect(manifest).toContain('assessment.xml');
  expect(manifest).toContain('dependency identifierref="item-1"');
  expect(manifest).toContain('dependency identifierref="asset-1"');
});
