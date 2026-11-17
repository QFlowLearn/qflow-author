import { expect, test as testCase } from 'vitest';

import {
  applyBankProposal,
  type BankSelectionChange,
  type SelectedBankQuestion,
} from '../lib/assessment_bank_selection.ts';
import type { BankProposalResponse } from '../lib/bank_question_proposal.ts';

const proposal = (ids: readonly string[]): Extract<BankProposalResponse, { kind: 'proposal' }> => ({
  kind: 'proposal',
  mode: 'difficulty',
  version: {
    id: 'version',
    version: 1,
    audience: 'Grade 6',
    unsupported: 0,
    levels: [{ id: 'hard', label: 'Hard', available: 500 }],
  },
  items: ids.map((id) => ({
    categoryId: 'hard',
    question: {
      id,
      title: id,
      excerpt: '',
      type: 'single_select',
      latestRev: 3,
      tags: [],
      updatedAt: '2026-09-17T00:00:00.000Z',
    },
  })),
});
const append: BankSelectionChange = { kind: 'append', selection: 'scheme=original' };
const manual: SelectedBankQuestion = {
  placementId: 'manual-placement',
  question: proposal(['manual']).items[0].question,
  source: { kind: 'manual' },
};

testCase(
  'proposal acceptance owns the combined 100-question limit without altering manual choices',
  () => {
    let serial = 0;
    const nextId = () => `placement-${++serial}`;
    const full = applyBankProposal(
      [manual],
      append,
      proposal(Array.from({ length: 99 }, (_, n) => `question-${n}`)),
      nextId,
    );
    if (!full) expect.unreachable('Expected full');
    expect(full.length).toStrictEqual(100);
    expect(full[0]).toStrictEqual(manual);
    expect(full[1].question.latestRev).toStrictEqual(3);
    const snapshot = JSON.stringify(full);
    expect(applyBankProposal(full, append, proposal(['overflow']), nextId)).toStrictEqual(null);
    expect(applyBankProposal(full, append, proposal(['manual']), nextId)).toStrictEqual(null);
    expect(JSON.stringify(full)).toStrictEqual(snapshot);
    expect(serial, 'Rejected requests do not allocate new placement identities').toStrictEqual(99);
    const replacement = applyBankProposal(
      full,
      { kind: 'replace', selection: 'scheme=original', itemId: 'question-40' },
      proposal(['replacement']),
      nextId,
    );
    if (!replacement) expect.unreachable('Expected replacement');
    expect(replacement.length).toStrictEqual(100);
    expect(replacement[41].question.id).toStrictEqual('replacement');
    expect(replacement.filter((_, index) => index !== 41)).toStrictEqual(
      full.filter((_, index) => index !== 41),
    );
    expect(JSON.stringify(full)).toStrictEqual(snapshot);
  },
);

testCase(
  'replacement cannot overwrite manual choices, miss its target, or insert a duplicate',
  () => {
    const selected = applyBankProposal(
      [manual],
      append,
      proposal(['one', 'two']),
      () => crypto.randomUUID(),
    );
    if (!selected) expect.unreachable('Expected selected');
    for (
      const [target, ids] of [['manual', ['replacement']], ['missing', ['replacement']], ['one', [
        'two',
      ]], ['one', ['a', 'b']]] as const
    ) {
      expect(applyBankProposal(
        selected,
        { kind: 'replace', selection: append.selection, itemId: target },
        proposal(ids),
        () => crypto.randomUUID(),
      )).toStrictEqual(null);
    }
  },
);
