import { expect, test as testCase } from 'vitest';

import { buildMigrationAnalysis } from '../lib/import/migration_analysis.ts';
import { qti3Adapter } from '../lib/import/adapters/qti3.ts';
import { parseItemLanguage } from '../lib/types/item_language.ts';
import { writeZip } from '../lib/zip.ts';

import { getMigrationReviewPage } from '../lib/services/migration_review_page.ts';
import { updateMigrationItems } from '../lib/import/migration_run_review.ts';
import { buildMigrationQaReport } from '../lib/import/migration_qa_report.ts';
import { withBankReviewSource } from './helpers/bank_review_import.ts';
import { migrationCheckSource } from './helpers/migration_check_source.ts';
import { migrationRepeatPackage } from './helpers/migration_repeat_package.ts';

testCase(
  'answer/media summary counts questions once, links across pages, excludes rejected items and keeps source findings after edits',
  async () => {
    await withBankReviewSource(migrationCheckSource(), 'respondus-standard', async (ctx, id) => {
      const page = await getMigrationReviewPage(ctx, id, 1, false);
      if (!(page?.importChecks)) expect.unreachable('Expected page?.importChecks');
      expect(page.importChecks.affected).toStrictEqual(61);
      const [answers, references, media] = page.importChecks.groups;
      expect(answers.count).toStrictEqual(61);
      expect(answers.members.length).toStrictEqual(6);
      expect(answers.members[0].position).toStrictEqual(61);
      expect(references.count).toStrictEqual(1);
      expect(references.members[0].position).toStrictEqual(120);
      expect(media.count).toStrictEqual(1);
      expect(media.members[0].position).toStrictEqual(121);
      expect(media.packageFindings).toStrictEqual(0);
      expect(await getMigrationReviewPage({ ...ctx, tenantId: crypto.randomUUID() }, id, 1, false))
        .toStrictEqual(null);
      const full = await getMigrationReviewPage(ctx, id, 1, true);
      if (!(full?.importChecks)) expect.unreachable('Expected full?.importChecks');
      expect(full.importChecks.groups[0].members.length).toStrictEqual(61);
      const report = buildMigrationQaReport(
        full.run,
        new Date('2026-09-28T00:00:00Z'),
        full.exactRepeats,
        full.importChecks,
      );
      expect(report).toContain('Missing answers or answer order: 61 questions');
      expect(report).toContain('Questions: 120.');
      expect(report).toContain('Questions: 121.');
      const item = full.run.items[120];
      await updateMigrationItems(ctx, id, [item.id], {
        kind: 'edit',
        title: item.title,
        bodyHtml: '<p>Edited text.</p>',
      }, {
        [item.id]: {
          contentHash: item.contentHash,
          contextHash: item.contextHash,
          decision: item.decision,
        },
      });
      const edited = await getMigrationReviewPage(ctx, id, 3, false);
      if (!(edited?.importChecks)) expect.unreachable('Expected edited?.importChecks');
      expect(edited.importChecks).toStrictEqual(page.importChecks);
      const current = edited.run.items.find((i) => i.id === item.id);
      if (!current) expect.unreachable('Expected current');
      await updateMigrationItems(
        ctx,
        id,
        [item.id],
        { kind: 'reject' },
        {
          [item.id]: {
            contentHash: current.contentHash,
            contextHash: current.contextHash,
            decision: current.decision,
          },
        },
      );
      const rejected = await getMigrationReviewPage(ctx, id, 1, false);
      if (!(rejected?.importChecks)) expect.unreachable('Expected rejected?.importChecks');
      expect(rejected.importChecks.affected).toStrictEqual(60);
      expect(rejected.importChecks.groups.map((g) => g.count)).toStrictEqual([60, 1, 0]);
    });
  },
);

