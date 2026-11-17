import { expect, test as testCase } from 'vitest';

import {
  openVerifiedImportedQuestionRevision,
  type VerifiedImportedQuestionRevision,
} from '../lib/import/imported_question_revision.ts';
import {
  type MigrationItemContent,
  migrationItemContentHash,
  type MigrationItemContext,
  migrationItemContextHash,
} from '../lib/import/migration_item_content.ts';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

const content: MigrationItemContent = {
  sourceName: 'source.docx',
  title: 'Reviewed question',
  itemType: 'single_select',
  sourceHref: 'items/question-1.xml',
  sourceIdentifier: 'question-1',
  sourceXml: '<qti-assessment-item/>',
  importedDraft: {
    type: 'single_select',
    title: 'Reviewed question',
    bodyHtml: '<p>Choose one.</p>',
    choices: [{ id: 'A', text: 'Correct' }, { id: 'B', text: 'Incorrect' }],
    correctId: 'A',
  },
  blueprintTargetId: 'choice-target',
  reviewSuggestions: [],
  warnings: [{ code: 'SOURCE_TRUNCATED', message: 'Review the source excerpt.' }],
  assets: [{
    sourcePath: 'media/chart.png',
    name: 'chart.png',
    mimeType: 'image/png',
    size: 42,
    sha256: HASH_A,
  }],
};

const context: MigrationItemContext = {
  readiness: 'major_review',
  sourceArtifact: {
    id: 'artifact-1',
    filename: 'source.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: 1000,
    sha256: HASH_B,
  },
  normalizedSourceSha256: HASH_C,
  evidence: [{
    kind: 'page',
    artifactId: 'normalized-1',
    artifactHash: HASH_C,
    page: 2,
    quote: 'The reviewed answer appears here.',
  }],
  extractionUncertainties: [{
    code: 'STRUCTURE_INFERRED',
    message: 'A heading was inferred.',
    page: 2,
  }],
  review: {
    decision: 'accepted',
    note: 'Checked against page 2.',
    reviewedBy: 'reviewer-1',
    reviewedAt: '2026-07-30T12:00:00.000Z',
  },
};

testCase('review hashes bind every imported output and review-context field', async () => {
  const contentHash = await migrationItemContentHash(content);
  for (
    const changed of [
      { ...content, sourceName: 'renamed.docx' },
      { ...content, title: 'Changed title' },
      { ...content, itemType: 'multi_select' },
      { ...content, sourceXml: '<qti-assessment-item identifier="changed"/>' },
      { ...content, importedDraft: { ...content.importedDraft as object, correctId: 'B' } },
      {
        ...content,
        warnings: [...content.warnings, { code: 'IMPORT_FAILED', message: 'Changed' }],
      },
      { ...content, assets: [{ ...content.assets[0], sha256: HASH_B }] },
    ]
  ) {
    expect(await migrationItemContentHash(changed)).not.toStrictEqual(contentHash);
  }

  const contextHash = await migrationItemContextHash(context);
  for (
    const changed of [
      { ...context, readiness: 'blocked' as const },
      { ...context, sourceArtifact: { ...context.sourceArtifact, sha256: HASH_A } },
      { ...context, normalizedSourceSha256: HASH_A },
      { ...context, evidence: [] },
      { ...context, extractionUncertainties: [] },
      { ...context, review: { ...context.review, note: 'Changed after review.' } },
    ]
  ) {
    expect(await migrationItemContextHash(changed)).not.toStrictEqual(contextHash);
  }
});

testCase('verified import capability rejects a forged structural value at runtime', () => {
  const forged = {
    input: {},
    provenance: {},
  } as unknown as VerifiedImportedQuestionRevision;
  expect(() => openVerifiedImportedQuestionRevision(forged)).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('not produced by the review verifier')
    ),
  );
});

testCase('review hashing rejects duplicate canonical asset source paths', async () => {
  await expect(
    Promise.resolve().then(() =>
      migrationItemContentHash({
        ...content,
        assets: [
          content.assets[0],
          { ...content.assets[0], sourcePath: './MEDIA/chart.png' },
        ],
      })
    ),
  ).rejects.toSatisfy((caught: unknown) =>
    caught instanceof Error && caught.message.includes('unique canonical source paths')
  );
});
