import { expect, test as testCase } from 'vitest';
import { readFile } from 'node:fs/promises';

import { withBankReviewSource } from './helpers/bank_review_import.ts';
import { getMigrationReviewPage } from '../lib/services/migration_review_page.ts';
import { updateMigrationItems } from '../lib/import/migration_run_review.ts';

testCase(
  'multi-question QTI migration cannot accept a stub whose diagnostic used the source path',
  async () => {
    await withBankReviewSource(
      {
        filename: 'review-identity.xml',
        mime: 'application/xml',
        bytes: new TextEncoder().encode((await readFile(
          new URL('fixtures/import/sakai/review-identity.xml', import.meta.url),
          'utf8',
        )).replaceAll('><', '>\n    <')),
      },
      'qti12',
      async (ctx, runId) => {
        const page = await getMigrationReviewPage(ctx, runId, 1, false);
        if (!page) expect.unreachable('Expected analyzed migration');
        expect(page.run.items.map((item) => item.title)).toEqual([
          'First question',
          'Second question',
          'Essay question',
        ]);
        expect(page.run.items.map((item) => item.readiness)).toEqual([
          'blocked',
          'blocked',
          'ready',
        ]);
        for (const item of page.run.items.slice(0, 2)) {
          await expect(updateMigrationItems(ctx, runId, [item.id], { kind: 'accept' }, {
            [item.id]: {
              contentHash: item.contentHash,
              contextHash: item.contextHash,
              decision: item.decision,
            },
          })).rejects.toThrow('Blocked items must be corrected');
        }
        const after = await getMigrationReviewPage(ctx, runId, 1, false);
        if (!after) expect.unreachable('Expected retained migration');
        expect(after.run.items.every((item) => item.decision === 'pending')).toBe(true);
        expect(after.run.items.every((item) => item.acceptedSnapshot === null)).toBe(true);
      },
    );
  },
);

testCase(
  'imported answer key without authored scoring cannot be approved into the bank',
  async () => {
    // An answer key alone does not authorize inventing a scoring program.
    const xml =
      `<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1" identifier="unscored" title="Unscored source">
    <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="identifier">
      <correctResponse><value>B</value></correctResponse>
    </responseDeclaration>
    <itemBody><p>Which answer is marked?</p><choiceInteraction responseIdentifier="RESPONSE" maxChoices="1">
      <simpleChoice identifier="A">First</simpleChoice><simpleChoice identifier="B">Second</simpleChoice>
    </choiceInteraction></itemBody>
  </assessmentItem>`;
    await withBankReviewSource(
      { filename: 'unscored.xml', mime: 'application/xml', bytes: new TextEncoder().encode(xml) },
      'qti21',
      async (ctx, runId) => {
        const page = await getMigrationReviewPage(ctx, runId, 1, false);
        if (!page) expect.unreachable('Expected page');
        const item = page.run.items[0];
        if (!item) expect.unreachable('Expected item');
        await expect(
          Promise.resolve().then(() =>
            updateMigrationItems(ctx, runId, [item.id], { kind: 'accept' }, {
              [item.id]: {
                contentHash: item.contentHash,
                contextHash: item.contextHash,
                decision: item.decision,
              },
            })
          ),
        ).rejects.toSatisfy((caught: unknown) =>
          caught instanceof Error && caught.message.includes('Blocked items must be corrected')
        );
        const after = await getMigrationReviewPage(ctx, runId, 1, false);
        if (!after) expect.unreachable('Expected after');
        expect(after.run.items[0].decision).toStrictEqual('pending');
        expect(after.run.items[0].acceptedSnapshot).toStrictEqual(null);
      },
    );
  },
);