testCase(
  'native QTI missing answer is classified without interpreting validation messages',
  async () => {
    await withBankReviewSource(
      { filename: 'native.zip', mime: 'application/zip', bytes: await migrationRepeatPackage() },
      'qti3',
      async (ctx, id) => {
        const page = await getMigrationReviewPage(ctx, id, 1, false);
        if (!(page?.importChecks)) expect.unreachable('Expected page?.importChecks');
        expect(page.importChecks.affected).toStrictEqual(1);
        expect(page.importChecks.groups[0].count).toStrictEqual(1);
        expect(page.importChecks.groups[0].members[0].position).toStrictEqual(131);
      },
    );
  },
);

testCase(
  'missing cartridge resources stay package findings without inflating question counts',
  async () => {
    const encoder = new TextEncoder();
    const pool = `<POOL><TITLE value="Cells"/>
    <QUESTIONLIST><QUESTION id="q1" class="QUESTION_MULTIPLECHOICE"/></QUESTIONLIST>
    <QUESTION_MULTIPLECHOICE id="q1"><BODY><TEXT>Cell nucleus</TEXT></BODY>
    <ANSWER id="a" position="1"><TEXT>Correct</TEXT></ANSWER>
    <ANSWER id="b" position="2"><TEXT>Other</TEXT></ANSWER>
    <GRADABLE><CORRECTANSWER answer_id="a"/></GRADABLE></QUESTION_MULTIPLECHOICE></POOL>`;
    const bytes = await writeZip([
      {
        name: 'imsmanifest.xml',
        data: encoder.encode(
          `<manifest xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1"><resources>
      <resource identifier="first" type="assessment/x-bb-pool" file="first.dat"/>
      <resource identifier="second" type="assessment/x-bb-pool" file="second.dat"/>
      <resource identifier="missing" type="assessment/x-bb-pool" file="missing.dat"/>
    </resources></manifest>`,
        ),
      },
      { name: 'first.dat', data: encoder.encode(pool) },
      { name: 'second.dat', data: encoder.encode(pool) },
    ]);
    await withBankReviewSource(
      { filename: 'missing-resource.imscc', mime: 'application/zip', bytes },
      'imscc',
      async (ctx, id) => {
        const page = await getMigrationReviewPage(ctx, id, 1, false);
        if (!(page?.importChecks)) expect.unreachable('Expected page?.importChecks');
        expect(page.run.reviewProgress.total).toStrictEqual(2);
        expect(page.importChecks.affected).toStrictEqual(0);
        expect(page.importChecks.groups[2]).toStrictEqual({
          kind: 'media',
          count: 0,
          packageFindings: 1,
          members: [],
        });
        expect(buildMigrationQaReport(
          page.run,
          new Date('2026-09-28T00:00:00Z'),
          page.exactRepeats,
          page.importChecks,
        )).toContain('0 questions; 1 package finding.');
      },
    );
  },
);

testCase('analysis classifies single and multiple choice keys referencing absent choices', () => {
  const analysis = buildMigrationAnalysis(
    {
      title: 'Invalid keys',
      parts: [],
      organizationGroups: [],
      assets: [],
      items: (['single_select', 'multi_select'] as const).map((type, i) => ({
        href: `item-${i}.xml`,
        identifier: `item-${i}`,
        title: 'Choice reference',
        xml: '',
        draft: {
          type,
          itemLanguage: parseItemLanguage('en-US'),
          title: 'Choice reference',
          bodyHtml: '<p>Choose an answer.</p>',
          choices: [{ id: 'A', text: 'First' }, { id: 'B', text: 'Second' }],
          correctId: 'C',
          correctIds: ['A', 'C'],
        },
      })),
    },
    { adapter: qti3Adapter, sniff: { supported: true, confidence: 1 } },
    { _tag: 'WorkspaceBank', collectionId: null },
  );
  expect(analysis.items.map((item) => item.readiness)).toStrictEqual(['blocked', 'blocked']);
  if (
    !(analysis.items.every((item) =>
      item.warnings.some((warning) => warning.code === 'INVALID_ANSWER_REFERENCE')
    ))
  ) {
    expect.unreachable(
      "Expected analysis.items.every((item) => item.warnings.some((warning) => warning.code === 'INVALID_A",
    );
  }
});
