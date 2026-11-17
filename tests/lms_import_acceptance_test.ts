import { expect, test } from 'vitest';
import { getMigrationReviewPage } from '../lib/services/migration_review_page.ts';
import { updateMigrationItems } from '../lib/import/migration_run_review.ts';
import { withBankReviewSource } from './helpers/bank_review_import.ts';
import { moodleChoices, moodleQuestion } from './helpers/lms_import.ts';
import { blackboardPool } from './helpers/blackboard_import.ts';

test('persisted LMS review cannot accept omitted scoring rules or invented answer keys', async () => {
  const cases = [
    {
      adapter: 'moodle_xml',
      filename: 'weights.xml',
      text: `<quiz>${
        moodleQuestion(
          'multichoice',
          '<single>false</single><answer fraction="20"><text>A</text></answer><answer fraction="80"><text>B</text></answer>',
        )
      }${moodleQuestion('multichoice', moodleChoices, 'Good')}</quiz>`,
    },
    {
      adapter: 'moodle_xml',
      filename: 'unknown.xml',
      text: `<quiz>${moodleQuestion('calculated', '')}${
        moodleQuestion('multichoice', moodleChoices, 'Good')
      }</quiz>`,
    },
    {
      adapter: 'gift',
      filename: 'weights.gift',
      text: '::Weighted::Pick. {~%20%A ~%80%B ~%-100%C}\n\n::Good::Pick. {=Yes~No}',
    },
    { adapter: 'blackboard', filename: 'missing.dat', text: blackboardPool({ key: null }) },
  ];
  for (const entry of cases) {
    await withBankReviewSource(
      {
        filename: entry.filename,
        mime: 'application/octet-stream',
        bytes: new TextEncoder().encode(entry.text),
      },
      entry.adapter,
      async (ctx, runId) => {
        const page = await getMigrationReviewPage(ctx, runId, 1, false);
        if (!page) expect.unreachable('Expected persisted migration');
        const blocked = page.run.items[0];
        expect(blocked.readiness).toBe('blocked');
        await expect(
          updateMigrationItems(
            ctx,
            runId,
            [blocked.id],
            { kind: 'accept' },
            {
              [blocked.id]: {
                contentHash: blocked.contentHash,
                contextHash: blocked.contextHash,
                decision: blocked.decision,
              },
            },
          ),
        ).rejects.toThrow('Blocked items must be corrected');
        const good = page.run.items[1];
        if (good) {
          expect(good.readiness).toBe('ready');
          await updateMigrationItems(
            ctx,
            runId,
            [good.id],
            { kind: 'accept' },
            {
              [good.id]: {
                contentHash: good.contentHash,
                contextHash: good.contextHash,
                decision: good.decision,
              },
            },
          );
        }
        const after = await getMigrationReviewPage(ctx, runId, 1, false);
        expect(after?.run.items[0].decision).toBe('pending');
        expect(after?.run.items[0].acceptedSnapshot).toBeNull();
        if (good) expect(after?.run.items[1].acceptedSnapshot).not.toBeNull();
      },
    );
  }
});
