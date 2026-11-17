import { expect, test as testCase } from 'vitest';

import { parseItemLanguage } from '../lib/types/item_language.ts';

const IMPORTED_LANGUAGE = parseItemLanguage('fr-CA');

import { db, shutdownDb } from '../lib/db.ts';
import {
  commitImportResultInTransaction,
  ImportQuestionPreparationInvalidatedError,
  prepareImportQuestionRevisions,
} from '../lib/import/commit_import_result.ts';
import {
  acceptedMigrationQuestionSnapshotHash,
  createAcceptedMigrationQuestionSnapshot,
  type MigrationItemContent,
  migrationItemContentHash,
  type MigrationItemContext,
  migrationItemContextHash,
  type ReviewedMigrationQuestionSnapshot,
} from '../lib/import/migration_item_content.ts';
import type { ImportResult } from '../lib/import/types.ts';
import type { RequestContext } from '../lib/tenants.ts';
import { testAssessmentBlueprint } from './assessment_blueprint_fixture.ts';
import { questionXmlFixture } from './question_xml_fixture.ts';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HREF = 'questions/one.xml';
const REVIEWED_AT = '2026-08-16T08:00:00.000Z';

testCase(
  'conversion commit rejects revisions prepared from an earlier accepted snapshot',
  async () => {
    const initialSnapshot = await reviewedQuestionSnapshot();
    const prepared = await prepareImportQuestionRevisions(
      { itemsByHref: new Map([[HREF, initialSnapshot]]) },
      new Map(),
    );
    const currentSnapshot: ReviewedMigrationQuestionSnapshot = {
      ...initialSnapshot,
      acceptedSnapshotHash: 'c'.repeat(64),
    };
    const parsed = importResult();
    const ctx: RequestContext = {
      tenantId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      role: 'owner',
    };

    try {
      const error = await (async () => {
        const caught: unknown = await Promise.resolve().then(() =>
          db.transaction((tx) =>
            commitImportResultInTransaction(
              tx,
              ctx,
              parsed,
              'source.xml',
              new Map(),
              { itemsByHref: new Map([[HREF, currentSnapshot]]) },
              prepared,
              {
                _tag: 'Assessment',
                blueprint: testAssessmentBlueprint([
                  { id: 'choice-target', questionType: 'single_select', count: 1 },
                ]),
              },
            )
          )
        ).then(() => expect.unreachable('Expected a rejection.'), (cause: unknown) => cause);
        if (!(caught instanceof ImportQuestionPreparationInvalidatedError)) {
          expect.unreachable('Expected ImportQuestionPreparationInvalidatedError');
        }
        return caught;
      })();

      expect(error.href).toStrictEqual(HREF);
      expect(error.message).toStrictEqual(
        'The migration changed while its question revisions were being prepared.',
      );
    } finally {
      await shutdownDb();
    }
  },
);

async function reviewedQuestionSnapshot(): Promise<ReviewedMigrationQuestionSnapshot> {
  const actor = {
    id: 'reviewer-1',
    displayName: 'Reviewer',
    email: 'reviewer@example.test',
  };
  const content: MigrationItemContent = {
    sourceName: 'source.xml',
    title: 'Question',
    itemType: 'single_select',
    sourceHref: HREF,
    sourceIdentifier: 'one',
    sourceXml: questionXmlFixture('one'),
    importedDraft: importedDraft(),
    blueprintTargetId: 'choice-target',
    reviewSuggestions: [],
    warnings: [],
    assets: [],
  };
  const context: MigrationItemContext = {
    readiness: 'ready',
    sourceArtifact: {
      id: 'artifact-1',
      filename: 'source.xml',
      mimeType: 'application/xml',
      size: 100,
      sha256: HASH_A,
    },
    normalizedSourceSha256: HASH_B,
    evidence: [],
    extractionUncertainties: [],
    review: {
      decision: 'accepted',
      note: null,
      reviewedBy: actor.id,
      reviewedAt: REVIEWED_AT,
    },
  };
  const contentHash = await migrationItemContentHash(content);
  const contextHash = await migrationItemContextHash(context);
  const acceptedSnapshot = createAcceptedMigrationQuestionSnapshot({
    contentHash,
    contextHash,
    origin: {
      _tag: 'Imported',
      artifact: context.sourceArtifact,
      migrationRunId: 'run-1',
      migrationItemId: 'item-1',
      href: HREF,
      identifier: 'one',
      providedBy: actor,
      assistance: {
        _tag: 'DeterministicImport',
        adapter: { id: 'qti21', label: 'QTI 2.1', version: '1' },
      },
      evidence: [],
      review: {
        decision: 'accepted',
        reviewer: actor,
        reviewedAt: REVIEWED_AT,
        note: null,
        contentHash,
        contextHash,
      },
    },
  });

  return {
    migrationRunId: 'run-1',
    migrationItemId: 'item-1',
    content,
    context,
    acceptedSnapshot,
    acceptedSnapshotHash: await acceptedMigrationQuestionSnapshotHash(acceptedSnapshot),
  };
}

function importedDraft() {
  return {
    type: 'single_select' as const,
    itemLanguage: IMPORTED_LANGUAGE,
    title: 'Question',
    choices: [
      { id: 'A', text: 'Answer' },
      { id: 'B', text: 'Distractor' },
    ],
    correctId: 'A',
  };
}

function importResult(): ImportResult {
  const draft = importedDraft();
  return {
    title: 'Import',
    organizationGroups: [],
    parts: [],
    items: [{
      href: HREF,
      identifier: 'one',
      title: 'Question',
      xml: questionXmlFixture('one'),
      draft,
    }],
    assets: [],
  };
}
