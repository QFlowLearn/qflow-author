import { expect, test as testCase } from 'vitest';

import { saveQuestionRevisionFixture } from './question_revision_fixture.ts';
import { withEnrichmentWorkspace } from './helpers/enrichment_workspace.ts';
import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { eq } from 'drizzle-orm';
import { db } from '../lib/db.ts';
import { questionRevisions, questions } from '../lib/db/question_schema.ts';
import { loadAssessmentItemExports } from '../lib/export/assessment_loader.ts';
import {
  buildQti3AssessmentPackageEntries,
  buildValidatedQti3Assessment,
} from '../lib/export/assessment.ts';
import { getMigrationRun } from '../lib/import/migration_run_queries.ts';
import { parseQtiPackage } from '../lib/import/adapters/qti3/parse_package.ts';
import { parseQuestionTags } from '../lib/question_tags.ts';
import { writeZip } from '../lib/zip.ts';
import { withImportedOrganizationQuestions } from './helpers/imported_organization_questions.ts';
import { withOrganizationWorkspace } from './helpers/organization_workspace.ts';

testCase(
  'Moodle item tags survive approval, bank commit, QTI export and native streaming reimport',
  async () => {
    await withOrganizationWorkspace(async (f) => {
      await withImportedOrganizationQuestions(f.ctx, f.originId, async (initial) => {
        const run = await getMigrationRun(f.ctx, initial.id);
        if (!run) expect.unreachable('Expected run');
        const ids = run.items.map((item) => {
          if (!(item.createdQuestionId)) expect.unreachable('Expected item.createdQuestionId');
          return item.createdQuestionId;
        });
        const expected = [
          ['Cells', 'DNA & heredity', 'Årskurs 7', 'imported'],
          ['Energy', 'Written explanation', 'imported'],
        ];
        const before = await Promise.all(ids.map(async (id) => {
          const [row] = await db.select({ tags: questions.tags, body: questionRevisions.body })
            .from(questions).innerJoin(
              questionRevisions,
              eq(questionRevisions.id, questions.latestRevisionId),
            )
            .where(eq(questions.id, id));
          expect(row.tags).toStrictEqual(parseQuestionTags(row.body.tags));
          return row.tags;
        }));
        expect(before).toStrictEqual(expected);
        const loaded = await loadAssessmentItemExports(db, f.ctx, {
          assessment: { id: crypto.randomUUID(), title: 'Tagged questions' },
          parts: [{
            id: 'part-1',
            title: 'Science',
            placements: ids.map((id) => ({ id: crypto.randomUUID(), itemId: id, snapshotRev: 1 })),
          }],
        });
        expect(Object.values(loaded.tagsByItem)).toStrictEqual(expected);
        const assessment = await buildValidatedQti3Assessment(loaded.document);
        if (!(assessment.validation.ok)) expect.unreachable('Expected assessment.validation.ok');
        const entries = buildQti3AssessmentPackageEntries({
          ...loaded,
          assessmentXml: assessment.xml,
          assets: [],
        });
        const bytes = await writeZip(entries);
        const parsed = await parseQtiPackage(bytes);
        expect(parsed.items.map((item) => [...(item.draft.tags ?? [])].sort())).toStrictEqual(
          expected.map((tags) => [...tags].sort()),
        );
        await withImportedOrganizationQuestions(f.ctx, f.destinationId, async (reimport) => {
          const committed = await getMigrationRun(f.ctx, reimport.id);
          if (!committed) expect.unreachable('Expected committed');
          for (let i = 0; i < committed.items.length; i++) {
            const id = committed.items[i].createdQuestionId;
            if (!(id && !ids.includes(id))) expect.unreachable('Expected id && !ids.includes(id)');
            const [row] = await db.select().from(questions).where(eq(questions.id, id));
            expect([...row.tags].sort()).toStrictEqual([...expected[i]].sort());
          }
        }, { filename: 'tagged-science.zip', mime: 'application/zip', bytes, adapterId: 'qti3' });
      }, 'moodle');
    }, { count: 1, activation: 'disabled', difficulty: 'none' });
  },
);

testCase('tag boundary rejects malformed values and preserves case and Unicode', () => {
  expect(parseQuestionTags([' Cells ', 'Cells', '', 'cells', 'Årskurs 7'])).toStrictEqual([
    'Cells',
    'cells',
    'Årskurs 7',
  ]);
  for (const invalid of [null, {}, 'Cells', [1], ['Cells', null]]) {
    expect(() => parseQuestionTags(invalid)).toThrowError(Error);
  }
});

testCase('exported tags follow the selected revision rather than the latest bank row', async () => {
  await withEnrichmentWorkspace(async (ctx) => {
    const body = {
      type: 'single_select',
      itemLanguage: 'en-US',
      title: 'Cell',
      promptHtml: '<p>Which contains DNA?</p>',
      bodyHtml: '',
      choices: [{ id: 'a', text: 'Nucleus' }, { id: 'b', text: 'Wall' }],
      correctId: 'a',
    };
    const qtiXml = exportQti3TestItemXml('single_select', body, { identifier: 'cell' });
    const old = await saveQuestionRevisionFixture(ctx, {
      title: 'Cell',
      body: { ...body, tags: ['Old label'] },
      tags: ['Old label'],
      qtiXml,
      provenance: { _tag: 'Authored' },
    });
    await saveQuestionRevisionFixture(ctx, {
      questionId: old.questionId,
      title: 'Cell',
      body: { ...body, tags: ['New label'] },
      tags: ['New label'],
      qtiXml,
      provenance: { _tag: 'Revision', operation: 'revised', expectedParentRevision: 1 },
    });
    const loaded = await loadAssessmentItemExports(db, ctx, {
      assessment: { id: crypto.randomUUID() },
      parts: [{
        id: 'part-1',
        title: 'Pinned and current',
        placements: [
          { id: 'old', itemId: old.questionId, snapshotRev: 1 },
          { id: 'current', itemId: old.questionId, snapshotRev: null },
        ],
      }],
    });
    expect(Object.values(loaded.tagsByItem)).toStrictEqual([['Old label'], ['New label']]);
  });
});
